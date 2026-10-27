import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { type Database, migrate, openDatabase } from '#storage';
import { buildApp } from './app.ts';
import { createLogger } from '#logging';

let db: Database;
let app: ReturnType<typeof buildApp>;
before(() => {
  db = openDatabase(':memory:');
  migrate(db);
  app = buildApp({ db, env: 'test', integrations: 'fake', logger: false });
});
after(async () => {
  await app.close();
  db.close();
});

describe('server API', () => {
  test('GET /api/health trả trạng thái và phiên bản schema', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.env, 'test');
    assert.equal(body.schemaVersion, 1);
    assert.equal(body.integrations, 'fake');
    assert.ok(!Number.isNaN(Date.parse(body.startedAt)));
  });

  test('API không tồn tại trả 404 JSON', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/posts' });
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().error, 'not_found');
  });

  test('Fastify request/response/error log không lộ header, query, body và nested secrets', async () => {
    let output = '';
    const log = createLogger({ env: 'test', name: 'server', destination: { write(line) { output += line; } } });
    const server = buildApp({ db, env: 'test', integrations: 'fake', logger: log });
    server.post('/log-check', async (request) => {
      request.log.info({ headers: request.headers, body: request.body, nested: { proxyPassword: 'proxy-sentinel' } });
      throw new Error('Authorization: auth-sentinel');
    });
    try {
      const response = await server.inject({ method: 'POST', url: '/log-check?access_token=query-sentinel',
        headers: { cookie: 'cookie-sentinel', authorization: 'Bearer auth-sentinel', 'x-api-key': 'api-sentinel' },
        payload: { unusual: 'body-sentinel' },
      });
      assert.equal(response.statusCode, 500);
      for (const secret of ['proxy-sentinel', 'auth-sentinel', 'query-sentinel', 'cookie-sentinel', 'api-sentinel', 'body-sentinel']) {
        assert.ok(!output.includes(secret), `Secret leaked: ${secret}`);
      }
      assert.match(output, /REDACTED/);
      assert.match(output, /request completed/);
    } finally {
      await server.close();
    }
  });
});
