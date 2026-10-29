import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAccountRepository, createGroupSearchRepository, writeWorkerHeartbeat } from '#storage';
import { createTestWorkspace } from '#test-support';
import { buildApp } from './app.ts';

test('API tìm nhóm và yêu cầu tham gia: kiểm tra chế độ/worker/danh tính, giới hạn, xác nhận, CSRF; không tạo job đăng', async () => {
  const ws = createTestWorkspace();
  const app = buildApp({ db: ws.db, env: 'test', integrations: 'live', logger: false, mediaStore: ws.media });
  const fakeApp = buildApp({ db: ws.db, env: 'test', integrations: 'fake', logger: false, mediaStore: ws.media });
  try {
    const accounts = createAccountRepository(ws.db);
    const accountId = accounts.create({ label: 'A' }).id;
    const session = await app.inject({ method: 'GET', url: '/api/session', headers: { host: '127.0.0.1:4317' } });
    const headers = { host: '127.0.0.1:4317', origin: 'http://127.0.0.1:4317', 'x-apm-token': session.json().token, 'content-type': 'application/json' };
    const searchUrl = `/api/accounts/${accountId}/group-search`;
    const search = (payload: object) => app.inject({ method: 'POST', url: searchUrl, headers, payload });
    assert.equal((await search({ keyword: 'a', limit: 10 })).statusCode, 400);
    assert.equal((await search({ keyword: 'điện thoại', limit: 0 })).statusCode, 400);
    assert.equal((await search({ keyword: 'điện thoại', limit: 201 })).statusCode, 400);
    assert.equal((await search({ keyword: 'điện thoại', limit: 10, extra: 1 })).statusCode, 400);
    assert.equal((await search({ keyword: 'điện thoại', limit: 10 })).statusCode, 503); // worker chưa chạy
    writeWorkerHeartbeat(ws.db, 'real');
    assert.equal((await search({ keyword: 'điện thoại', limit: 10 })).statusCode, 409); // tài khoản chưa đăng nhập
    accounts.recordIdentity(accountId, 'vanity:nick.a'); accounts.recordSession(accountId, 'logged_in');
    assert.equal((await app.inject({ method: 'POST', url: searchUrl, headers: { host: headers.host, origin: headers.origin }, payload: { keyword: 'điện thoại', limit: 10 } })).statusCode, 403);
    assert.equal((await search({ keyword: 'điện thoại', limit: 10 })).statusCode, 202);
    assert.equal((await search({ keyword: 'iphone', limit: 10 })).statusCode, 409);
    const latest = await app.inject({ method: 'GET', url: searchUrl, headers });
    assert.deepEqual([latest.json().scan.status, latest.json().scan.keyword, latest.json().results], ['queued', 'điện thoại', []]);
    assert.ok(!latest.body.includes('vanity:nick.a')); assert.ok(!latest.body.includes('claimed_by'));
    const scan = createGroupSearchRepository(ws.db).latest(accountId); assert.ok(scan);
    assert.equal((await app.inject({ method: 'POST', url: `/api/group-searches/${scan.id}/cancel`, headers, payload: {} })).statusCode, 204);

    // Cài đặt hạn mức
    assert.equal((await app.inject({ method: 'GET', url: '/api/group-join-settings', headers })).json().settings.dailyCap, 5);
    const put = (payload: object) => app.inject({ method: 'PUT', url: '/api/group-join-settings', headers, payload });
    assert.equal((await put({ dailyCap: 31, minGapSeconds: 180, maxGapSeconds: 360 })).statusCode, 400);
    assert.equal((await put({ dailyCap: 5, minGapSeconds: 300, maxGapSeconds: 200 })).statusCode, 400); // tối đa < tối thiểu
    assert.equal((await put({ dailyCap: 3, minGapSeconds: 120, maxGapSeconds: 240 })).json().settings.dailyCap, 3);

    // Yêu cầu tham gia
    const run = createGroupSearchRepository(ws.db);
    run.enqueue(accountId, 'iphone', 10);
    const claim = run.claimNext('w'); assert.ok(claim);
    run.saveBatch(claim.id, 'w', [{ reference: '100000000001', name: 'A', privacy: 'public', memberCount: 5, joinState: 'can_join' }, { reference: '100000000002', name: 'B', privacy: 'public', memberCount: 5, joinState: 'joined' }]);
    run.finish(claim.id, 'w', 'partial', 'result_limit');
    const results = (await app.inject({ method: 'GET', url: searchUrl, headers })).json().results as Array<{ id: string; externalId: string }>;
    const [canJoin, alreadyIn] = [results.find((row) => row.externalId === '100000000001'), results.find((row) => row.externalId === '100000000002')];
    assert.ok(canJoin && alreadyIn);
    const joinUrl = `/api/accounts/${accountId}/group-joins`;
    const join = (payload: object) => app.inject({ method: 'POST', url: joinUrl, headers, payload });
    assert.equal((await join({ searchResultIds: [canJoin.id], maxCount: 1 })).statusCode, 400); // thiếu xác nhận
    assert.equal((await join({ searchResultIds: [canJoin.id], maxCount: 1, confirmReal: false })).statusCode, 400);
    assert.equal((await join({ searchResultIds: [], maxCount: 1, confirmReal: true })).statusCode, 400);
    assert.equal((await join({ searchResultIds: [canJoin.id], maxCount: 31, confirmReal: true })).statusCode, 400);
    assert.equal((await join({ searchResultIds: [alreadyIn.id], maxCount: 1, confirmReal: true })).statusCode, 400); // đã là thành viên
    assert.equal((await join({ searchResultIds: [canJoin.id, canJoin.id], maxCount: 2, confirmReal: true })).statusCode, 400);
    assert.equal((await join({ searchResultIds: [canJoin.id], maxCount: 1, confirmReal: true })).statusCode, 202);
    assert.equal((await join({ searchResultIds: [canJoin.id], maxCount: 1, confirmReal: true })).statusCode, 409); // đã có yêu cầu
    const listed = (await app.inject({ method: 'GET', url: joinUrl, headers })).json();
    assert.deepEqual([listed.requests.length, listed.requests[0].status, listed.quota.cap, listed.quota.pending], [1, 'queued', 3, 1]);
    assert.ok(!JSON.stringify(listed).includes('vanity:nick.a'));
    assert.equal((await app.inject({ method: 'POST', url: `/api/group-joins/${listed.requests[0].id}/cancel`, headers, payload: {} })).statusCode, 204);
    assert.equal((await app.inject({ method: 'POST', url: `${joinUrl}/cancel-queued`, headers, payload: {} })).json().cancelled, 0);

    // Chế độ mô phỏng không bao giờ gửi
    const fakeSession = await fakeApp.inject({ method: 'GET', url: '/api/session', headers: { host: headers.host } });
    const fakeHeaders = { ...headers, 'x-apm-token': fakeSession.json().token };
    assert.equal((await fakeApp.inject({ method: 'POST', url: searchUrl, headers: fakeHeaders, payload: { keyword: 'iphone', limit: 5 } })).json().error, 'mode_mismatch');
    assert.equal((await fakeApp.inject({ method: 'POST', url: joinUrl, headers: fakeHeaders, payload: { searchResultIds: [canJoin.id], maxCount: 1, confirmReal: true } })).json().error, 'mode_mismatch');
    assert.equal(ws.db.prepare('SELECT count(*) AS n FROM publish_jobs').get()?.n, 0);
  } finally { await app.close(); await fakeApp.close(); ws.dispose(); }
});
