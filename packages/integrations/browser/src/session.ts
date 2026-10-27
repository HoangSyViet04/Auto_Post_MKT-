import { createHash } from 'node:crypto';

/** Các đường dẫn mức đầu của facebook.com không phải trang cá nhân. */
const NOT_A_PROFILE = new Set([
  'login', 'checkpoint', 'recover', 'two_step_verification', 'help', 'policies', 'privacy', 'home.php', 'watch', 'marketplace',
  'groups', 'pages', 'gaming', 'events', 'friends', 'notifications', 'messages', 'settings', 'me', 'reg', 'r.php', 'dialog',
]);

function facebookUrl(input: string): URL | null {
  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || !(host === 'facebook.com' || host.endsWith('.facebook.com'))) return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * Tham chiếu danh tính từ URL trang cá nhân sau khi /me chuyển hướng: `id:<số>` hoặc `vanity:<tên>`.
 * Chỉ dùng để so sánh giữa các lần mở; không phải bí mật nhưng vẫn không được ghi nguyên văn vào log.
 */
export function identityRefFromUrl(input: string): string | null {
  const url = facebookUrl(input);
  if (!url) return null;
  const [first] = url.pathname.split('/').filter(Boolean);
  if (!first) return null;
  if (first.toLowerCase() === 'profile.php') {
    const id = url.searchParams.get('id');
    return id && /^\d{5,25}$/u.test(id) ? `id:${id}` : null;
  }
  const name = first.toLowerCase();
  return NOT_A_PROFILE.has(name) || !/^[a-z0-9.]{3,100}$/u.test(name) ? null : `vanity:${name}`;
}

export const refDigest = (ref: string): string => createHash('sha256').update(ref).digest('hex');

/** Chỉ để hiển thị cho người vận hành xác nhận bằng mắt: giữ 3 ký tự đầu, che phần còn lại. */
export function maskRef(ref: string): string {
  const [kind = '', value = ''] = ref.split(':');
  return `${kind}:${value.slice(0, 3)}${'*'.repeat(Math.max(0, value.length - 3))} (${value.length} ký tự)`;
}

export type PageSession = 'logged_in' | 'login_required' | 'verification_required' | 'unknown';

/**
 * Phân loại trang hiện tại. Gặp checkpoint/xác minh thì dừng và nhường người dùng — không tự xử lý.
 * `hasSessionCookie` chỉ cho biết cookie phiên có tồn tại, không bao giờ đọc giá trị của nó.
 */
export function classifySession(input: { url: string; hasLoginForm: boolean; hasSessionCookie: boolean }): PageSession {
  const url = facebookUrl(input.url);
  if (!url) return 'unknown';
  const path = url.pathname.toLowerCase();
  if (path.startsWith('/checkpoint') || path.startsWith('/two_step_verification') || path.startsWith('/recover')) return 'verification_required';
  if (input.hasLoginForm || path.startsWith('/login')) return 'login_required';
  return input.hasSessionCookie ? 'logged_in' : 'unknown';
}
