const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const VALIDATION_ORIGIN = 'http://local.invalid';

/** Only paths inside this app's API may receive a local access token. */
function validatePath(path: string): void {
  if (!path.startsWith('/api/') || /[\s\\#]/u.test(path)) throw new Error('Đường dẫn API không hợp lệ.');
  const url = new URL(path, VALIDATION_ORIGIN);
  if (url.origin !== VALIDATION_ORIGIN || !url.pathname.startsWith('/api/')) {
    throw new Error('Đường dẫn API không hợp lệ.');
  }
}

/**
 * Access tokens stay in memory. Mutations accept JSON, or image bytes at /api/media, and are
 * sent once only: neither a 403 nor a network error automatically resubmits.
 */
export function createApiClient(fetcher: typeof fetch = globalThis.fetch) {
  let session: Promise<string> | undefined;

  function getSession(): Promise<string> {
    if (!session) {
      session = (async () => {
        const response = await fetcher('/api/session', {
          method: 'GET', credentials: 'same-origin', mode: 'same-origin',
          redirect: 'error', cache: 'no-store', headers: { Accept: 'application/json' },
        });
        if (!response.ok) throw new Error(`Không tải được phiên truy cập cục bộ (HTTP ${response.status}).`);
        const data: unknown = await response.json();
        if (typeof data !== 'object' || data === null || !('token' in data)
          || typeof data.token !== 'string' || !data.token) {
          throw new Error('Phiên truy cập cục bộ không hợp lệ.');
        }
        return data.token;
      })().catch(() => {
        session = undefined;
        throw new Error('Không tải được phiên truy cập cục bộ.');
      });
    }
    return session;
  }

  return {
    /** Explicitly discard an old session; this does not submit any request. */
    clearSession() { session = undefined; },

    async fetch(path: string, init: RequestInit = {}): Promise<Response> {
      validatePath(path);
      const method = (init.method ?? 'GET').toUpperCase();
      const mutation = !SAFE_METHODS.has(method);
      const headers = new Headers(init.headers);
      if (mutation) {
        headers.set('X-APM-Token', await getSession());
        const upload = method === 'POST' && path.split('?', 1)[0] === '/api/media'
          && ['image/jpeg', 'image/png', 'image/webp'].includes(headers.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase() ?? '');
        if (!upload) headers.set('Content-Type', 'application/json');
      }
      const response = await fetcher(path, {
        ...init, method, headers, credentials: 'same-origin', mode: 'same-origin', redirect: 'error',
        ...(mutation ? { cache: 'no-store' } : {}),
      });
      // Server may have restarted. A later deliberate action can bootstrap anew;
      // the rejected action is never replayed here.
      if (mutation && response.status === 403) session = undefined;
      return response;
    },
  };
}

const client = createApiClient();
export const apiFetch = client.fetch;
