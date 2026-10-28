import { normalizeGroupReference } from '#domain';
import { readIdentityRef, sessionOf } from './facebook-ui.ts';
import { type LaunchedProfile, launchProfile } from './profile-session.ts';

export interface JoinedGroupObservation { reference: string; name: string | null }
export interface JoinedGroupScanInput {
  profileDir: string;
  expectedIdentity: string;
  limit: number;
  shouldCancel(): boolean;
  onTick(): void;
  /** Cumulative snapshot: persisted after every round, including when later rounds fail. */
  onBatch(items: readonly JoinedGroupObservation[]): void;
}
export interface JoinedGroupScanResult { status: 'partial' | 'stopped' | 'blocked' | 'failed'; reason: string }
export type JoinedGroupScanner = (input: JoinedGroupScanInput) => Promise<JoinedGroupScanResult>;

/** Read-only joined-groups UI. Never joins a group, grants posting permission, or creates posts. */
export function createJoinedGroupScanner(deps: {
  launch?: (dir: string) => Promise<LaunchedProfile>;
  settleMs?: number;
  scrollMs?: number;
  maxRounds?: number;
} = {}): JoinedGroupScanner {
  return async (input) => {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 1000) throw new Error('Invalid scan limit');
    if (input.shouldCancel()) return { status: 'stopped', reason: 'cancelled' };
    let profile: LaunchedProfile | undefined;
    const seen = new Map<string, JoinedGroupObservation>();
    try {
      profile = await (deps.launch ?? launchProfile)(input.profileDir);
      const { page, context } = profile;
      await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForTimeout(deps.settleMs ?? 2000);
      input.onTick();
      const state = await sessionOf(context, page);
      if (state !== 'logged_in') return { status: 'blocked', reason: state === 'verification_required' ? 'checkpoint' : 'session_expired' };
      const identity = await readIdentityRef(page);
      if (!identity || identity !== input.expectedIdentity) return { status: 'blocked', reason: 'identity_mismatch' };
      if (input.shouldCancel()) return { status: 'stopped', reason: 'cancelled' };
      await page.goto('https://www.facebook.com/groups/joins/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForTimeout(deps.settleMs ?? 2000);
      let idle = 0;
      for (let round = 0; round < (deps.maxRounds ?? 60); round += 1) {
        input.onTick();
        if (input.shouldCancel()) return { status: 'stopped', reason: 'cancelled' };
        const session = await sessionOf(context, page);
        if (session !== 'logged_in') return { status: 'blocked', reason: session === 'verification_required' ? 'checkpoint' : 'session_expired' };
        if (!new URL(page.url()).pathname.startsWith('/groups/joins')) return { status: 'blocked', reason: 'ui_changed' };
        if (await page.locator('[role="main"]').count() === 0) return { status: 'blocked', reason: 'ui_changed' };
        const anchors = await page.locator('[role="main"] a[href*="/groups/"]').evaluateAll((nodes) => nodes.map((node) => ({
          href: node.getAttribute('href') ?? '', name: (node.textContent ?? '').trim().split(/[\r\n]/u)[0]?.slice(0, 500) ?? '',
        })));
        const before = seen.size;
        for (const anchor of anchors) {
          const normalized = normalizeGroupReference(anchor.href.startsWith('/') ? `https://www.facebook.com${anchor.href}` : anchor.href);
          if (!normalized) continue;
          const prior = seen.get(normalized.canonicalUrl);
          if (prior) {
            if (anchor.name.length > (prior.name?.length ?? 0)) prior.name = anchor.name || null;
          } else if (seen.size < input.limit) seen.set(normalized.canonicalUrl, { reference: normalized.canonicalUrl, name: anchor.name || null });
        }
        input.onBatch([...seen.values()]);
        if (seen.size >= input.limit) return { status: 'partial', reason: 'result_limit' };
        idle = seen.size === before ? idle + 1 : 0;
        if (idle >= 3) return { status: 'partial', reason: 'no_more_results_seen' };
        await page.mouse.wheel(0, 2500);
        await page.waitForTimeout(deps.scrollMs ?? 1800);
      }
      return { status: 'partial', reason: 'round_cap' };
    } catch (error) {
      if (error instanceof Error && error.message === 'profile_in_use') return { status: 'blocked', reason: 'profile_in_use' };
      return { status: 'failed', reason: error instanceof Error && /net::ERR_/u.test(error.message) ? 'network_error' : 'scan_error' };
    } finally {
      await profile?.close();
    }
  };
}
