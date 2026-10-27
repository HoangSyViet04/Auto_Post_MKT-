/** Chuẩn hóa link/ID nhóm Facebook do người dùng nhập. Thuần, không gọi mạng; không có kết quả thì trả null. */

export interface NormalizedGroup {
  /** ID số của nhóm; null khi link chỉ có tên rút gọn (slug) — chưa đủ để đăng. */
  externalId: string | null;
  canonicalUrl: string;
}

const MAX_INPUT = 2000;
const NUMERIC_ID = /^\d{5,25}$/u;
const SLUG = /^[a-z0-9._-]{3,100}$/u;
/** Đường dẫn dưới /groups/ không phải một nhóm cụ thể. */
const RESERVED = new Set(['feed', 'discover', 'joins', 'create', 'search', 'category', 'notifications', 'requests']);

function isFacebookHost(host: string): boolean {
  return host === 'facebook.com' || host.endsWith('.facebook.com');
}

export function normalizeGroupReference(input: unknown): NormalizedGroup | null {
  if (typeof input !== 'string') return null;
  const text = input.trim();
  if (!text || text.length > MAX_INPUT || /\s/u.test(text)) return null;

  let target: string;
  if (NUMERIC_ID.test(text)) {
    target = text;
  } else {
    let url: URL;
    try {
      url = new URL(/^[a-z][a-z0-9+.-]*:\/\//iu.test(text) ? text : `https://${text}`);
    } catch {
      return null;
    }
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return null;
    if (!isFacebookHost(url.hostname.toLowerCase())) return null;
    const [first, second] = url.pathname.split('/').filter(Boolean);
    if (first?.toLowerCase() !== 'groups' || !second) return null;
    try {
      target = decodeURIComponent(second);
    } catch {
      return null;
    }
  }

  if (NUMERIC_ID.test(target)) {
    return { externalId: target, canonicalUrl: `https://www.facebook.com/groups/${target}` };
  }
  const slug = target.toLowerCase();
  if (!SLUG.test(slug) || RESERVED.has(slug)) return null;
  return { externalId: null, canonicalUrl: `https://www.facebook.com/groups/${slug}` };
}
