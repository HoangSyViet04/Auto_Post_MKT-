/** Phần dùng chung cho các công cụ thử thật: mở profile riêng đã đăng nhập, kiểm tra phiên và danh tính. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { acquireProfileLock, classifySession, identityRefFromUrl, maskRef, type PageSession, refDigest } from '#browser';
import { getDataDir } from '#config';

export const spikesDir = (): string => join(getDataDir(), 'spikes');

export interface OpenedProfile {
  context: BrowserContext;
  page: Page;
  baselineMasked: string;
  close(): Promise<void>;
}

export async function sessionOf(context: BrowserContext, page: Page): Promise<PageSession> {
  try {
    const hasSessionCookie = (await context.cookies('https://www.facebook.com')).some((cookie) => cookie.name === 'c_user');
    const hasLoginForm = (await page.locator('input[name="email"], input[name="pass"]').count()) > 0;
    return classifySession({ url: page.url(), hasLoginForm, hasSessionCookie });
  } catch {
    return 'unknown';
  }
}

async function readIdentity(page: Page): Promise<string | null> {
  await page.goto('https://www.facebook.com/me', { waitUntil: 'load', timeout: 45_000 });
  for (let i = 0; i < 4; i += 1) {
    const ref = identityRefFromUrl(page.url());
    if (ref) return ref;
    await page.waitForTimeout(2_000);
  }
  return null;
}

/**
 * Mở profile đã đăng nhập (một tiến trình một profile) và chỉ trả về khi phiên còn hiệu lực và danh tính khớp bản đã lưu.
 * Ném Error với mã ngắn (`profile_in_use`, `no_baseline`, `session:<trạng thái>`, `identity_mismatch`) và luôn dọn khóa/trình duyệt.
 */
export async function openVerifiedProfile(label: string): Promise<OpenedProfile> {
  const base = spikesDir();
  let baseline: { refDigest: string; masked: string };
  try {
    baseline = JSON.parse(readFileSync(join(base, 'evidence', `${label}-identity.json`), 'utf8'));
  } catch {
    throw new Error('no_baseline');
  }
  const lock = acquireProfileLock(join(base, 'locks', `${label}.lock`));
  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(join(base, 'profiles', label), { channel: 'msedge', headless: false, viewport: null });
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(2_000);
    const state = await sessionOf(context, page);
    if (state !== 'logged_in') throw new Error(`session:${state}`);
    const ref = await readIdentity(page);
    if (!ref || refDigest(ref) !== baseline.refDigest) throw new Error('identity_mismatch');
    const opened = context;
    return { context: opened, page, baselineMasked: maskRef(ref), close: async () => { await opened.close().catch(() => undefined); lock.release(); } };
  } catch (error) {
    await context?.close().catch(() => undefined);
    lock.release();
    throw error;
  }
}
