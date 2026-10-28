import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Phần của trang mà ta cần: chỉ chụp ảnh. Không đọc DOM, cookie hay mạng. */
export interface ScreenshotTarget {
  screenshot(options: { type: 'png'; timeout: number }): Promise<Buffer>;
}

export interface CaptureInfo {
  jobId: string;
  /** Mã lý do dừng (ví dụ ui_changed). */
  code: string;
}

/** Hàm chụp do worker đưa cho adapter; không bao giờ ném lỗi ra ngoài (chẩn đoán không được làm hỏng việc đăng). */
export type DiagnosticHook = (page: ScreenshotTarget, info: CaptureInfo) => Promise<unknown>;

export interface DiagnosticCaptureOptions {
  /** Thư mục lưu (ngoài repo, không nằm trong bản sao lưu). */
  dir: string;
  /** Quá hạn này thì xóa. */
  retentionMs: number;
  /** Giới hạn số ảnh; quá thì xóa ảnh cũ nhất. */
  maxFiles?: number;
  now?: () => number;
}

const SAFE = /[^a-z0-9_-]/gu;
const safe = (value: string, max: number) => value.toLowerCase().replace(SAFE, '_').slice(0, max) || 'x';
const isCapture = (name: string) => name.endsWith('.png');

/**
 * Ảnh chụp màn hình chẩn đoán có hạn lưu. Chỉ tạo khi worker được bật rõ (APM_DIAG_CAPTURE=on) và chỉ khi một lần đăng dừng vì lỗi.
 * Tên file chỉ gồm thời điểm, tiền tố mã job và mã lý do (đã làm sạch, không thể thoát khỏi thư mục). Hạn lưu tính theo thời điểm ghi file.
 */
export function createDiagnosticCapture(options: DiagnosticCaptureOptions) {
  const now = options.now ?? Date.now;
  const maxFiles = options.maxFiles ?? 100;

  function entries(): Array<{ path: string; mtime: number }> {
    if (!existsSync(options.dir)) return [];
    return readdirSync(options.dir).filter(isCapture).map((name) => {
      const path = join(options.dir, name);
      return { path, mtime: statSync(path).mtimeMs };
    });
  }

  /** Xóa ảnh quá hạn; trả số ảnh đã xóa. */
  function purgeExpired(): number {
    const limit = now() - options.retentionMs;
    let removed = 0;
    for (const entry of entries()) {
      if (entry.mtime <= limit) { rmSync(entry.path, { force: true }); removed += 1; }
    }
    return removed;
  }

  /** Xóa toàn bộ ảnh chụp (người dùng chủ động dọn). */
  function purgeAll(): number {
    const all = entries();
    for (const entry of all) rmSync(entry.path, { force: true });
    return all.length;
  }

  return {
    purgeExpired,
    purgeAll,
    stats(): { count: number; oldestAgeMs: number | null } {
      const all = entries();
      return { count: all.length, oldestAgeMs: all.length ? now() - Math.min(...all.map((entry) => entry.mtime)) : null };
    },

    /** Chụp một ảnh; trả đường dẫn hoặc null nếu không chụp được. Không bao giờ ném lỗi. */
    async capture(page: ScreenshotTarget, info: CaptureInfo): Promise<string | null> {
      try {
        const image = await page.screenshot({ type: 'png', timeout: 5_000 });
        mkdirSync(options.dir, { recursive: true });
        purgeExpired();
        const existing = entries().sort((a, b) => a.mtime - b.mtime);
        for (const old of existing.slice(0, Math.max(0, existing.length - maxFiles + 1))) rmSync(old.path, { force: true });
        const stamp = new Date(now()).toISOString().replace(/\D/gu, '').slice(0, 14);
        const path = join(options.dir, `${stamp}-${safe(info.jobId, 8)}-${safe(info.code, 40)}.png`);
        writeFileSync(path, image);
        return path;
      } catch {
        return null;
      }
    },
  };
}
