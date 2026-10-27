import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { type BrowserDriver, classifyNavigationError, type DriverFailure, type DriverInput, type DriverResult } from './driver.ts';
import { acquireProfileLock } from './profile-lock.ts';
import { classifySession, identityRefFromUrl, type PageSession } from './session.ts';

const POLL_MS = 3_000;

async function sessionOf(context: BrowserContext, page: Page): Promise<PageSession> {
  try {
    // Chỉ kiểm tra cookie phiên có tồn tại hay không, không đọc giá trị.
    const hasSessionCookie = (await context.cookies('https://www.facebook.com')).some((cookie) => cookie.name === 'c_user');
    const hasLoginForm = (await page.locator('input[name="email"], input[name="pass"]').count()) > 0;
    return classifySession({ url: page.url(), hasLoginForm, hasSessionCookie });
  } catch {
    return 'unknown'; // trang đang chuyển hướng
  }
}

async function readIdentityRef(page: Page): Promise<string | null> {
  await page.goto('https://www.facebook.com/me', { waitUntil: 'load', timeout: 45_000 });
  for (let i = 0; i < 4; i += 1) {
    const ref = identityRefFromUrl(page.url());
    if (ref) return ref;
    await page.waitForTimeout(2_000);
  }
  return null;
}

/** Mở hồ sơ (một tiến trình một hồ sơ), chạy `work`, luôn đóng trình duyệt và nhả khóa. */
async function withProfile(input: DriverInput, work: (context: BrowserContext, page: Page) => Promise<DriverResult>): Promise<DriverResult> {
  let lock: ReturnType<typeof acquireProfileLock>;
  try {
    lock = acquireProfileLock(`${input.profileDir}.lock`);
  } catch {
    return { ok: false, code: 'profile_in_use' };
  }
  let context: BrowserContext | undefined;
  try {
    // Cửa sổ hiện ra như trình duyệt thường (cần cho đăng nhập tay); dùng Edge có sẵn trên Windows.
    context = await chromium.launchPersistentContext(input.profileDir, { channel: 'msedge', headless: false, viewport: null });
    const page = context.pages()[0] ?? await context.newPage();
    return await work(context, page);
  } catch (error) {
    if (error instanceof Error && classifyNavigationError(error.message) === 'network_error') return { ok: false, code: 'network_error' };
    throw error; // lỗi khác (kể cả mất quyền khóa từ onTick) để worker xử lý
  } finally {
    await context?.close().catch(() => undefined);
    lock.release();
  }
}

const stateToFailure = (state: PageSession): DriverFailure => (state === 'login_required' || state === 'verification_required' ? state : 'unknown');

export function createPlaywrightDriver(): BrowserDriver {
  return {
    login: (input) => withProfile(input, async (context, page) => {
      let closed = false;
      context.on('close', () => { closed = true; });
      await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      const deadline = Date.now() + input.timeoutMs;
      let state: PageSession = 'unknown';
      while (Date.now() < deadline) {
        if (closed) return { ok: false, code: 'window_closed' };
        if (input.shouldCancel()) return { ok: false, code: 'cancelled' };
        input.onTick();
        state = await sessionOf(context, page);
        if (state === 'logged_in') break;
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
      if (state !== 'logged_in') return { ok: false, code: state === 'verification_required' ? 'verification_required' : 'timeout' };
      const ref = await readIdentityRef(page);
      return ref ? { ok: true, identityRef: ref } : { ok: false, code: 'identity_unreadable' };
    }),

    verify: (input) => withProfile(input, async (context, page) => {
      await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForTimeout(2_000);
      input.onTick();
      const state = await sessionOf(context, page);
      if (state !== 'logged_in') return { ok: false, code: stateToFailure(state) };
      const ref = await readIdentityRef(page);
      return ref ? { ok: true, identityRef: ref } : { ok: false, code: 'identity_unreadable' };
    }),
  };
}
