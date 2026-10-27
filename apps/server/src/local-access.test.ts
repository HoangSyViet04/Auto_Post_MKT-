import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { type Database, migrate, openDatabase } from '#storage';
import { buildApp } from './app.ts';

const HOST = '127.0.0.1:4317';
const ORIGIN = `http://${HOST}`;
let db: Database;
before(() => { db = openDatabase(':memory:'); migrate(db); });
after(() => db.close());

function fixture(env: 'development' | 'test' | 'production' = 'test') {
  const app = buildApp({ db, env, integrations: 'fake', logger: false });
  let writes = 0;
  app.route({ method: ['POST', 'PUT', 'PATCH', 'DELETE'], url: '/test-mutation', handler: async () => {
    writes++;
    return { ok: true };
  } });
  return { app, writes: () => writes };
}

async function bootstrap(app: ReturnType<typeof buildApp>) {
  const response = await app.inject({ method: 'GET', url: '/api/session', headers: { host: HOST } });
  assert.equal(response.statusCode, 200);
  return response.json().token as string;
}

describe('local API access boundary', () => {
  test('bootstrap trusted context có token ổn định, không cache/cookie/CORS; app mới có token mới', async () => {
    const { app } = fixture();
    const { app: restarted } = fixture();
    try {
      const response = await app.inject({ method: 'GET', url: '/api/session', headers: {
        host: HOST, origin: ORIGIN, 'sec-fetch-site': 'same-origin',
      } });
      assert.equal(response.statusCode, 200);
      assert.match(response.json().token, /^[a-f0-9]{64}$/);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.equal(response.headers['set-cookie'], undefined);
      assert.equal(response.headers['access-control-allow-origin'], undefined);
      assert.equal(await bootstrap(app), response.json().token);
      assert.notEqual(await bootstrap(restarted), response.json().token);
    } finally { await app.close(); await restarted.close(); }
  });

  test('Host chính xác chặn DNS rebinding, tên miền gần giống, loopback alias và cổng lạ', async () => {
    const { app } = fixture();
    try {
      for (const host of ['evil.invalid', '127.0.0.1.evil.invalid:4317', 'localhost:4317', '127.1:4317',
        '2130706433:4317', '127.0.0.1:5173', '127.0.0.1:4318', '127.0.0.1:4317,evil.invalid']) {
        const response = await app.inject({ method: 'GET', url: '/api/session', headers: { host } });
        assert.equal(response.statusCode, 403, host);
        assert.deepEqual(response.json(), { error: 'local_access_denied', message: 'Yêu cầu truy cập cục bộ không hợp lệ.' });
        assert.ok(!response.body.includes(host));
      }
    } finally { await app.close(); }
  });

  test('Origin nếu có phải exact allowlist kể cả GET; null/path/credentials/https không hợp lệ', async () => {
    const { app } = fixture();
    try {
      for (const origin of ['null', 'https://127.0.0.1:4317', `${ORIGIN}/`, `${ORIGIN}.evil.invalid`,
        'http://user@127.0.0.1:4317', 'http://evil.invalid', `${ORIGIN} http://evil.invalid`]) {
        const response = await app.inject({ method: 'GET', url: '/api/session', headers: { host: HOST, origin } });
        assert.equal(response.statusCode, 403, origin);
      }
    } finally { await app.close(); }
  });

  test('header bảo mật trùng lặp bị chặn, không dùng giá trị Node đã ghép/bỏ', async () => {
    const { app, writes } = fixture();
    try {
      const token = await bootstrap(app);
      for (const key of ['host', 'origin', 'sec-fetch-site', 'x-apm-token', 'content-type']) {
        const headers: Record<string, string | string[]> = {
          host: HOST, origin: ORIGIN, 'sec-fetch-site': 'same-origin',
          'content-type': 'application/json', 'x-apm-token': token,
        };
        const value = headers[key] as string;
        headers[key] = [value, value];
        const response = await app.inject({ method: 'POST', url: '/test-mutation', headers, payload: '{}' });
        assert.equal(response.statusCode, 403, key);
      }
      assert.equal(writes(), 0);
    } finally { await app.close(); }
  });

  test('cross-site hoặc Fetch metadata sai bị từ chối cả health/bootstrap, không tin forwarded header', async () => {
    const { app } = fixture();
    try {
      for (const path of ['/api/health', '/api/session']) {
        for (const site of ['cross-site', 'unrecognized']) {
          const response = await app.inject({ method: 'GET', url: path, headers: {
            host: HOST, origin: ORIGIN, 'sec-fetch-site': site,
          } });
          assert.equal(response.statusCode, 403);
        }
      }
      const denied = await app.inject({ method: 'GET', url: '/api/session', headers: {
        host: 'evil.invalid', origin: 'http://evil.invalid',
        'x-forwarded-host': HOST, 'x-forwarded-proto': 'http', 'x-forwarded-for': '127.0.0.1',
        'x-forwarded-origin': ORIGIN,
      } });
      assert.equal(denied.statusCode, 403);
      const accepted = await app.inject({ method: 'GET', url: '/api/health', headers: {
        host: HOST, 'x-forwarded-host': 'evil.invalid', 'x-forwarded-for': '198.51.100.1',
      } });
      assert.equal(accepted.statusCode, 200);
      const remote = await app.inject({ method: 'GET', url: '/api/health', remoteAddress: '198.51.100.1', headers: {
        host: HOST, 'x-forwarded-for': '127.0.0.1',
      } });
      assert.equal(remote.statusCode, 403, 'forwarded IP không thay IP kết nối thực');
    } finally { await app.close(); }
  });

  test('cổng Vite chỉ được chấp nhận ở development; tùy chọn port được kiểm tra', async () => {
    for (const env of ['development', 'test', 'production'] as const) {
      const app = buildApp({ db, env, integrations: 'fake', logger: false, security: { serverPort: 14317, webPort: 15173 } });
      try {
        for (const port of [14317, 15173]) {
          const response = await app.inject({ method: 'GET', url: '/api/health', headers: {
            host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`,
          } });
          assert.equal(response.statusCode, port === 14317 || env === 'development' ? 200 : 403);
        }
      } finally { await app.close(); }
    }
    assert.throws(() => buildApp({ db, env: 'test', integrations: 'fake', logger: false,
      security: { serverPort: 0 } }), /Cổng truy cập cục bộ/);
  });

  test('mọi mutation cần Origin + token đúng + JSON; reject trước body parse và handler', async () => {
    const { app, writes } = fixture();
    try {
      const token = await bootstrap(app);
      const valid: Record<string, string> = { host: HOST, origin: ORIGIN, 'content-type': 'application/json', 'x-apm-token': token };
      const cases: Array<Record<string, string>> = [];
      for (const missing of ['origin', 'x-apm-token', 'content-type']) {
        const headers = { ...valid };
        delete headers[missing];
        cases.push(headers);
      }
      for (const badToken of ['', 'wrong', 'f'.repeat(64), `${token}${token}`, token.toUpperCase()]) {
        cases.push({ ...valid, 'x-apm-token': badToken });
      }
      for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data', 'application/jsonp']) {
        cases.push({ ...valid, 'content-type': type });
      }
      cases.push({ ...valid, origin: 'null' }, { ...valid, origin: 'http://evil.invalid' }, { ...valid, 'sec-fetch-site': 'cross-site' });
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
        for (const headers of cases) {
          const response = await app.inject({ method, url: '/test-mutation', headers, payload: '{broken json' });
          assert.equal(response.statusCode, 403, `${method} ${JSON.stringify({ ...headers, 'x-apm-token': '[masked]' })}`);
          assert.ok(!response.body.includes(token));
        }
      }
      assert.equal(writes(), 0);
      const invalidJson = await app.inject({ method: 'POST', url: '/test-mutation', headers: valid, payload: '{broken json' });
      assert.equal(invalidJson.statusCode, 400);
      assert.equal(writes(), 0, 'JSON sai vẫn không gọi handler khi đã qua boundary');
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
        const response = await app.inject({ method, url: '/test-mutation', headers: {
          ...valid, 'content-type': 'application/json; charset=utf-8', 'sec-fetch-site': 'same-origin',
        }, payload: { value: 1 } });
        assert.equal(response.statusCode, 200);
      }
      assert.equal(writes(), 4);
    } finally { await app.close(); }
  });

  test('token của app khác không cấp quyền; không cho preflight CORS', async () => {
    const { app, writes } = fixture();
    const { app: other } = fixture();
    try {
      const token = await bootstrap(other);
      const response = await app.inject({ method: 'POST', url: '/test-mutation', headers: {
        host: HOST, origin: ORIGIN, 'content-type': 'application/json', 'x-apm-token': token,
      }, payload: {} });
      assert.equal(response.statusCode, 403);
      assert.equal(writes(), 0);
      const preflight = await app.inject({ method: 'OPTIONS', url: '/test-mutation', headers: {
        host: HOST, origin: 'http://evil.invalid', 'access-control-request-method': 'POST',
      } });
      assert.equal(preflight.statusCode, 403);
      assert.equal(preflight.headers['access-control-allow-origin'], undefined);
    } finally { await app.close(); await other.close(); }
  });
});
