import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { type Database, migrate, openDatabase } from '#storage';
import { buildApp } from './app.ts';

let db: Database;
let app: ReturnType<typeof buildApp>;
before(() => {
  db = openDatabase(':memory:');
  migrate(db);
  app = buildApp({ db, env: 'test', logger: false });
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
    assert.ok(!Number.isNaN(Date.parse(body.startedAt)));
  });

  test('API không tồn tại trả 404 JSON', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/posts' });
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().error, 'not_found');
  });
});
