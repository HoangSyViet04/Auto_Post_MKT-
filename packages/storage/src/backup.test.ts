import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { createTestWorkspace, seedOfflineScenario } from '#test-support';
import { createBackup, EXCLUDED_FROM_BACKUP, restoreBackup, verifyBackup } from './backup.ts';
import { openDatabase } from './db.ts';

let workspace: ReturnType<typeof createTestWorkspace>;
let scenario: Awaited<ReturnType<typeof seedOfflineScenario>>;
let scratch: string;
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? files(join(dir, entry.name)).map((f) => join(entry.name, f)) : [entry.name]));

beforeEach(async () => {
  workspace = createTestWorkspace();
  scenario = await seedOfflineScenario(workspace);
  scenario.enqueue('b1'); // một job đang chờ để kiểm tra "lịch không tự chạy" sau phục hồi
  scratch = mkdtempSync(join(tmpdir(), 'apm sao lưu '));
  // Dữ liệu cục bộ KHÔNG được sao lưu: hồ sơ trình duyệt (cookie), khóa/bí mật, log
  for (const [dir, name, content] of [['profiles/abc', 'Cookies', 'COOKIE-SENTINEL'], ['secrets', 'key.bin', 'SECRET-SENTINEL'], ['logs', 'app.log', 'LOG-SENTINEL']] as const) {
    mkdirSync(join(workspace.dataDir, dir), { recursive: true });
    writeFileSync(join(workspace.dataDir, dir, name), content);
  }
});
afterEach(() => { workspace.dispose(); rmSync(scratch, { recursive: true, force: true }); });

test('sao lưu: DB nhất quán + ảnh tham chiếu + manifest mã băm; không chứa cookie/hồ sơ/khóa/log; kiểm tra đạt', async () => {
  const out = join(scratch, 'bản sao lưu');
  const manifest = await createBackup(workspace.db, { dataDir: workspace.dataDir, outDir: out });
  assert.equal(manifest.media.length, 1);
  assert.deepEqual(manifest.missingMedia, []);
  assert.deepEqual([...manifest.excluded], [...EXCLUDED_FROM_BACKUP]);
  assert.equal(verifyBackup(out).ok, true);
  const all = files(out);
  assert.deepEqual(all.filter((name) => /cookie|key\.bin|app\.log|profiles|secrets/iu.test(name)), []);
  for (const name of all) assert.equal(readFileSync(join(out, name)).includes('SENTINEL'), false, name); // không có dữ liệu nhạy cảm nào
  assert.equal(manifest.schemaVersion, 4);
  await assert.rejects(createBackup(workspace.db, { dataDir: workspace.dataDir, outDir: out }), /backup_dir_not_empty/u); // không ghi đè bản đã có
});

test('bản sao lưu hỏng hoặc dở dang bị từ chối và dữ liệu hiện tại không bị đụng tới: sai mã băm ảnh/DB, thiếu manifest', async () => {
  const out = join(scratch, 'sao-luu');
  await createBackup(workspace.db, { dataDir: workspace.dataDir, outDir: out });
  const target = join(scratch, 'du-lieu-dich');
  mkdirSync(target);
  writeFileSync(join(target, 'giu-nguyen.txt'), 'dữ liệu tốt');
  const imageFile = join(out, 'media', readdirSync(join(out, 'media'))[0] as string);
  const original = readFileSync(imageFile);
  writeFileSync(imageFile, Buffer.concat([original, Buffer.from('x')])); // ảnh bị sửa
  assert.match(verifyBackup(out).problems.join(' '), /mã băm hoặc kích thước không khớp/u);
  assert.throws(() => restoreBackup({ backupDir: out, targetDataDir: target, dbFileName: 'development.sqlite', replace: true }), /backup_invalid/u);
  assert.equal(readFileSync(join(target, 'giu-nguyen.txt'), 'utf8'), 'dữ liệu tốt'); // dữ liệu tốt không bị ghi đè bằng bản hỏng
  assert.deepEqual(readdirSync(scratch).filter((name) => name.includes('restoring')), []); // không để lại vùng tạm

  writeFileSync(imageFile, original);
  writeFileSync(join(out, 'db.sqlite'), 'không phải SQLite');
  assert.equal(verifyBackup(out).ok, false);
  rmSync(join(out, 'manifest.json'));
  assert.match(verifyBackup(out).problems[0] ?? '', /manifest/u); // bản dở dang
});

test('phục hồi sang máy mới: đủ máy/ảnh/lịch sử; lịch KHÔNG tự chạy (job chờ → tạm dừng); tài khoản phải đăng nhập lại; không có hồ sơ/khóa', async () => {
  const out = join(scratch, 'sao-luu');
  await createBackup(workspace.db, { dataDir: workspace.dataDir, outDir: out });
  const target = join(scratch, 'may-moi');
  const result = restoreBackup({ backupDir: out, targetDataDir: target, dbFileName: 'development.sqlite' });
  assert.deepEqual([result.mediaRestored, result.pausedJobs, result.accountsNeedLogin, result.keptLocalState, result.previousKeptAt], [1, 1, 1, false, null]);

  const restored = openDatabase(join(target, 'db', 'development.sqlite'));
  try {
    assert.equal(restored.prepare('SELECT count(*) AS n FROM products').get()?.n, 1);
    assert.equal(restored.prepare("SELECT status FROM publish_jobs").get()?.status, 'paused'); // không tự chạy sau phục hồi
    assert.equal(restored.prepare('SELECT session_status FROM accounts').get()?.session_status, 'login_required');
    assert.equal(restored.prepare("SELECT action_code FROM activity_log WHERE action_code='restored_paused'").get()?.action_code, 'restored_paused');
    assert.ok(restored.prepare("SELECT value FROM app_meta WHERE key='restored_from'").get()?.value);
  } finally { restored.close(); }
  const key = workspace.db.prepare("SELECT storage_key FROM media WHERE state='ready'").get()?.storage_key as string;
  assert.equal(statSync(join(target, 'media', 'objects', `${key}.blob`)).size > 0, true);
  assert.equal(existsSync(join(target, 'profiles')) || existsSync(join(target, 'secrets')), false);
});

test('phục hồi vào thư mục đích đã tồn tại nhưng rỗng (ví dụ do khóa worker tạo ra) vẫn thành công', async () => {
  const out = join(scratch, 'sao-luu');
  await createBackup(workspace.db, { dataDir: workspace.dataDir, outDir: out });
  const target = join(scratch, 'rong');
  mkdirSync(target);
  restoreBackup({ backupDir: out, targetDataDir: target, dbFileName: 'development.sqlite' });
  assert.equal(existsSync(join(target, 'db', 'development.sqlite')), true);
});

test('thay dữ liệu hiện có: cần chọn replace; bản cũ được đổi tên (không xóa) và hồ sơ/khóa của máy này được giữ lại', async () => {
  const out = join(scratch, 'sao-luu');
  await createBackup(workspace.db, { dataDir: workspace.dataDir, outDir: out });
  const target = join(scratch, 'dang-dung');
  mkdirSync(join(target, 'profiles', 'p1'), { recursive: true });
  writeFileSync(join(target, 'profiles', 'p1', 'Cookies'), 'COOKIE-CU');
  mkdirSync(join(target, 'secrets'), { recursive: true });
  writeFileSync(join(target, 'secrets', 'k'), 'KHOA-CU');
  writeFileSync(join(target, 'ghi-chu.txt'), 'dữ liệu cũ');
  assert.throws(() => restoreBackup({ backupDir: out, targetDataDir: target, dbFileName: 'development.sqlite' }), /target_exists_use_replace/u);
  assert.equal(readFileSync(join(target, 'ghi-chu.txt'), 'utf8'), 'dữ liệu cũ'); // chưa bị đụng tới

  const result = restoreBackup({ backupDir: out, targetDataDir: target, dbFileName: 'development.sqlite', replace: true });
  assert.equal(result.keptLocalState, true);
  assert.ok(result.previousKeptAt && readFileSync(join(result.previousKeptAt, 'ghi-chu.txt'), 'utf8') === 'dữ liệu cũ'); // bản cũ còn nguyên ở chỗ đã đổi tên
  assert.equal(readFileSync(join(target, 'profiles', 'p1', 'Cookies'), 'utf8'), 'COOKIE-CU'); // hồ sơ của máy này được giữ
  assert.equal(existsSync(join(target, 'ghi-chu.txt')), false); // dữ liệu mới là bản phục hồi
  assert.equal(existsSync(join(target, 'db', 'development.sqlite')), true);
});
