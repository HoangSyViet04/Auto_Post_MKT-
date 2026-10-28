/**
 * Client Graph API tối thiểu cho fanpage (P09). Nguyên tắc:
 *  - Token KHÔNG bao giờ nằm trong URL: gửi bằng header Authorization (Page/User token) hoặc thân POST (bí mật ứng dụng), nên không lọt vào log
 *    truy cập, lịch sử hay thông báo lỗi.
 *  - Lỗi trả về chỉ là MÃ phân loại + mã lỗi số của Meta; không bao giờ chép nguyên văn thông báo của Meta (có thể chứa dữ kiện nhạy cảm).
 *  - Chỉ nói chuyện với graph.facebook.com (hoặc vòng lặp cục bộ khi test).
 */

export type GraphErrorCode =
  | 'token_expired'
  | 'permission_denied'
  | 'rate_limited'
  | 'temporary'
  | 'network'
  | 'invalid_request'
  | 'bad_response'
  | 'exchange_failed';

export type GraphResult<T> = { ok: true; value: T } | { ok: false; code: GraphErrorCode; status: number | null; fbCode: number | null };

export interface PageInfo {
  id: string;
  name: string;
  category: string | null;
  /** Token của Page: bí mật, chỉ đưa thẳng vào kho bí mật. */
  accessToken: string;
  tasks: string[];
}

export interface GraphClientOptions {
  /** Mặc định https://graph.facebook.com. Chỉ chấp nhận https của Meta hoặc http loopback (test). */
  baseUrl?: string;
  /** Mặc định APM_GRAPH_VERSION hoặc phiên bản dưới đây. Meta ngừng dần các phiên bản cũ nên có thể đổi bằng biến môi trường. */
  version?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** Phiên bản Graph API mặc định. Chưa đối chiếu với tài liệu hiện hành của Meta (P09.8): đổi bằng APM_GRAPH_VERSION nếu cần. */
export const DEFAULT_GRAPH_VERSION = 'v23.0';
const VERSION = /^v\d{1,2}\.\d{1,2}$/u;
const PAGE_ID = /^\d{5,25}$/u;

export function getGraphVersion(env: Record<string, string | undefined> = process.env): string {
  const value = (env.APM_GRAPH_VERSION ?? '').trim();
  if (value === '') return DEFAULT_GRAPH_VERSION;
  if (!VERSION.test(value)) throw new Error('APM_GRAPH_VERSION không hợp lệ (ví dụ v23.0)');
  return value;
}

/** Phân loại lỗi theo mã số của Meta (không dựa vào câu chữ). */
export function classifyGraphError(status: number | null, fbCode: number | null, subcode: number | null = null): GraphErrorCode {
  if (fbCode === 190 || subcode === 463 || subcode === 467 || status === 401) return 'token_expired';
  if (fbCode === 10 || fbCode === 200 || (fbCode !== null && fbCode >= 200 && fbCode <= 299)) return 'permission_denied';
  if (fbCode === 4 || fbCode === 17 || fbCode === 32 || fbCode === 613 || (fbCode !== null && fbCode >= 80000 && fbCode <= 80014)) return 'rate_limited';
  if (fbCode === 1 || fbCode === 2 || (status !== null && status >= 500)) return 'temporary';
  if (status === 403) return 'permission_denied';
  if (status === 429) return 'rate_limited';
  return 'invalid_request';
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null);

export function createGraphClient(options: GraphClientOptions = {}) {
  const base = (options.baseUrl ?? 'https://graph.facebook.com').replace(/\/+$/u, '');
  if (base !== 'https://graph.facebook.com' && !/^http:\/\/127\.0\.0\.1:\d+$/u.test(base)) throw new Error('Địa chỉ Graph API không hợp lệ');
  const version = options.version ?? getGraphVersion();
  if (!VERSION.test(version)) throw new Error('Phiên bản Graph API không hợp lệ');
  const doFetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;

  async function call(method: 'GET' | 'POST', path: string, init: { token?: string; query?: Record<string, string>; form?: Record<string, string> } = {}): Promise<GraphResult<Record<string, unknown>>> {
    const url = new URL(`${base}/${version}/${path}`);
    for (const [key, value] of Object.entries(init.query ?? {})) url.searchParams.set(key, value); // chỉ tham số KHÔNG nhạy cảm
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (init.token) headers.Authorization = `Bearer ${init.token}`;
    let body: string | undefined;
    if (init.form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(init.form).toString();
    }
    let response: Response;
    try {
      response = await doFetch(url, { method, headers, ...(body === undefined ? {} : { body }), redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      return { ok: false, code: 'network', status: null, fbCode: null };
    }
    let json: unknown;
    try { json = await response.json(); } catch { json = undefined; }
    if (!response.ok || (isObject(json) && isObject(json.error))) {
      const error = isObject(json) && isObject(json.error) ? json.error : {};
      const fbCode = typeof error.code === 'number' ? error.code : null;
      const subcode = typeof error.error_subcode === 'number' ? error.error_subcode : null;
      return { ok: false, code: classifyGraphError(response.status, fbCode, subcode), status: response.status, fbCode };
    }
    if (!isObject(json)) return { ok: false, code: 'bad_response', status: response.status, fbCode: null };
    return { ok: true, value: json };
  }

  return {
    version,

    /** Đổi token người dùng ngắn hạn sang dài hạn. Bí mật ứng dụng đi trong thân POST, không vào URL. */
    async exchangeUserToken(input: { appId: string; appSecret: string; shortLivedToken: string }): Promise<GraphResult<{ accessToken: string; expiresInSec: number | null }>> {
      if (!/^\d{5,25}$/u.test(input.appId) || !input.appSecret || !input.shortLivedToken) return { ok: false, code: 'invalid_request', status: null, fbCode: null };
      const result = await call('POST', 'oauth/access_token', { form: { grant_type: 'fb_exchange_token', client_id: input.appId, client_secret: input.appSecret, fb_exchange_token: input.shortLivedToken } });
      if (!result.ok) return { ...result, code: result.code === 'network' || result.code === 'temporary' || result.code === 'rate_limited' ? result.code : 'exchange_failed' };
      const accessToken = text(result.value.access_token);
      if (!accessToken) return { ok: false, code: 'bad_response', status: null, fbCode: null };
      return { ok: true, value: { accessToken, expiresInSec: typeof result.value.expires_in === 'number' ? result.value.expires_in : null } };
    },

    /** Các Page mà người dùng quản lý, kèm token của từng Page và `tasks`. Chỉ đọc. */
    async listPages(userToken: string): Promise<GraphResult<PageInfo[]>> {
      const pages: PageInfo[] = [];
      let after: string | undefined;
      for (let round = 0; round < 10; round += 1) {
        const result = await call('GET', 'me/accounts', { token: userToken, query: { fields: 'id,name,category,access_token,tasks', limit: '100', ...(after ? { after } : {}) } });
        if (!result.ok) return result;
        const data = Array.isArray(result.value.data) ? result.value.data : [];
        for (const item of data) {
          if (!isObject(item)) continue;
          const id = text(item.id);
          const name = text(item.name);
          const accessToken = text(item.access_token);
          if (!id || !PAGE_ID.test(id) || !name || !accessToken) continue;
          pages.push({ id, name, category: text(item.category), accessToken, tasks: Array.isArray(item.tasks) ? item.tasks.filter((task): task is string => typeof task === 'string') : [] });
        }
        const paging = isObject(result.value.paging) ? result.value.paging : {};
        const cursors = isObject(paging.cursors) ? paging.cursors : {};
        // Không bao giờ đi theo paging.next (URL do Meta dựng, chứa token): dùng con trỏ `after` của chính mình.
        after = typeof paging.next === 'string' ? text(cursors.after) ?? undefined : undefined;
        if (!after) break;
      }
      return { ok: true, value: pages };
    },

    /** Kiểm tra một Page token còn dùng được và đúng Page (chỉ đọc). */
    async checkPage(pageId: string, pageToken: string): Promise<GraphResult<{ id: string; name: string }>> {
      if (!PAGE_ID.test(pageId) || !pageToken) return { ok: false, code: 'invalid_request', status: null, fbCode: null };
      const result = await call('GET', pageId, { token: pageToken, query: { fields: 'id,name' } });
      if (!result.ok) return result;
      const id = text(result.value.id);
      const name = text(result.value.name);
      if (id !== pageId || !name) return { ok: false, code: 'bad_response', status: null, fbCode: null };
      return { ok: true, value: { id, name } };
    },
  };
}

export type GraphClient = ReturnType<typeof createGraphClient>;

export const GRAPH_ERROR_MESSAGE: Record<GraphErrorCode, string> = {
  token_expired: 'Token đã hết hạn hoặc bị thu hồi. Tạo token mới ở Graph API Explorer rồi thử lại.',
  permission_denied: 'Meta từ chối quyền. Kiểm tra ứng dụng đã được cấp pages_show_list, pages_manage_posts và bạn là quản trị Page.',
  rate_limited: 'Meta đang giới hạn tần suất. Chờ vài phút rồi thử lại.',
  temporary: 'Meta đang lỗi tạm thời. Thử lại sau.',
  network: 'Không kết nối được tới graph.facebook.com. Kiểm tra mạng.',
  invalid_request: 'Yêu cầu bị Meta từ chối (dữ liệu nhập sai hoặc phiên bản API không còn hỗ trợ). Kiểm tra App ID/token và APM_GRAPH_VERSION.',
  bad_response: 'Phản hồi từ Meta không đúng định dạng mong đợi.',
  exchange_failed: 'Không đổi được token. Kiểm tra App ID, App Secret và token vừa tạo (token dán lúc này có thể đã hết hạn: tạo lại).',
};
