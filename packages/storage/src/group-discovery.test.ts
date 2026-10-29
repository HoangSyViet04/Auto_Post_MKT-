import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { BusinessError, type BusinessErrorCode, DEFAULT_JOIN_SETTINGS, JOIN_WINDOW_MS } from '#domain';
import { createTestWorkspace } from '#test-support';
import { createAccountRepository } from './account-repository.ts';
import { createGroupJoinRepository } from './group-join-repository.ts';
import { createGroupSearchRepository, type ObservedSearchGroup } from './group-search-repository.ts';
import { createLeaseRepository } from './lease-repository.ts';

let ws: ReturnType<typeof createTestWorkspace>;
let accountId: string;
let clock = 1_000_000_000_000;
const code = (expected: BusinessErrorCode) => (error: unknown) => error instanceof BusinessError && error.code === expected;
const group = (n: number, patch: Partial<ObservedSearchGroup> = {}): ObservedSearchGroup =>
  ({ reference: `https://www.facebook.com/groups/10000000000${String(n).padStart(2, '0')}`, name: `Nhóm ${n}`, privacy: 'public', memberCount: 1000 + n, joinState: 'can_join', ...patch });
const repos = () => ({
  search: createGroupSearchRepository(ws.db, { clock: () => clock }),
  join: createGroupJoinRepository(ws.db, { clock: () => clock, random: () => 0.5 }),
});

beforeEach(() => {
  clock = 1_000_000_000_000;
  ws = createTestWorkspace();
  const accounts = createAccountRepository(ws.db);
  accountId = accounts.create({ label: 'Nick A' }).id;
  accounts.recordIdentity(accountId, 'vanity:nick.a'); accounts.recordSession(accountId, 'logged_in');
});
afterEach(() => ws.dispose());

/** Chạy một lần tìm hoàn chỉnh và trả id các kết quả theo thứ tự. */
function seed(items: ObservedSearchGroup[]): string[] {
  const { search } = repos();
  search.enqueue(accountId, 'mua bán điện thoại', 50);
  const claim = search.claimNext('w'); assert.ok(claim);
  search.saveBatch(claim.id, 'w', items);
  search.finish(claim.id, 'w', 'partial', 'no_more_results_seen');
  return search.results(accountId).map((row) => row.id);
}

test('tìm theo từ khóa: kiểm tra đầu vào, một lượt mỗi tài khoản, lưu tích lũy, không tạo nhóm đích', () => {
  const { search } = repos();
  for (const bad of ['', 'a', 'x'.repeat(101), '   ']) assert.throws(() => search.enqueue(accountId, bad, 10), code('invalid_input'));
  assert.throws(() => search.enqueue(accountId, 'ok', 0), code('invalid_input'));
  assert.throws(() => search.enqueue(accountId, 'ok', 201), code('invalid_input'));
  search.enqueue(accountId, '  mua   bán\tđiện thoại ', 2);
  assert.throws(() => search.enqueue(accountId, 'khác', 10), code('conflict'));
  assert.equal(search.latest(accountId)?.keyword, 'mua bán điện thoại');
  const claim = search.claimNext('w'); assert.ok(claim);
  assert.equal(claim.expectedIdentity, 'vanity:nick.a');
  search.saveBatch(claim.id, 'w', [group(1, { joinState: 'unknown', memberCount: null }), group(2)]);
  search.saveBatch(claim.id, 'w', [group(1), group(2), group(3), { reference: 'https://www.facebook.com/groups/slug-only', name: 'x', privacy: 'unknown', memberCount: null, joinState: 'can_join' }]);
  const rows = search.results(accountId);
  assert.equal(rows.length, 2); // giới hạn 2, bỏ nhóm chỉ có tên rút gọn
  assert.deepEqual([rows[0]?.joinState, rows[0]?.memberCount], ['can_join', 1001]); // vòng sau bổ sung thông tin
  assert.equal(search.latest(accountId)?.observedCount, 2);
  assert.equal(ws.db.prepare('SELECT count(*) AS n FROM destinations').get()?.n, 0); // tìm thấy không tạo nhóm đích
  search.cancel(claim.id);
  search.saveBatch(claim.id, 'w', [group(9)]);
  assert.equal(search.results(accountId).length, 2); // sau khi hủy không lưu thêm
  search.finish(claim.id, 'w', 'stopped', 'cancelled');
  assert.equal(search.latest(accountId)?.status, 'stopped');
  const b = createAccountRepository(ws.db).create({ label: 'B' }).id;
  assert.deepEqual(search.results(b), []); // không lẫn tài khoản
});

test('tìm: hồ sơ trình duyệt đang bận thì chưa nhận việc; tài khoản chưa đăng nhập không xếp được', () => {
  const search = createGroupSearchRepository(ws.db); // khóa hồ sơ dùng đồng hồ thật nên repository này cũng dùng đồng hồ thật
  const leases = createLeaseRepository(ws.db);
  search.enqueue(accountId, 'iphone', 10);
  const held = leases.acquireBrowser(accountId, 'other', 10_000);
  assert.equal(search.claimNext('w'), undefined);
  leases.release(held);
  assert.ok(search.claimNext('w'));
  const accounts = createAccountRepository(ws.db);
  const other = accounts.create({ label: 'C' }).id;
  assert.throws(() => search.enqueue(other, 'iphone', 10), code('not_ready'));
});

test('xếp yêu cầu tham gia: chỉ nhóm có thể tham gia, tối đa theo số nhập, hạn mức 24 giờ, không trùng', () => {
  const { join } = repos();
  const ids = seed([group(1), group(2), group(3), group(4, { joinState: 'joined' }), group(5), group(6), group(7)]);
  assert.equal(join.settings().dailyCap, 5);
  assert.throws(() => join.enqueue({ accountId, searchResultIds: [ids[3] as string], maxCount: 5 }), code('invalid_input')); // đã là thành viên
  assert.throws(() => join.enqueue({ accountId, searchResultIds: [ids[0] as string, ids[1] as string], maxCount: 1 }), code('invalid_input')); // tick nhiều hơn số nhập
  assert.throws(() => join.enqueue({ accountId, searchResultIds: [], maxCount: 5 }), code('invalid_input'));
  assert.throws(() => join.enqueue({ accountId, searchResultIds: [ids[0] as string, ids[0] as string], maxCount: 5 }), code('invalid_input'));
  assert.throws(() => join.enqueue({ accountId, searchResultIds: ['11111111-1111-1111-1111-111111111111'], maxCount: 5 }), code('not_found'));
  const batch = join.enqueue({ accountId, searchResultIds: [ids[0] as string, ids[1] as string, ids[2] as string], maxCount: 3 });
  assert.equal(batch.count, 3); assert.equal(batch.firstAt, clock);
  const listed = join.list(accountId).filter((row) => row.batchId === batch.batchId).map((row) => row.notBefore).sort((x, y) => x - y);
  assert.deepEqual(listed, [clock, clock + 270_000, clock + 540_000]); // random=0.5 → 270 giây giữa hai lần
  assert.throws(() => join.enqueue({ accountId, searchResultIds: [ids[0] as string], maxCount: 1 }), code('conflict')); // đã có yêu cầu
  assert.throws(() => join.enqueue({ accountId, searchResultIds: [ids[4] as string, ids[5] as string, ids[6] as string], maxCount: 3 }), code('join_limit')); // còn 2 chỗ
  assert.equal(join.quota(accountId).remaining, 5); // mới xếp chưa gửi nên chưa tính vào hạn mức đã dùng
});

test('worker nhận yêu cầu theo giờ, theo khoảng cách và hạn mức; mốc gửi chỉ ghi khi còn đủ điều kiện', () => {
  const { join } = repos();
  join.saveSettings({ ...DEFAULT_JOIN_SETTINGS, dailyCap: 2, minGapSeconds: 60, maxGapSeconds: 60 });
  const ids = seed([group(1), group(2), group(3)]);
  join.enqueue({ accountId, searchResultIds: [ids[0] as string, ids[1] as string], maxCount: 2 });
  const first = join.claimNext('w'); assert.ok(first);
  assert.equal(join.claimNext('w2'), undefined); // đang chạy một yêu cầu của tài khoản này
  assert.equal(join.markSendStarted(first.id, 'w'), true);
  join.finish(first.id, 'w', 'requested', null);
  assert.equal(join.claimNext('w'), undefined); // chưa tới giờ (60 giây sau)
  clock += 60_000;
  const second = join.claimNext('w'); assert.ok(second);
  assert.equal(join.markSendStarted(second.id, 'w'), true);
  join.finish(second.id, 'w', 'requested', null);
  assert.deepEqual(join.quota(accountId), { used: 2, pending: 0, cap: 2, remaining: 0, nextFreeAt: clock - 60_000 + JOIN_WINDOW_MS });
  assert.throws(() => join.enqueue({ accountId, searchResultIds: [ids[2] as string], maxCount: 1 }), code('join_limit'));
  clock += JOIN_WINDOW_MS - 60_000; // lần gửi đầu ra khỏi cửa sổ 24 giờ
  assert.equal(join.quota(accountId).remaining, 1);
});

test('hạn mức bị siết sau khi xếp: yêu cầu chờ bị bỏ qua, không bấm', () => {
  const { join } = repos();
  const ids = seed([group(1), group(2), group(3)]);
  join.enqueue({ accountId, searchResultIds: [ids[0] as string, ids[1] as string, ids[2] as string], maxCount: 3 });
  const first = join.claimNext('w'); assert.ok(first);
  assert.equal(join.markSendStarted(first.id, 'w'), true);
  join.finish(first.id, 'w', 'requested', null);
  join.saveSettings({ ...DEFAULT_JOIN_SETTINGS, dailyCap: 1, minGapSeconds: 60, maxGapSeconds: 60 });
  clock += 600_000;
  assert.equal(join.claimNext('w'), undefined);
  assert.deepEqual(join.list(accountId).filter((row) => row.status === 'skipped').map((row) => row.reasonCode), ['daily_cap', 'daily_cap']);
});

test('gửi bị chặn trước mốc: hủy khi đang chạy, đổi danh tính; không đủ khoảng cách thì không ghi mốc', () => {
  const { join } = repos();
  const ids = seed([group(1), group(2)]);
  join.enqueue({ accountId, searchResultIds: [ids[0] as string], maxCount: 1 });
  const claim = join.claimNext('w'); assert.ok(claim);
  join.cancel(claim.id);
  assert.equal(join.shouldCancel(claim), true);
  assert.equal(join.markSendStarted(claim.id, 'w'), false);
  assert.equal(ws.db.prepare('SELECT send_started_at AS t FROM group_join_requests WHERE id=?').get(claim.id)?.t, null);
  join.finish(claim.id, 'w', 'cancelled', 'cancelled');
  assert.throws(() => join.finish(claim.id, 'w', 'cancelled', 'cancelled'), code('claim_lost'));
  createAccountRepository(ws.db).setPaused(accountId, true);
  assert.throws(() => join.enqueue({ accountId, searchResultIds: [ids[1] as string], maxCount: 1 }), code('not_ready'));
});

test('lý do dừng (cảnh báo/checkpoint) bỏ qua mọi yêu cầu chờ; worker mất sau mốc gửi là unknown, trước mốc là lỗi', () => {
  const { join } = repos();
  const ids = seed([group(1), group(2), group(3)]);
  join.enqueue({ accountId, searchResultIds: ids.slice(0, 3) as string[], maxCount: 3 });
  const first = join.claimNext('w'); assert.ok(first);
  assert.equal(join.markSendStarted(first.id, 'w'), true);
  join.finish(first.id, 'w', 'failed', 'action_blocked');
  assert.deepEqual(join.list(accountId).map((row) => [row.status, row.reasonCode]).sort(),
    [['failed', 'action_blocked'], ['skipped', 'batch_stopped'], ['skipped', 'batch_stopped']]);
  assert.equal(join.quota(accountId).used, 0); // failed không tính vào hạn mức đã dùng

  clock += 3_600_000;
  const more = seed([group(11), group(12)]);
  join.enqueue({ accountId, searchResultIds: more as string[], maxCount: 2 });
  const lost = join.claimNext('w'); assert.ok(lost);
  assert.equal(join.markSendStarted(lost.id, 'w'), true);
  clock += 200_000; // worker không còn nhịp
  join.claimNext('w2');
  assert.equal(join.list(accountId).find((row) => row.id === lost.id)?.status, 'unknown');
  assert.equal(join.quota(accountId).used, 1); // unknown vẫn tính vào hạn mức
  assert.equal(join.cancelQueued(accountId) >= 0, true);
});

test('cài đặt hạn mức: giá trị sai bị từ chối; lưu và đọc lại đúng', () => {
  const { join } = repos();
  for (const bad of [{ dailyCap: 0, minGapSeconds: 60, maxGapSeconds: 60 }, { dailyCap: 31, minGapSeconds: 60, maxGapSeconds: 60 },
    { dailyCap: 5, minGapSeconds: 30, maxGapSeconds: 60 }, { dailyCap: 5, minGapSeconds: 120, maxGapSeconds: 60 }, { dailyCap: 1.5, minGapSeconds: 60, maxGapSeconds: 60 }]) {
    assert.throws(() => join.saveSettings({ ...DEFAULT_JOIN_SETTINGS, ...bad }), code('invalid_input'));
  }
  const saved = { ...DEFAULT_JOIN_SETTINGS, dailyCap: 8, minGapSeconds: 120, maxGapSeconds: 240, agreeRules: false, defaultAnswer: 'Mình muốn mua bán điện thoại' };
  assert.deepEqual(join.saveSettings(saved), saved);
  assert.throws(() => join.saveSettings({ ...saved, defaultAnswer: 'x'.repeat(501) }), code('invalid_input'));
});
