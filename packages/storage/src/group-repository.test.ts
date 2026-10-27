import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { BusinessError, type BusinessErrorCode } from '#domain';
import { createTestWorkspace } from '#test-support';
import { createAccountRepository } from './account-repository.ts';
import { createGroupRepository } from './group-repository.ts';

let workspace: ReturnType<typeof createTestWorkspace>;
let accounts: ReturnType<typeof createAccountRepository>;
let groups: ReturnType<typeof createGroupRepository>;
let a: string;
let b: string;
beforeEach(() => {
  workspace = createTestWorkspace();
  accounts = createAccountRepository(workspace.db);
  groups = createGroupRepository(workspace.db);
  a = accounts.create({ label: 'Bán hàng 1' }).id;
  b = accounts.create({ label: 'Bán hàng 2' }).id;
});
afterEach(() => { workspace.dispose(); });
const code = (expected: BusinessErrorCode) => (error: unknown) => error instanceof BusinessError && error.code === expected;
const ID = '123456789012';

test('một nhóm chỉ có một bản ghi dù nhiều tài khoản; quan hệ riêng từng tài khoản; không ghi đè dữ liệu đã có', () => {
  const first = groups.add({ reference: `https://m.facebook.com/groups/${ID}/?ref=x`, accountId: a, name: 'Mua bán iPhone cũ Hà Nội', membership: 'joined', permission: 'allowed' });
  const second = groups.add({ reference: ID, accountId: b, name: 'Tên khác', rulesNote: 'Cấm quảng cáo', membership: 'not_joined' });
  assert.equal(first.created, true); assert.equal(second.created, false); assert.equal(second.id, first.id);
  assert.equal(workspace.db.prepare("SELECT count(*) AS n FROM destinations WHERE channel='group'").get()?.n, 1);

  const [item] = groups.list().items;
  assert.equal(item?.name, 'Mua bán iPhone cũ Hà Nội'); // tên cũ được giữ
  assert.equal(item?.rulesNote, 'Cấm quảng cáo'); // chỗ trống thì được điền
  const byAccount = Object.fromEntries((item?.accounts ?? []).map((relation) => [relation.accountId, relation]));
  assert.deepEqual([byAccount[a]?.membership, byAccount[a]?.eligible, byAccount[a]?.source], ['joined', true, 'manual']);
  assert.deepEqual([byAccount[b]?.membership, byAccount[b]?.eligible], ['not_joined', false]);
  assert.deepEqual(byAccount[b]?.blockedBy, ['not_joined', 'no_permission']);

  for (const bad of ['', 'abc', 'https://example.com/groups/123456789', 'https://www.facebook.com/groups/feed']) {
    assert.throws(() => groups.add({ reference: bad, accountId: a }), code('invalid_input'));
  }
  assert.throws(() => groups.add({ reference: ID, accountId: '00000000-0000-4000-8000-000000000000' }), code('not_found'));
  assert.throws(() => groups.add({ reference: ID, accountId: a, membership: 'member' as never }), code('invalid_input'));
});

test('nhóm chỉ có tên rút gọn được lưu nhưng không đủ điều kiện đăng; lý do chặn được báo đủ', () => {
  const slug = groups.add({ reference: 'facebook.com/groups/Muaban.iPhone', accountId: a, membership: 'joined', permission: 'allowed' });
  assert.equal(groups.add({ reference: 'https://www.facebook.com/groups/muaban.iphone/', accountId: b }).id, slug.id); // cùng link → cùng nhóm
  const item = groups.list().items.find((group) => group.id === slug.id);
  assert.equal(item?.externalId, null);
  assert.deepEqual(item?.accounts.find((relation) => relation.accountId === a)?.blockedBy, ['no_external_id']);

  const full = groups.add({ reference: ID, accountId: a, membership: 'joined', permission: 'allowed' }).id;
  const eligible = () => groups.list().items.find((group) => group.id === full)?.accounts.find((relation) => relation.accountId === a);
  assert.equal(eligible()?.eligible, true);
  groups.update(full, { curation: 'unsuitable' });
  assert.deepEqual(eligible()?.blockedBy, ['unsuitable']);
  groups.update(full, { curation: 'preferred' });
  accounts.setPaused(a, true);
  assert.deepEqual(eligible()?.blockedBy, ['account_paused']);
  accounts.setPaused(a, false);
  groups.setRelation(full, a, { permission: 'denied' });
  assert.deepEqual(eligible()?.blockedBy, ['no_permission']);
  groups.setRelation(full, a, { permission: 'allowed' });
  groups.setArchived(full, true);
  assert.equal(groups.list().items.some((group) => group.id === full), false); // ẩn khỏi danh sách mặc định
  assert.deepEqual(groups.list({ includeArchived: true }).items.find((group) => group.id === full)?.accounts[0]?.blockedBy, ['archived']);
  groups.setArchived(full, false);
  assert.equal(eligible()?.eligible, true);
});

test('lọc theo tài khoản không lẫn nhóm của tài khoản kia; tìm không dấu; lọc khu vực, tham gia, ưu tiên; phân trang', () => {
  const hn = groups.add({ reference: '111111111', accountId: a, name: 'Chợ điện thoại Hà Nội', region: 'Hà Nội', membership: 'joined' }).id;
  const sg = groups.add({ reference: '222222222', accountId: b, name: 'iPhone Sài Gòn', region: 'TP.HCM', membership: 'not_joined', curation: 'preferred' }).id;
  groups.add({ reference: '333333333', accountId: a, name: 'Group khác', topic: 'Laptop' });

  assert.deepEqual(groups.list({ accountId: a }).items.map((g) => g.id).sort(), groups.list().items.filter((g) => g.id !== sg).map((g) => g.id).sort());
  assert.deepEqual(groups.list({ accountId: b }).items.map((g) => g.id), [sg]);
  assert.ok(groups.list({ accountId: a }).items.every((g) => g.accounts.every((r) => r.accountId === a)));
  assert.deepEqual(groups.list({ q: 'ha noi' }).items.map((g) => g.id), [hn]);
  assert.deepEqual(groups.list({ q: 'IPHONE sai gon' }).items.map((g) => g.id), [sg]); // khác hoa/thường và không dấu vẫn khớp
  assert.deepEqual(groups.list({ q: 'hà nội iphone' }).items.map((g) => g.id), []); // cụm từ phải khớp liền nhau
  assert.deepEqual(groups.list({ q: 'iphone' }).items.map((g) => g.id), [sg]);
  assert.deepEqual(groups.list({ region: 'hcm' }).items.map((g) => g.id), [sg]);
  assert.deepEqual(groups.list({ membership: 'joined' }).items.map((g) => g.id), [hn]);
  assert.deepEqual(groups.list({ curation: 'preferred' }).items.map((g) => g.id), [sg]);
  const page = groups.list({ pageSize: 2, page: 2 });
  assert.deepEqual([page.total, page.items.length], [3, 1]);
  assert.throws(() => groups.list({ pageSize: 101 }), code('invalid_input'));
  assert.throws(() => groups.update(hn, {}), code('invalid_input'));
  assert.throws(() => groups.update(hn, { curation: 'best' as never }), code('invalid_input'));
  assert.throws(() => groups.update('00000000-0000-4000-8000-000000000000', { name: 'x' }), code('not_found'));
});

test('nhập kết quả đọc nhóm đã tham gia: đặt joined + nguồn joined_scan, không đụng quyền đăng, chạy lại không trùng, nhóm chưa có ID số và mục lạ bị bỏ qua', () => {
  const known = groups.add({ reference: ID, accountId: a, name: 'Tên người dùng đặt', membership: 'not_joined', permission: 'allowed' }).id;
  const items = [
    { reference: `https://www.facebook.com/groups/${ID}`, name: 'Tên đọc được' }, // đã có → giữ tên cũ, cập nhật tham gia
    { reference: 'https://www.facebook.com/groups/222222222', name: 'Nhóm mới có ID' },
    { reference: 'https://www.facebook.com/groups/muaban.iphone', name: 'Nhóm chỉ có tên rút gọn' },
    { reference: 'https://example.com/groups/333333333', name: 'Không phải Facebook' },
    { reference: 'không phải link', name: null },
  ];
  assert.deepEqual(groups.importObserved(a, items), { created: 1, existing: 1, skipped: 2, withoutId: 1 });
  assert.deepEqual(groups.importObserved(a, items), { created: 0, existing: 2, skipped: 2, withoutId: 1 }); // chạy lại không tạo trùng
  assert.equal(workspace.db.prepare("SELECT count(*) AS n FROM destinations WHERE channel='group'").get()?.n, 2); // nhóm tên rút gọn không được nhập

  const list = groups.list({ accountId: a, pageSize: 100 }).items;
  const old = list.find((group) => group.id === known);
  assert.equal(old?.name, 'Tên người dùng đặt');
  assert.deepEqual([old?.accounts[0]?.membership, old?.accounts[0]?.permission, old?.accounts[0]?.source], ['joined', 'allowed', 'joined_scan']);
  assert.equal(old?.accounts[0]?.eligible, true); // quyền đăng người dùng đã khai báo được giữ nguyên
  const fresh = list.find((group) => group.name === 'Nhóm mới có ID');
  assert.deepEqual([fresh?.accounts[0]?.membership, fresh?.accounts[0]?.permission], ['joined', 'unknown']); // quét không suy ra quyền đăng
  assert.deepEqual(fresh?.accounts[0]?.blockedBy, ['no_permission']);
  assert.equal(list.some((group) => group.name === 'Nhóm chỉ có tên rút gọn'), false);
  assert.equal(groups.list({ accountId: b }).total, 0); // không lẫn sang tài khoản khác
  assert.throws(() => groups.importObserved('00000000-0000-4000-8000-000000000000', items), code('not_found'));
});

test('đích trang cá nhân: cần danh tính đã xác nhận, mỗi danh tính một bản ghi, chạy lại không trùng, không lẫn trong danh sách nhóm', () => {
  assert.throws(() => groups.ensureProfileDestination(a), code('not_ready')); // chưa đăng nhập/xác nhận danh tính
  accounts.recordIdentity(a, 'vanity:nick.a');
  accounts.recordIdentity(b, 'vanity:nick.b');
  const first = groups.ensureProfileDestination(a);
  assert.deepEqual([first.created, groups.ensureProfileDestination(a).id, groups.ensureProfileDestination(a).created], [true, first.id, false]);
  assert.notEqual(groups.ensureProfileDestination(b).id, first.id);
  const row = workspace.db.prepare('SELECT channel,external_id FROM destinations WHERE id=?').get(first.id);
  assert.deepEqual([row?.channel, row?.external_id], ['profile', 'vanity:nick.a']);
  const relation = workspace.db.prepare('SELECT membership_status,posting_permission FROM account_destinations WHERE account_id=? AND destination_id=?').get(a, first.id);
  assert.deepEqual([relation?.membership_status, relation?.posting_permission], ['not_applicable', 'allowed']);
  assert.equal(groups.list().total, 0); // danh sách nhóm không chứa đích trang cá nhân
});
