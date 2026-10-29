import assert from 'node:assert/strict';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import type { GroupJoiner, GroupSearchScanner } from '#browser';
import { createAccountRepository, createGroupJoinRepository, createGroupSearchRepository, createLeaseRepository } from '#storage';
import { createTestWorkspace } from '#test-support';
import { createGroupJoinRunner, createGroupSearchRunner } from './group-discovery.ts';

let ws: ReturnType<typeof createTestWorkspace>;
let accountId: string;
const found = (n: number) => ({ reference: `https://www.facebook.com/groups/10000000000${n}`, name: `Nhóm ${n}`, privacy: 'public' as const, memberCount: 100 * n, joinState: 'can_join' as const });
beforeEach(() => {
  ws = createTestWorkspace();
  const accounts = createAccountRepository(ws.db);
  accountId = accounts.create({ label: 'Nick A' }).id;
  accounts.recordIdentity(accountId, 'vanity:nick.a'); accounts.recordSession(accountId, 'logged_in');
});
afterEach(() => ws.dispose());
const runSearch = (scan: GroupSearchScanner) => createGroupSearchRunner({ db: ws.db, workerId: 'test-worker', dataDir: ws.dataDir, scan }).processNext();
const runJoin = (joiner: GroupJoiner) => createGroupJoinRunner({ db: ws.db, workerId: 'test-worker', dataDir: ws.dataDir, join: joiner }).processNext();

/** Tìm xong và trả id các kết quả. */
async function seed(n: number): Promise<string[]> {
  createGroupSearchRepository(ws.db).enqueue(accountId, 'điện thoại', 50);
  await runSearch(async (input) => { input.onBatch(Array.from({ length: n }, (_, i) => found(i + 1))); return { status: 'partial', reason: 'no_more_results_seen' }; });
  return createGroupSearchRepository(ws.db).results(accountId).map((row) => row.id);
}

test('tìm nhóm: truyền từ khóa, lưu tiến độ, nhả khóa hồ sơ; không tạo nhóm đích hay job đăng', async () => {
  const searches = createGroupSearchRepository(ws.db);
  searches.enqueue(accountId, 'điện thoại cũ', 20);
  await runSearch(async (input) => {
    assert.equal(input.keyword, 'điện thoại cũ'); assert.equal(input.expectedIdentity, 'vanity:nick.a');
    assert.equal(input.profileDir, join(ws.dataDir, 'profiles', createAccountRepository(ws.db).profileKey(accountId)));
    input.onBatch([found(1), found(2)]);
    assert.equal(searches.latest(accountId)?.observedCount, 2);
    assert.throws(() => createLeaseRepository(ws.db).acquireBrowser(accountId, 'other', 1000), { code: 'conflict' });
    return { status: 'partial', reason: 'result_limit' };
  });
  assert.equal(searches.latest(accountId)?.status, 'partial');
  assert.equal(searches.results(accountId).length, 2);
  assert.equal(createLeaseRepository(ws.db).isBrowserBusy(accountId), false);
  assert.equal(ws.db.prepare('SELECT count(*) AS n FROM destinations').get()?.n, 0);
  assert.equal(ws.db.prepare('SELECT count(*) AS n FROM publish_jobs').get()?.n, 0);
});

test('tìm nhóm: phiên hết hạn ghi vào tài khoản; lỗi bất ngờ được ghi là lỗi quét; không có việc thì rảnh', async () => {
  assert.equal(await runSearch(async () => { throw new Error('must not run'); }), 'idle');
  const searches = createGroupSearchRepository(ws.db);
  searches.enqueue(accountId, 'abc', 5);
  await runSearch(async () => ({ status: 'blocked', reason: 'session_expired' }));
  assert.equal(searches.latest(accountId)?.reasonCode, 'session_expired');
  assert.equal(createAccountRepository(ws.db).list().find((row) => row.id === accountId)?.sessionStatus, 'login_required');
  createAccountRepository(ws.db).recordSession(accountId, 'logged_in');
  searches.enqueue(accountId, 'abc', 5);
  await runSearch(async () => { throw new Error('boom'); });
  assert.deepEqual([searches.latest(accountId)?.status, searches.latest(accountId)?.reasonCode], ['failed', 'scan_error']);
});

test('gửi yêu cầu: thành công tính vào hạn mức; mốc gửi ghi trước khi bấm; nhả khóa hồ sơ', async () => {
  const [first] = await seed(2);
  const joins = createGroupJoinRepository(ws.db);
  joins.enqueue({ accountId, searchResultIds: [first as string], maxCount: 1 });
  await runJoin(async (input) => {
    assert.equal(input.externalId, '100000000001'); assert.equal(input.expectedIdentity, 'vanity:nick.a');
    assert.equal(ws.db.prepare('SELECT send_started_at AS t FROM group_join_requests').get()?.t, null);
    assert.equal(input.beforeSend(), true);
    assert.notEqual(ws.db.prepare('SELECT send_started_at AS t FROM group_join_requests').get()?.t, null);
    return { status: 'requested', reason: null, clicked: true };
  });
  assert.deepEqual(joins.list(accountId).map((row) => [row.status, row.reasonCode]), [['requested', null]]);
  assert.equal(joins.quota(accountId).used, 1);
  assert.equal(createLeaseRepository(ws.db).isBrowserBusy(accountId), false);
  assert.equal(createGroupSearchRepository(ws.db).results(accountId)[0]?.request?.status, 'requested');
});

test('gửi yêu cầu: lỗi sau mốc gửi là unknown (không gửi lại); lỗi trước mốc là failed', async () => {
  const [first, second] = await seed(2);
  const joins = createGroupJoinRepository(ws.db, { random: () => 0 });
  joins.saveSettings({ dailyCap: 5, minGapSeconds: 60, maxGapSeconds: 60 });
  joins.enqueue({ accountId, searchResultIds: [first as string], maxCount: 1 });
  await runJoin(async (input) => { input.beforeSend(); throw new Error('mất kết nối sau khi bấm'); });
  assert.deepEqual(joins.list(accountId).map((row) => [row.status, row.reasonCode]), [['unknown', 'unconfirmed']]);
  assert.equal(joins.quota(accountId).used, 1);
  assert.throws(() => joins.enqueue({ accountId, searchResultIds: [first as string], maxCount: 1 }), { code: 'conflict' }); // không xếp lại nhóm chưa rõ kết quả
  joins.enqueue({ accountId, searchResultIds: [second as string], maxCount: 1 });
  assert.ok((joins.list(accountId).find((row) => row.status === 'queued')?.notBefore ?? 0) > Date.now()); // phải đợi đủ khoảng cách sau lần gửi trước
  ws.db.prepare('UPDATE group_join_requests SET send_started_at=send_started_at-120000 WHERE status=?').run('unknown');
  ws.db.prepare('UPDATE group_join_requests SET not_before=0 WHERE status=?').run('queued');
  await runJoin(async () => { throw new Error('lỗi trước khi bấm'); });
  assert.deepEqual(joins.list(accountId).map((row) => [row.status, row.reasonCode]).sort(), [['failed', 'join_error'], ['unknown', 'unconfirmed']]);
});

test('cảnh báo/checkpoint: dừng mọi yêu cầu còn chờ và ghi trạng thái phiên; hạn mức hết ngay trước khi bấm thì không gửi', async () => {
  const ids = await seed(3);
  const joins = createGroupJoinRepository(ws.db);
  joins.enqueue({ accountId, searchResultIds: ids, maxCount: 3 });
  await runJoin(async () => ({ status: 'failed', reason: 'checkpoint', clicked: false }));
  assert.deepEqual(joins.list(accountId).map((row) => [row.status, row.reasonCode]).sort(), [['failed', 'checkpoint'], ['skipped', 'batch_stopped'], ['skipped', 'batch_stopped']]);
  assert.equal(createAccountRepository(ws.db).list().find((row) => row.id === accountId)?.sessionStatus, 'verification_required');
  assert.equal(await runJoin(async () => { throw new Error('must not run'); }), 'idle');
});

test('hủy yêu cầu đang chờ không mở trình duyệt; tài khoản bị tạm dừng thì yêu cầu bị hủy, không gửi', async () => {
  const ids = await seed(2);
  const joins = createGroupJoinRepository(ws.db);
  joins.enqueue({ accountId, searchResultIds: [ids[0] as string], maxCount: 1 });
  const [queued] = joins.list(accountId); assert.ok(queued);
  joins.cancel(queued.id);
  assert.equal(await runJoin(async () => { throw new Error('must not run'); }), 'idle');
  joins.enqueue({ accountId, searchResultIds: [ids[1] as string], maxCount: 1 });
  createAccountRepository(ws.db).setPaused(accountId, true);
  await runJoin(async () => { throw new Error('must not run'); });
  assert.deepEqual(joins.list(accountId).map((row) => row.status), ['cancelled', 'cancelled']);
});
