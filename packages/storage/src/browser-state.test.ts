import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { BusinessError, type BusinessErrorCode } from '#domain';
import { createTestWorkspace } from '#test-support';
import { createAccountRepository } from './account-repository.ts';
import { createBrowserCommandRepository } from './browser-command-repository.ts';
import { createLeaseRepository } from './lease-repository.ts';

let workspace: ReturnType<typeof createTestWorkspace>;
const clock = { now: 1_700_000_000_000 };
const options = { clock: () => clock.now };
let accounts: ReturnType<typeof createAccountRepository>;
let commands: ReturnType<typeof createBrowserCommandRepository>;
let leases: ReturnType<typeof createLeaseRepository>;
let a: string;
let b: string;
beforeEach(() => {
  clock.now = 1_700_000_000_000;
  workspace = createTestWorkspace();
  accounts = createAccountRepository(workspace.db, options);
  commands = createBrowserCommandRepository(workspace.db, options);
  leases = createLeaseRepository(workspace.db, options);
  a = accounts.create({ label: 'Nick A' }).id;
  b = accounts.create({ label: 'Nick B' }).id;
});
afterEach(() => { workspace.dispose(); });
const code = (expected: BusinessErrorCode) => (error: unknown) => error instanceof BusinessError && error.code === expected;

test('lệnh trình duyệt: mỗi tài khoản một lệnh đang hoạt động, nhận theo thứ tự và đúng một worker, hủy, mất worker, kết thúc đúng chủ', () => {
  const first = commands.enqueue(a, 'login');
  assert.throws(() => commands.enqueue(a, 'verify'), code('conflict')); // đã có lệnh đang chờ cho tài khoản này
  clock.now += 10;
  const second = commands.enqueue(b, 'verify'); // tài khoản khác không bị ảnh hưởng
  assert.throws(() => commands.enqueue('00000000-0000-4000-8000-000000000000', 'login'), code('not_found'));
  assert.throws(() => commands.enqueue(a, 'post' as never), code('invalid_input'));

  const claimed = commands.claimNext('worker-1');
  assert.deepEqual(claimed, { id: first.id, accountId: a, kind: 'login' }); // cũ nhất trước
  assert.deepEqual(commands.claimNext('worker-2')?.id, second.id);
  assert.equal(commands.claimNext('worker-3'), undefined); // không còn lệnh để nhận
  assert.throws(() => commands.finish(first.id, 'worker-2', 'succeeded', 'ok'), code('claim_lost')); // sai chủ
  assert.throws(() => commands.finish(first.id, 'worker-1', 'succeeded', 'Bad Code!'), code('invalid_input'));

  assert.equal(commands.requestCancel(first.id), 'cancel_requested'); // đang chạy: chỉ ghi yêu cầu
  assert.equal(commands.isCancelRequested(first.id), true);
  commands.finish(first.id, 'worker-1', 'cancelled', 'cancelled');
  assert.equal(commands.latestFor(a)?.status, 'cancelled');
  assert.throws(() => commands.requestCancel(first.id), code('invalid_transition')); // đã xong
  const again = commands.enqueue(a, 'verify'); // xong rồi thì tạo lệnh mới được
  assert.equal(commands.requestCancel(again.id), 'cancelled'); // chưa chạy: hủy ngay
  assert.equal(commands.latestFor(a)?.resultCode, 'cancelled_before_start');

  // worker chết giữa chừng: lệnh đang chạy quá lâu không có nhịp sống bị đánh dấu failed/worker_lost
  commands.heartbeat(second.id, 'worker-2');
  clock.now += 21 * 60_000;
  assert.equal(commands.claimNext('worker-4'), undefined);
  assert.deepEqual([commands.latestFor(b)?.status, commands.latestFor(b)?.resultCode], ['failed', 'worker_lost']);
  assert.throws(() => commands.heartbeat(second.id, 'worker-2'), code('claim_lost'));
  assert.equal(commands.enqueue(b, 'login').id.length, 36); // tài khoản được giải phóng sau khi lệnh chết
});

test('khóa trình duyệt theo tài khoản: loại trừ, chủ cũ vào lại được, hết hạn thì nhường và tăng fence, mất quyền thì báo', () => {
  const first = leases.acquireBrowser(a, 'worker-1', 30_000);
  assert.equal(first.fence, 1);
  assert.equal(leases.isBrowserBusy(a), true);
  assert.throws(() => leases.acquireBrowser(a, 'worker-2', 30_000), code('conflict'));
  assert.equal(leases.acquireBrowser(a, 'worker-1', 30_000).fence, 1); // cùng chủ vào lại, fence giữ nguyên
  assert.equal(leases.acquireBrowser(b, 'worker-2', 30_000).fence, 1); // tài khoản khác độc lập

  clock.now += 31_000; // hết hạn
  assert.equal(leases.isBrowserBusy(a), false);
  const taken = leases.acquireBrowser(a, 'worker-2', 30_000);
  assert.equal(taken.fence, 2); // đổi chủ → fence tăng
  assert.throws(() => leases.renew(first, 30_000), code('claim_lost')); // chủ cũ không gia hạn được nữa
  assert.equal(leases.renew(taken, 60_000).expiresAt, clock.now + 60_000);
  leases.release(taken);
  assert.equal(leases.isBrowserBusy(a), false);
  assert.equal(leases.acquireBrowser(a, 'worker-1', 30_000).fence, 3); // fence không bao giờ giảm
  assert.throws(() => leases.acquireBrowser(a, 'x', 10), code('invalid_input'));
});

test('danh tính và phiên: ghi một lần, khác nick thì không tự đổi; phiên cập nhật; gỡ tài khoản hủy lệnh trình duyệt', () => {
  assert.equal(accounts.identityRef(a), null);
  assert.equal(accounts.recordIdentity(a, 'vanity:nick.a'), 'created');
  assert.equal(accounts.recordIdentity(a, 'vanity:nick.a'), 'same');
  assert.equal(accounts.recordIdentity(a, 'id:100000000000001'), 'different'); // không tự ghi đè danh tính đã xác nhận
  assert.equal(accounts.identityRef(a), 'vanity:nick.a');
  assert.equal(accounts.get(a).identity?.remoteId, 'vanity:nick.a');
  assert.equal(accounts.get(b).identity, null); // không lẫn tài khoản

  accounts.recordSession(a, 'verification_required');
  assert.equal(accounts.get(a).sessionStatus, 'verification_required');
  assert.throws(() => accounts.recordSession(a, 'banned' as never), code('invalid_input'));
  assert.match(accounts.profileKey(a), /^[0-9a-f-]{36}$/u);
  assert.notEqual(accounts.profileKey(a), accounts.profileKey(b)); // mỗi tài khoản một thư mục hồ sơ

  const queued = commands.enqueue(a, 'login');
  assert.equal(accounts.get(a).browser?.status, 'queued');
  accounts.remove(a);
  assert.equal(workspace.db.prepare('SELECT status FROM browser_commands WHERE id=?').get(queued.id)?.status, 'cancelled');
  assert.equal(workspace.db.prepare('SELECT result_code FROM browser_commands WHERE id=?').get(queued.id)?.result_code, 'account_removed');
});
