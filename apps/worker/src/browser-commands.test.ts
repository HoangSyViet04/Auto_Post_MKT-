import assert from 'node:assert/strict';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import type { BrowserDriver, DriverInput, DriverResult } from '#browser';
import { createAccountRepository, createBrowserCommandRepository, createLeaseRepository } from '#storage';
import { createTestWorkspace } from '#test-support';
import { createBrowserCommandRunner } from './browser-commands.ts';

let workspace: ReturnType<typeof createTestWorkspace>;
let accounts: ReturnType<typeof createAccountRepository>;
let commands: ReturnType<typeof createBrowserCommandRepository>;
let leases: ReturnType<typeof createLeaseRepository>;
let a: string;
let b: string;
const calls: Array<{ kind: 'login' | 'verify'; profileDir: string }> = [];
let next: DriverResult | ((input: DriverInput) => Promise<DriverResult>) = { ok: true, identityRef: 'vanity:nick.a' };

const driver: BrowserDriver = {
  login: async (input) => { calls.push({ kind: 'login', profileDir: input.profileDir }); input.onTick(); return typeof next === 'function' ? next(input) : next; },
  verify: async (input) => { calls.push({ kind: 'verify', profileDir: input.profileDir }); input.onTick(); return typeof next === 'function' ? next(input) : next; },
};
const runner = () => createBrowserCommandRunner({ db: workspace.db, driver, workerId: 'worker-test', dataDir: workspace.dataDir });
const run = async (accountId: string, kind: 'login' | 'verify', result: typeof next) => {
  next = result;
  commands.enqueue(accountId, kind);
  assert.equal(await runner().processNext(), 'processed');
  const last = commands.latestFor(accountId);
  return { status: last?.status, code: last?.resultCode, account: accounts.get(accountId) };
};

beforeEach(() => {
  workspace = createTestWorkspace();
  accounts = createAccountRepository(workspace.db);
  commands = createBrowserCommandRepository(workspace.db);
  leases = createLeaseRepository(workspace.db);
  a = accounts.create({ label: 'Nick A' }).id;
  b = accounts.create({ label: 'Nick B' }).id;
  calls.length = 0;
  next = { ok: true, identityRef: 'vanity:nick.a' };
});
afterEach(() => { workspace.dispose(); });

test('không có lệnh thì rảnh; đăng nhập thành công lưu danh tính, phiên logged_in, dùng đúng thư mục hồ sơ riêng và nhả khóa', async () => {
  assert.equal(await runner().processNext(), 'idle');
  const login = await run(a, 'login', { ok: true, identityRef: 'vanity:nick.a' });
  assert.deepEqual([login.status, login.code, login.account.sessionStatus, login.account.identity?.remoteId], ['succeeded', 'identity_saved', 'logged_in', 'vanity:nick.a']);
  assert.equal(calls[0]?.profileDir, join(workspace.dataDir, 'profiles', accounts.profileKey(a))); // khóa ngẫu nhiên, không chứa nhãn/danh tính
  assert.equal(leases.isBrowserBusy(a), false);

  const again = await run(a, 'login', { ok: true, identityRef: 'vanity:nick.a' }); // đăng nhập lại cùng nick
  assert.equal(again.code, 'identity_confirmed');
  const other = await run(b, 'login', { ok: true, identityRef: 'vanity:nick.b' });
  assert.notEqual(calls.at(-1)?.profileDir, calls[0]?.profileDir); // tài khoản khác dùng hồ sơ khác
  assert.equal(other.account.identity?.remoteId, 'vanity:nick.b');
  assert.equal(accounts.get(a).identity?.remoteId, 'vanity:nick.a'); // không lẫn danh tính
});

test('đăng nhập nhầm nick: không đổi danh tính đã lưu; kiểm tra phiên đối chiếu danh tính và không tạo danh tính mới', async () => {
  await run(a, 'login', { ok: true, identityRef: 'vanity:nick.a' });
  const wrong = await run(a, 'login', { ok: true, identityRef: 'vanity:nick.khac' });
  assert.deepEqual([wrong.status, wrong.code, wrong.account.identity?.remoteId], ['failed', 'identity_mismatch', 'vanity:nick.a']);

  const match = await run(a, 'verify', { ok: true, identityRef: 'vanity:nick.a' });
  assert.deepEqual([match.status, match.code, match.account.sessionStatus], ['succeeded', 'match', 'logged_in']);
  const mismatch = await run(a, 'verify', { ok: true, identityRef: 'id:100000000000009' });
  assert.deepEqual([mismatch.status, mismatch.code, mismatch.account.sessionStatus], ['failed', 'identity_mismatch', 'unknown']); // dừng, không coi là đã đăng nhập
  assert.equal(accounts.get(a).identity?.remoteId, 'vanity:nick.a');

  const noBaseline = await run(b, 'verify', { ok: true, identityRef: 'vanity:nick.b' }); // chưa đăng nhập lần nào
  assert.deepEqual([noBaseline.status, noBaseline.code, noBaseline.account.identity], ['failed', 'no_identity_baseline', null]);
});

test('phân biệt cần đăng nhập, cần xác minh, mất mạng; hết giờ/đóng cửa sổ không đổi trạng thái phiên; hủy và lỗi driver', async () => {
  await run(a, 'login', { ok: true, identityRef: 'vanity:nick.a' });
  for (const [code, session] of [['login_required', 'login_required'], ['verification_required', 'verification_required'], ['network_error', 'network_error']] as const) {
    const result = await run(a, 'verify', { ok: false, code });
    assert.deepEqual([result.status, result.code, result.account.sessionStatus], ['failed', code, session]);
  }
  await run(a, 'verify', { ok: true, identityRef: 'vanity:nick.a' });
  for (const code of ['timeout', 'window_closed', 'identity_unreadable'] as const) {
    const result = await run(a, 'login', { ok: false, code });
    assert.deepEqual([result.status, result.code, result.account.sessionStatus], ['failed', code, 'logged_in']); // không suy ra bị khóa/mất phiên
  }

  const cancelled = await run(a, 'login', async (input) => {
    commands.requestCancel(commands.latestFor(a)?.id as string); // người dùng bấm hủy khi đang chờ
    return input.shouldCancel() ? { ok: false, code: 'cancelled' } : { ok: true, identityRef: 'x' };
  });
  assert.deepEqual([cancelled.status, cancelled.code], ['cancelled', 'cancelled']);

  const broken = await run(a, 'verify', async () => { throw new Error('secret-sentinel https://facebook.com/x'); });
  assert.deepEqual([broken.status, broken.code], ['failed', 'driver_error']); // chỉ mã cố định, không lưu thông điệp lỗi
  assert.equal(leases.isBrowserBusy(a), false); // lỗi cũng nhả khóa
  assert.equal(JSON.stringify(workspace.db.prepare('SELECT * FROM browser_commands').all()).includes('secret-sentinel'), false);
});

test('hồ sơ đang được dùng (khóa do bên khác giữ): không mở trình duyệt, báo profile_in_use; tài khoản khác không bị ảnh hưởng', async () => {
  leases.acquireBrowser(a, 'tien-trinh-khac', 120_000);
  const busy = await run(a, 'login', { ok: true, identityRef: 'vanity:nick.a' });
  assert.deepEqual([busy.status, busy.code, calls.length], ['failed', 'profile_in_use', 0]); // driver không được gọi
  assert.equal(leases.isBrowserBusy(a), true); // khóa của bên kia còn nguyên
  const free = await run(b, 'login', { ok: true, identityRef: 'vanity:nick.b' });
  assert.equal(free.status, 'succeeded');
});
