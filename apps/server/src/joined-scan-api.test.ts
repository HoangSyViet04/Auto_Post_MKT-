import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAccountRepository, createJoinedScanRepository, writeWorkerHeartbeat } from '#storage';
import { createTestWorkspace } from '#test-support';
import { buildApp } from './app.ts';

test('API quét: kiểm tra worker/chế độ/danh tính, giới hạn, CSRF; tạo và hủy không tạo job đăng', async () => {
  const ws = createTestWorkspace();
  const app = buildApp({ db: ws.db, env: 'test', integrations: 'live', logger: false, mediaStore: ws.media });
  const fakeApp = buildApp({ db: ws.db, env: 'test', integrations: 'fake', logger: false, mediaStore: ws.media });
  try {
    const accounts = createAccountRepository(ws.db);
    const accountId = accounts.create({ label: 'A' }).id;
    const session = await app.inject({ method: 'GET', url: '/api/session', headers: { host: '127.0.0.1:4317' } });
    const headers = { host: '127.0.0.1:4317', origin: 'http://127.0.0.1:4317', 'x-apm-token': session.json().token, 'content-type': 'application/json' };
    const url = `/api/accounts/${accountId}/joined-scan`;
    const post = (payload: object) => app.inject({ method: 'POST', url, headers, payload });
    assert.equal((await post({ limit: 0 })).statusCode, 400);
    assert.equal((await post({ limit: 1001 })).statusCode, 400);
    assert.equal((await post({ limit: 30, profileDir: 'outside' })).statusCode, 400);
    assert.equal((await post({ limit: 30 })).statusCode, 503);
    writeWorkerHeartbeat(ws.db, 'real');
    assert.equal((await post({ limit: 30 })).statusCode, 409);
    accounts.recordIdentity(accountId, 'vanity:nick.a'); accounts.recordSession(accountId, 'logged_in');
    assert.equal((await app.inject({ method: 'POST', url, headers: { host: headers.host, origin: headers.origin }, payload: { limit: 30 } })).statusCode, 403);
    assert.equal((await post({ limit: 30 })).statusCode, 202);
    assert.equal((await post({ limit: 30 })).statusCode, 409);
    const latest = await app.inject({ method: 'GET', url, headers });
    assert.equal(latest.json().scan.status, 'queued');
    assert.equal(latest.json().scan.cancelRequested, false);
    assert.ok(!latest.body.includes('vanity:nick.a')); assert.ok(!latest.body.includes('claimed_by'));
    const scan = createJoinedScanRepository(ws.db).latest(accountId); assert.ok(scan);
    assert.equal((await app.inject({ method: 'POST', url: `/api/joined-scans/${scan.id}/cancel`, headers, payload: {} })).statusCode, 204);
    const fakeSession = await fakeApp.inject({ method: 'GET', url: '/api/session', headers: { host: headers.host } });
    assert.equal((await fakeApp.inject({ method: 'POST', url, headers: { ...headers, 'x-apm-token': fakeSession.json().token }, payload: { limit: 30 } })).json().error, 'mode_mismatch');
    assert.equal(ws.db.prepare('SELECT count(*) AS n FROM publish_jobs').get()?.n, 0);
  } finally { await app.close(); await fakeApp.close(); ws.dispose(); }
});
