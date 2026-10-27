import type { BrowserContext, Locator, Page } from 'playwright-core';
import { classifySession, identityRefFromUrl, type PageSession } from './session.ts';

/**
 * Nhận diện phần tử theo TÊN TRUY CẬP (vai trò + nhãn), không theo class CSS. Regex không dùng cờ u vì Playwright không nhận khi
 * dựng selector. Hỗ trợ giao diện tiếng Việt và tiếng Anh; giao diện khác thì không nhận ra → dừng trước khi gửi.
 */
export const COMPOSER_NAME = /viết gì đi|bạn đang nghĩ gì|write something|what'?s on your mind/i;
export const POST_BUTTON = /^(đăng|post)$/i;
export const NEXT_BUTTON = /^(tiếp|next)$/i;
export const AUDIENCE_BUTTON = /quyền riêng tư|đối tượng|privacy|audience/i;
export const PHOTO_BUTTON = /ảnh\/video|photo\/video/i;

/** Chỉ kiểm tra cookie phiên có tồn tại hay không, không đọc giá trị. */
export async function sessionOf(context: BrowserContext, page: Page): Promise<PageSession> {
  try {
    const hasSessionCookie = (await context.cookies('https://www.facebook.com')).some((cookie) => cookie.name === 'c_user');
    const hasLoginForm = (await page.locator('input[name="email"], input[name="pass"]').count()) > 0;
    return classifySession({ url: page.url(), hasLoginForm, hasSessionCookie });
  } catch {
    return 'unknown'; // trang đang chuyển hướng
  }
}

/** Mở /me và đọc tham chiếu danh tính từ URL trang cá nhân sau khi chuyển hướng. */
export async function readIdentityRef(page: Page): Promise<string | null> {
  await page.goto('https://www.facebook.com/me', { waitUntil: 'load', timeout: 45_000 });
  for (let i = 0; i < 4; i += 1) {
    const ref = identityRefFromUrl(page.url());
    if (ref) return ref;
    await page.waitForTimeout(2_000);
  }
  return null;
}

/** Dòng đầu (không rỗng) của caption, gọn khoảng trắng, tối đa 60 ký tự: dùng để nhận ra bài vừa đăng trong feed. */
export function captionSnippet(caption: string): string {
  const line = caption.split(/\r?\n/u).map((part) => part.replace(/\s+/gu, ' ').trim()).find(Boolean) ?? '';
  return line.slice(0, 60);
}

/** Đếm ảnh nội dung trong vùng (bỏ icon/avatar nhỏ). */
export const bigImages = (scope: Locator): Promise<number> =>
  scope.locator('img').evaluateAll((nodes) => nodes.filter((node) => (node as unknown as { naturalWidth: number }).naturalWidth >= 150).length);

/** Chờ phần tử bật (enabled) tối đa `ms`; không bấm khi chưa bật. */
export async function waitEnabled(locator: Locator, ms: number, page: Page): Promise<boolean> {
  for (let waited = 0; waited <= ms; waited += 500) {
    if (await locator.first().isEnabled().catch(() => false)) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

/** Số lần đoạn chữ xuất hiện trên trang hiện tại (so khớp chứa, không phân biệt hoa thường). */
export const countText = (page: Page, snippet: string): Promise<number> => page.getByText(snippet).count();

/**
 * ID bài viết gần dòng chữ nhất: đi lên từ dòng chữ tới tầng đầu tiên có liên kết bài viết; chỉ tin khi tầng đó có ĐÚNG MỘT ID.
 * ID nằm ở /post_insights/<ID> (chỉ quản trị), set=pcb.<ID> (bài có ảnh), /posts/, /permalink/, multi_permalinks=, story_fbid=
 * (không dùng fbid= vì đó là ID ảnh). Phụ thuộc cấu trúc trang hiện tại nên có thể trả null.
 */
export async function nearestPostId(text: Locator): Promise<string | null> {
  const ids = await text.first().evaluate((element) => {
    // Chạy trong trình duyệt: mô tả tối thiểu các API DOM cần dùng (tsconfig Node không có kiểu DOM).
    type Walk = { parentElement: Walk | null; querySelectorAll(selector: string): ArrayLike<{ getAttribute(name: string): string | null }> };
    let node = element as unknown as Walk | null;
    for (let level = 0; node && level < 14; level += 1) {
      const found = new Set<string>();
      for (const link of Array.from(node.querySelectorAll('a[href]'))) {
        const hit = /(?:\/posts\/|\/permalink\/|multi_permalinks=|story_fbid=|\/post_insights\/|set=pcb\.)(\d{6,25})/.exec(link.getAttribute('href') ?? '');
        if (hit?.[1]) found.add(hit[1]);
      }
      if (found.size > 0) return Array.from(found);
      node = node.parentElement;
    }
    return [] as string[];
  });
  return ids.length === 1 ? (ids[0] ?? null) : null;
}
