import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '#config';
import type { ApiError } from '#domain';

export interface LocalAccessOptions {
  serverPort?: number;
  webPort?: number;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const FETCH_SITES = new Set(['same-origin', 'same-site', 'none']);
const SINGLE_HEADERS = new Set(['host', 'origin', 'sec-fetch-site', 'x-apm-token', 'content-type']);
const DENIED: ApiError = {
  error: 'local_access_denied',
  message: 'Yêu cầu truy cập cục bộ không hợp lệ.',
};

function loopbackHost(port: number): string {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('Cổng truy cập cục bộ không hợp lệ.');
  return `127.0.0.1:${port}`;
}

/** Root hook protects every route before body parsing and business handlers. */
export function installLocalAccess(app: FastifyInstance, env: AppEnv, options: LocalAccessOptions = {}): void {
  const hosts = new Set([loopbackHost(options.serverPort ?? 4317)]);
  if (env === 'development') hosts.add(loopbackHost(options.webPort ?? 5173));
  const origins = new Set([...hosts].map((host) => `http://${host}`));
  // One token for this app/server lifetime; never persisted or put in URLs/cookies.
  const tokenBytes = randomBytes(32);
  const token = tokenBytes.toString('hex');

  app.addHook('onRequest', async (request, reply) => {
    // Node can discard/join duplicate parsed headers. Check originals as well.
    const seenHeaders = new Set<string>();
    const rawHeaders = request.raw.rawHeaders;
    for (let i = 0; i < rawHeaders.length; i += 2) {
      const name = rawHeaders[i]?.toLowerCase();
      if (name && SINGLE_HEADERS.has(name)) {
        if (seenHeaders.has(name)) return reply.code(403).send(DENIED);
        seenHeaders.add(name);
      }
    }
    const host = request.headers.host;
    const origin = request.headers.origin;
    const site = request.headers['sec-fetch-site'];
    const contextAllowed = request.ip === '127.0.0.1'
      && typeof host === 'string' && hosts.has(host)
      && (origin === undefined || (typeof origin === 'string' && origins.has(origin)))
      && (site === undefined || (typeof site === 'string' && FETCH_SITES.has(site)));
    if (!contextAllowed) return reply.code(403).send(DENIED);

    if (!SAFE_METHODS.has(request.method)) {
      const suppliedToken = request.headers['x-apm-token'];
      const contentType = request.headers['content-type'];
      const validToken = typeof suppliedToken === 'string'
        && /^[a-f0-9]{64}$/.test(suppliedToken)
        && timingSafeEqual(tokenBytes, Buffer.from(suppliedToken, 'hex'));
      const isJson = typeof contentType === 'string'
        && contentType.split(';', 1)[0]?.trim().toLowerCase() === 'application/json';
      const isMediaUpload = request.method === 'POST' && request.url.split('?', 1)[0] === '/api/media'
        && typeof contentType === 'string' && ['image/jpeg', 'image/png', 'image/webp'].includes(contentType.split(';', 1)[0]?.trim().toLowerCase() ?? '');
      if (origin === undefined || !validToken || (!isJson && !isMediaUpload)) return reply.code(403).send(DENIED);
    }
  });

  app.get('/api/session', async (_request, reply): Promise<{ token: string }> => {
    reply.header('cache-control', 'no-store');
    reply.header('pragma', 'no-cache');
    reply.header('x-content-type-options', 'nosniff');
    return { token };
  });
}
