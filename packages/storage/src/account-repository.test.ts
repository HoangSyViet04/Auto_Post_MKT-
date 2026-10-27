import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { BusinessError, type BusinessErrorCode } from '#domain';
import { publishingFixture, createTestWorkspace } from '#test-support';
import { createAccountRepository } from './account-repository.ts';

let workspace: ReturnType<typeof createTestWorkspace>;
beforeEach(() => { workspace = createTestWorkspace(); });
afterEach(() => { workspace.dispose(); });
const code = (expected: BusinessErrorCode) => (error: unknown) => error instanceof BusinessError && error.code === expected;

test('thêm tối đa hai tài khoản kèm hồ sơ riêng; nhãn không trùng; đổi nhãn; chỗ trống dùng lại sau khi gỡ', () => {
  const accounts = createAccountRepository(workspace.db);
  const a = accounts.create({ label: '  Máy   bán  hàng 1 ' });
  const b = accounts.create({ label: 'Máy bán hàng 2' });
  assert.deepEqual([a.slot, b.slot], [1, 2]);
  assert.equal(a.label, 'Máy bán hàng 1'); // gọn khoảng trắng
  assert.deepEqual([a.identity, a.proxy, a.sessionStatus, a.paused, a.queuedJobs], [null, null, 'unknown', false, 0]);
  const profiles = workspace.db.prepare('SELECT directory_key FROM browser_profiles').all().map((row) => row.directory_key);
  assert.equal(new Set(profiles).size, 2); // mỗi tài khoản một hồ sơ trình duyệt riêng

  assert.throws(() => accounts.create({ label: 'Thứ ba' }), code('account_limit'));
  assert.throws(() => accounts.create({ label: 'MÁY BÁN HÀNG 2' }), code('conflict'));
  assert.throws(() => accounts.rename(a.id, 'máy bán hàng 2'), code('conflict'));
  assert.throws(() => accounts.create({ label: '   ' }), code('invalid_input'));
  assert.equal(accounts.rename(a.id, 'Máy bán hàng 1 (đổi)').label, 'Máy bán hàng 1 (đổi)');
  assert.equal(accounts.rename(a.id, 'Máy bán hàng 1 (đổi)').slot, 1); // đổi cùng nhãn của chính nó không xung đột

  accounts.remove(a.id);
  assert.deepEqual(accounts.list().map((account) => account.id), [b.id]);
  assert.equal(accounts.create({ label: 'Thay thế' }).slot, 1); // chỗ 1 được dùng lại
  assert.throws(() => accounts.get(a.id), code('not_found'));
  assert.throws(() => accounts.rename(a.id, 'x'), code('not_found'));
  assert.equal(workspace.db.prepare('SELECT count(*) AS n FROM accounts').get()?.n, 3); // bản gỡ vẫn được lưu
});

test('tạm dừng chỉ chặn đúng tài khoản đó; gỡ hủy tác vụ chưa gửi, thu hồi duyệt, không chuyển sang tài khoản khác', () => {
  const fixture = publishingFixture(workspace.db);
  const accounts = createAccountRepository(workspace.db);
  const other = accounts.create({ label: 'Tài khoản còn lại' }); // chiếm chỗ 2
  const job = fixture.enqueue();
  const status = (id: string) => workspace.db.prepare('SELECT status,stop_requested_at AS stop FROM publish_jobs WHERE id=?').get(id);

  assert.equal(accounts.list().find((account) => account.id === fixture.accountId)?.queuedJobs, 1);
  assert.equal(accounts.get(other.id).queuedJobs, 0);
  const paused = accounts.setPaused(fixture.accountId, true);
  assert.equal(paused.paused, true);
  assert.equal(accounts.get(other.id).paused, false);
  assert.equal(status(job.id)?.status, 'queued'); // dừng tài khoản không tự đổi trạng thái tác vụ; readiness chặn khi nhận
  assert.deepEqual(accounts.setAllPaused(true).map((account) => account.paused), [true, true]);
  assert.deepEqual(accounts.setAllPaused(false).map((account) => account.paused), [false, false]);
  assert.throws(() => accounts.setPaused(fixture.accountId, 'yes' as unknown as boolean), code('invalid_input'));

  accounts.remove(fixture.accountId);
  assert.equal(status(job.id)?.status, 'cancelled');
  assert.equal(workspace.db.prepare('SELECT reason_code FROM approval_revocations WHERE approval_id=?').get(fixture.approvalId)?.reason_code, 'account_removed');
  assert.equal(accounts.get(other.id).queuedJobs, 0); // tác vụ không bị chuyển sang tài khoản còn lại
  assert.equal(workspace.db.prepare("SELECT count(*) AS n FROM publish_jobs WHERE status='queued'").get()?.n, 0);
});
