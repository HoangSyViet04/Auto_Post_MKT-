import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { createDiagnosticCapture, type ScreenshotTarget } from './diagnostic-capture.ts';

const HOUR = 3_600_000;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const page: ScreenshotTarget = { screenshot: async () => PNG };
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apm chup ')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
const names = (folder = dir) => (existsSync(folder) ? readdirSync(folder) : []);
/** Làm file cũ đi `hours` giờ so với thời điểm giả định. */
const age = (name: string, now: number, hours: number) => { const when = new Date(now - hours * HOUR); utimesSync(join(dir, name), when, when); };

test('chụp lưu PNG với tên chỉ gồm thời điểm, mã job ngắn và mã lý do đã làm sạch; không thể thoát khỏi thư mục', async () => {
  const now = Date.UTC(2026, 9, 28, 8, 0, 0);
  const capture = createDiagnosticCapture({ dir: join(dir, 'cap'), retentionMs: 24 * HOUR, now: () => now });
  const path = await capture.capture(page, { jobId: '../../etc/PASSWD-hoặc-gì-đó', code: 'ui_changed' });
  assert.ok(path);
  assert.deepEqual(names(join(dir, 'cap')), ['20261028080000-______et-ui_changed.png']);
  assert.deepEqual(readdirSync(dir), ['cap']); // không có gì ghi ra ngoài thư mục chụp
  assert.equal((await capture.capture(page, { jobId: 'job-1', code: '../x y' }))?.startsWith(join(dir, 'cap')), true);
});

test('hạn lưu: ảnh quá hạn bị xóa, ảnh còn hạn giữ lại; xóa hết khi người dùng chủ động dọn', async () => {
  const now = Date.now();
  const capture = createDiagnosticCapture({ dir, retentionMs: 24 * HOUR, now: () => now });
  await capture.capture(page, { jobId: 'cu', code: 'a' });
  await capture.capture(page, { jobId: 'moi', code: 'b' });
  const [old, fresh] = names().sort();
  assert.ok(old && fresh);
  age(old, now, 25);
  age(fresh, now, 23);
  assert.deepEqual([capture.stats().count, Math.round((capture.stats().oldestAgeMs ?? 0) / HOUR)], [2, 25]);
  assert.equal(capture.purgeExpired(), 1);
  assert.deepEqual(names(), [fresh]);
  assert.equal(capture.purgeAll(), 1);
  assert.deepEqual([names(), capture.stats()], [[], { count: 0, oldestAgeMs: null }]);
});

test('chụp xong cũng dọn ảnh quá hạn và giữ tối đa maxFiles ảnh (xóa ảnh cũ nhất)', async () => {
  let now = Date.UTC(2026, 9, 28, 8, 0, 0);
  const capture = createDiagnosticCapture({ dir, retentionMs: 24 * HOUR, maxFiles: 3, now: () => now });
  for (let index = 0; index < 5; index += 1) {
    await capture.capture(page, { jobId: `job${index}`, code: 'x' });
    for (const name of names()) age(name, now, 0); // mtime = thời điểm giả định hiện tại
    now += 1_000;
  }
  assert.equal(names().length, 3);
  assert.deepEqual(names().map((name) => name.split('-')[1]), ['job2', 'job3', 'job4']);
});

test('chụp lỗi thì trả null, không ném lỗi và không để lại file dở dang', async () => {
  const capture = createDiagnosticCapture({ dir: join(dir, 'cap'), retentionMs: HOUR });
  const broken: ScreenshotTarget = { screenshot: async () => { throw new Error('trang đã đóng'); } };
  assert.equal(await capture.capture(broken, { jobId: 'j', code: 'x' }), null);
  assert.deepEqual(names(join(dir, 'cap')), []);
});
