import type { BrowserContext, Page } from 'playwright-core';
import { type BrowserDriver, classifyNavigationError, type DriverFailure, type DriverInput, type DriverResult } from './driver.ts';
import { launchProfile } from './profile-session.ts';
import { readIdentityRef, sessionOf } from './facebook-ui.ts';
import type { PageSession } from './session.ts';

const POLL_MS = 3_000;

/** Mở hồ sơ (một tiến trình một hồ sơ), chạy `work`, luôn đóng trình duyệt và nhả khóa. */
async function withProfile(input: DriverInput, work: (context: BrowserContext, page: Page) => Promise<DriverResult>): Promise<DriverResult> {
  let profile: Awaited<ReturnType<typeof launchProfile>>;
  try {
    profile = await launchProfile(input.profileDir);
  } catch (error) {
    if (error instanceof Error && error.message === 'profile_in_use') return { ok: false, code: 'profile_in_use' };
    throw error;
  }
  try {
    return await work(profile.context, profile.page);
  } catch (error) {
    if (error instanceof Error && classifyNavigationError(error.message) === 'network_error') return { ok: false, code: 'network_error' };
    throw error; // lỗi khác (kể cả mất quyền khóa từ onTick) để worker xử lý
  } finally {
    await profile.close();
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
