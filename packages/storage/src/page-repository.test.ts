import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { BusinessError, type BusinessErrorCode } from '#domain';
import { createTestWorkspace } from '#test-support';
import { createPageRepository } from './page-repository.ts';
import { createSecretStore } from './secret-store.ts';

const PAGE_TOKEN = 'EAAPAGETOKEN-2222222222222222222222222-bi-mat-rieng';
const NEW_TOKEN = 'EAANEWPAGETOKEN-9999999999999999999999999-moi';
let workspace: ReturnType<typeof createTestWorkspace>;
let secrets: ReturnType<typeof createSecretStore>;
let pages: ReturnType<typeof createPageRepository>;
const code = (expected: BusinessErrorCode) => (error: unknown) => error instanceof BusinessError && error.code === expected;
const input = (overrides: Partial<Parameters<typeof pages.connect>[0]> = {}) => ({ pageId: '107892312229541', name: 'Góc Nghiện Đồ Hay', token: PAGE_TOKEN, tasks: ['CREATE_CONTENT', 'MANAGE'], ...overrides });

beforeEach(() => {
  workspace = createTestWorkspace();
  secrets = createSecretStore(workspace.db, { dataDir: workspace.dataDir });
  pages = createPageRepository(workspace.db, { secrets });
});
afterEach(() => { workspace.dispose(); });

/** Mọi byte có thể chứa token: file DB (và WAL) cùng các file trong thư mục secrets. */
const diskBytes = () => {
  const files = [join(workspace.dataDir, 'db', 'test.sqlite'), join(workspace.dataDir, 'db', 'test.sqlite-wal')].filter(existsSync);
  const secretDir = join(workspace.dataDir, 'secrets');
  if (existsSync(secretDir)) for (const name of readdirSync(secretDir)) files.push(join(secretDir, name));
  return files.map((file) => readFileSync(file).toString('latin1') + readFileSync(file).toString('utf8')).join('\n');
};

test('kết nối Page: metadata đúng, đủ quyền thì canPost; token không có trong DB, file bí mật, danh sách hay JSON trả ra', async () => {
  const connected = await pages.connect(input());
  assert.deepEqual([connected.pageId, connected.name, connected.permissionStatus, connected.secretStatus, connected.canPost], ['107892312229541', 'Góc Nghiện Đồ Hay', 'allowed', 'available', true]);
  assert.deepEqual(pages.list().map((item) => item.id), [connected.id]);
  assert.equal(JSON.stringify([connected, pages.list()]).includes(PAGE_TOKEN), false);
  workspace.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  assert.equal(diskBytes().includes(PAGE_TOKEN), false, 'token không được nằm dạng rõ ở bất kỳ file nào');
  assert.deepEqual(await pages.revealToken(connected.id), { pageId: '107892312229541', token: PAGE_TOKEN }); // chỉ nội bộ lấy lại được
  const destination = workspace.db.prepare("SELECT channel,external_id,name FROM destinations WHERE id=?").get(connected.destinationId);
  assert.deepEqual([destination?.channel, destination?.external_id], ['page', '107892312229541']);
});

test('không có CREATE_CONTENT thì quyền bị từ chối và không đăng được (canPost=false)', async () => {
  const connected = await pages.connect(input({ tasks: ['ANALYZE', 'MODERATE'] }));
  assert.deepEqual([connected.permissionStatus, connected.canPost], ['denied', false]);
});

test('kết nối lại cùng Page: giữ một kết nối, thay token mới và thu hồi token cũ (không để token cũ mồ côi)', async () => {
  const first = await pages.connect(input());
  const oldSecretId = workspace.db.prepare('SELECT secret_ref_id FROM page_connections WHERE id=?').get(first.id)?.secret_ref_id as string;
  const second = await pages.connect(input({ token: NEW_TOKEN, name: 'Góc Nghiện Đồ Hay (đổi tên)' }));
  assert.equal(second.id, first.id);
  assert.equal(pages.list().length, 1);
  assert.equal(second.name, 'Góc Nghiện Đồ Hay (đổi tên)');
  assert.deepEqual(await pages.revealToken(first.id), { pageId: '107892312229541', token: NEW_TOKEN });
  assert.equal(workspace.db.prepare('SELECT status FROM secret_refs WHERE id=?').get(oldSecretId)?.status, 'revoked');
  await assert.rejects(secrets.get(oldSecretId), code('secret_unavailable'));
});

test('markChecked ghi trạng thái (hết hạn → không còn canPost); gỡ Page: lưu trữ, thu hồi token, không lấy lại được và không đổi sang Page khác', async () => {
  const connected = await pages.connect(input());
  const expired = pages.markChecked(connected.id, 'expired');
  assert.deepEqual([expired.permissionStatus, expired.canPost], ['expired', false]);
  assert.throws(() => pages.markChecked(connected.id, 'bogus' as never), code('invalid_input'));

  await pages.disconnect(connected.id);
  assert.deepEqual(pages.list(), []);
  await assert.rejects(pages.revealToken(connected.id), code('not_ready'));
  assert.equal(workspace.db.prepare('SELECT count(*) AS n FROM page_connections').get()?.n, 1); // lịch sử còn, không xóa
  workspace.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  await assert.rejects(pages.disconnect(connected.id), code('not_found')); // gỡ hai lần
  // kết nối lại sau khi gỡ: dùng lại đúng bản ghi cũ, hiện lại trong danh sách
  const again = await pages.connect(input({ token: NEW_TOKEN }));
  assert.equal(again.id, connected.id);
  assert.equal(pages.list().length, 1);
});

test('từ chối đầu vào sai: ID không phải số, tên trống, token quá ngắn, tasks sai kiểu; lỗi không để lại bản ghi hay token', async () => {
  for (const bad of [input({ pageId: 'abc' }), input({ pageId: '12' }), input({ name: '   ' }), input({ token: 'ngan' }), input({ tasks: 'CREATE_CONTENT' as never })]) {
    await assert.rejects(pages.connect(bad), code('invalid_input'));
  }
  assert.equal(workspace.db.prepare('SELECT count(*) AS n FROM page_connections').get()?.n, 0);
  assert.equal(workspace.db.prepare('SELECT count(*) AS n FROM secret_refs').get()?.n, 0);
  await assert.rejects(pages.revealToken('00000000-0000-4000-8000-000000000000'), code('not_found'));
});
