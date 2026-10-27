import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { acquireProfileLock } from './profile-lock.ts';

export interface LaunchedProfile {
  context: BrowserContext;
  page: Page;
  /** Đóng trình duyệt và nhả khóa hồ sơ; gọi nhiều lần cũng an toàn. */
  close(): Promise<void>;
}

/**
 * Mở hồ sơ trình duyệt riêng của một tài khoản: một thư mục chỉ một tiến trình mở (khóa tệp), dùng Edge có sẵn trên Windows,
 * cửa sổ hiện ra như trình duyệt thường. Ném Error('profile_in_use') nếu hồ sơ đang được dùng.
 */
export async function launchProfile(profileDir: string): Promise<LaunchedProfile> {
  const lock = acquireProfileLock(`${profileDir}.lock`);
  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(profileDir, { channel: 'msedge', headless: false, viewport: null });
    const page = context.pages()[0] ?? await context.newPage();
    const opened = context;
    let closed = false;
    return {
      context: opened,
      page,
      close: async () => {
        if (closed) return;
        closed = true;
        await opened.close().catch(() => undefined);
        lock.release();
      },
    };
  } catch (error) {
    await context?.close().catch(() => undefined);
    lock.release();
    throw error;
  }
}
