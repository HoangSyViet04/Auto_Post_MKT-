import { type GroupJoinState, type GroupPrivacy, normalizeGroupReference, parseMemberCount, SEARCH_LIMIT_MAX } from '#domain';
import { readIdentityRef, sessionOf } from './facebook-ui.ts';
import { type LaunchedProfile, launchProfile } from './profile-session.ts';

/** Nhận diện theo nhãn nút (vi/en), không theo class CSS. Regex không dùng cờ u vì Playwright không nhận khi dựng selector. */
// Facebook thật gắn tên nhóm vào nhãn nút ("Tham gia nhóm <tên>", đã xác nhận ngày 29/10/2026), nên khớp theo phần đầu của nhãn.
export const JOIN_BUTTON = /^(tham gia nhóm|join group)(\s.*)?$|^(tham gia|join)$/i;
export const JOINED_BUTTON = /^(đã tham gia|joined)(\s.*)?$/i;
export const REQUESTED_BUTTON = /^(hủy yêu cầu|cancel request|đã gửi yêu cầu|request sent|yêu cầu đã gửi)/i;

export interface SearchObservation {
  reference: string;
  name: string | null;
  privacy: GroupPrivacy;
  memberCount: number | null;
  joinState: GroupJoinState;
}
export interface GroupSearchScanInput {
  profileDir: string;
  expectedIdentity: string;
  keyword: string;
  limit: number;
  shouldCancel(): boolean;
  onTick(): void;
  /** Ảnh chụp tích lũy: lưu sau mỗi vòng, kể cả khi các vòng sau lỗi. */
  onBatch(items: readonly SearchObservation[]): void;
}
export interface GroupSearchScanResult { status: 'partial' | 'stopped' | 'blocked' | 'failed'; reason: string }
export type GroupSearchScanner = (input: GroupSearchScanInput) => Promise<GroupSearchScanResult>;

export interface RawSearchCard { href: string; anchorText: string; lines: readonly string[]; buttons: readonly string[]; shared: boolean }

/** Trạng thái tham gia từ nhãn các nút của thẻ kết quả. Thẻ dùng chung với nhóm khác (`shared`) thì không kết luận. */
export function joinStateOf(buttons: readonly string[], shared: boolean): GroupJoinState {
  if (shared) return 'unknown';
  if (buttons.some((label) => REQUESTED_BUTTON.test(label))) return 'requested';
  if (buttons.some((label) => JOINED_BUTTON.test(label.trim()))) return 'joined';
  if (buttons.some((label) => JOIN_BUTTON.test(label.trim()))) return 'can_join';
  return 'unknown';
}

/** Dòng thông tin thật có dạng "Công khai · 578K thành viên · 90+ bài viết/ngày" (đã xác nhận 29/10/2026); bỏ dòng đầu là tên nhóm. */
export function privacyOf(lines: readonly string[]): GroupPrivacy {
  const info = lines.slice(1);
  if (info.some((line) => /^(nhóm )?(riêng tư|private)( group)?\s*(·|$)/i.test(line))) return 'private';
  if (info.some((line) => /^(nhóm )?(công khai|public)( group)?\s*(·|$)/i.test(line))) return 'public';
  return 'unknown';
}

/** Đọc một thẻ kết quả thô. Trường không đọc được là null/unknown (không đoán). */
export function parseSearchCard(card: RawSearchCard): SearchObservation | null {
  const normalized = normalizeGroupReference(card.href.startsWith('/') ? `https://www.facebook.com${card.href}` : card.href);
  if (!normalized) return null;
  const firstLine = card.lines[0]?.trim() ?? '';
  const name = (card.anchorText.trim() || firstLine).slice(0, 500) || null;
  return {
    reference: normalized.canonicalUrl,
    name,
    privacy: card.shared ? 'unknown' : privacyOf(card.lines),
    memberCount: card.shared ? null : parseMemberCount(card.lines.slice(1).join(' ')),
    joinState: joinStateOf(card.buttons, card.shared),
  };
}

const rank = (item: SearchObservation): number => (item.name?.length ?? 0) + (item.joinState === 'unknown' ? 0 : 1000) + (item.memberCount === null ? 0 : 100) + (item.privacy === 'unknown' ? 0 : 100);

/**
 * Tìm nhóm theo từ khóa, chỉ đọc. Không bấm Tham gia, không rời nhóm, không đăng. Trạng thái "có thể tham gia" chỉ mang tính tham khảo:
 * trước khi gửi yêu cầu, bộ gửi mở lại chính trang nhóm để kiểm tra lần nữa.
 */
export function createGroupSearchScanner(deps: {
  launch?: (dir: string) => Promise<LaunchedProfile>;
  settleMs?: number;
  scrollMs?: number;
  maxRounds?: number;
} = {}): GroupSearchScanner {
  return async (input) => {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > SEARCH_LIMIT_MAX) throw new Error('Invalid search limit');
    if (input.keyword.trim().length < 2) throw new Error('Invalid keyword');
    if (input.shouldCancel()) return { status: 'stopped', reason: 'cancelled' };
    let profile: LaunchedProfile | undefined;
    const seen = new Map<string, SearchObservation>();
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
      await page.goto(`https://www.facebook.com/search/groups/?q=${encodeURIComponent(input.keyword.trim())}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForTimeout(deps.settleMs ?? 2000);
      let idle = 0;
      for (let round = 0; round < (deps.maxRounds ?? 30); round += 1) {
        input.onTick();
        if (input.shouldCancel()) return { status: 'stopped', reason: 'cancelled' };
        const session = await sessionOf(context, page);
        if (session !== 'logged_in') return { status: 'blocked', reason: session === 'verification_required' ? 'checkpoint' : 'session_expired' };
        if (!new URL(page.url()).pathname.startsWith('/search')) return { status: 'blocked', reason: 'ui_changed' };
        if (await page.locator('[role="main"]').count() === 0) return { status: 'blocked', reason: 'ui_changed' };
        // Mỗi liên kết nhóm: đi lên tầng nhỏ nhất có nút bấm (thẻ kết quả). Tầng nào chứa liên kết của nhiều nhóm khác nhau là
        // khung chung, không phải thẻ: khi đó bỏ nút để không gán nhầm trạng thái cho nhóm này.
        const cards = await page.locator('[role="main"] a[href*="/groups/"]').evaluateAll((nodes) => nodes.map((node) => {
          type El = { parentElement: El | null; textContent: string | null; getAttribute(name: string): string | null; querySelectorAll(selector: string): ArrayLike<El> };
          const groupIds = (box: El): number => new Set(Array.from(box.querySelectorAll('a[href*="/groups/"]')).map((link) => /\/groups\/([^/?#]+)/.exec(link.getAttribute('href') ?? '')?.[1] ?? '')).size;
          let box = node as unknown as El;
          let found = false;
          for (let level = 0; level < 8 && box.parentElement; level += 1) {
            if (box.querySelectorAll('[role="button"], button').length > 0) { found = true; break; }
            box = box.parentElement;
          }
          const shared = !found || groupIds(box) > 1;
          // Mỗi phần tử lá là một đoạn chữ (không dùng innerText để tránh ép trình duyệt tính lại bố cục).
          const lines = shared ? [] : Array.from(box.querySelectorAll('*')).filter((el) => el.querySelectorAll('*').length === 0).map((el) => (el.textContent ?? '').trim()).filter(Boolean).slice(0, 14);
          const buttons = shared ? [] : Array.from(box.querySelectorAll('[role="button"], button')).map((button) => (button.getAttribute('aria-label') ?? button.textContent ?? '').trim()).filter(Boolean).slice(0, 8);
          return { href: node.getAttribute('href') ?? '', anchorText: ((node.textContent ?? '').trim().split(/[\r\n]/u)[0] ?? '').slice(0, 500), lines, buttons, shared };
        }));
        const before = seen.size;
        for (const raw of cards) {
          const item = parseSearchCard(raw);
          if (!item) continue;
          const prior = seen.get(item.reference);
          if (!prior) { if (seen.size < input.limit) seen.set(item.reference, item); }
          else if (rank(item) > rank(prior)) seen.set(item.reference, { ...item, name: item.name ?? prior.name });
        }
        input.onBatch([...seen.values()]);
        if (seen.size >= input.limit) return { status: 'partial', reason: 'result_limit' };
        idle = seen.size === before ? idle + 1 : 0;
        if (idle >= 3) return { status: 'partial', reason: seen.size === 0 ? 'no_results' : 'no_more_results_seen' };
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
