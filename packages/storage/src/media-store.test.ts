import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, test } from 'node:test';
import sharp from 'sharp';
import { BusinessError, type BusinessErrorCode } from '#domain';
import { createContentRepository, createMediaStore, type Database, migrate, openDatabase } from '#storage';

let dir: string;
let db: Database;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'apm media ')); db = openDatabase(':memory:'); migrate(db); });
afterEach(async () => { db.close(); assert.equal(dirname(dir), tmpdir()); await rm(dir, { recursive: true, force: true }); });
const store = () => createMediaStore(db, { dataDir: dir });
const code = (expected: BusinessErrorCode) => (error: unknown) => error instanceof BusinessError && error.code === expected;
async function source(format: 'png' | 'jpeg' | 'webp' = 'png') {
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#336699' } }).toFormat(format).toBuffer();
  const path = join(dir, `source-${format}.dat`); await writeFile(path, bytes);
  return { path, bytes };
}

test('nhập JPEG/PNG/WebP thật, giữ nguyên bytes/hash; bản trong kho độc lập file nguồn và dùng được cho product', async () => {
  const media = store(); const ids: string[] = [];
  for (const format of ['jpeg', 'png', 'webp'] as const) {
    const input = await source(format); const saved = await media.importFile(input.path); ids.push(saved.id);
    assert.equal(saved.mime_type, `image/${format}`); assert.equal(saved.state, 'ready');
    assert.equal(saved.sha256, createHash('sha256').update(input.bytes).digest('hex'));
    await unlink(input.path);
    assert.deepEqual(await readFile((await media.verify(saved.id)).path), input.bytes);
  }
  assert.equal((await media.resolveForPublish([...ids].reverse())).length, 3);
  const product = createContentRepository(db).createProduct({ name: 'iPhone 13', condition: 'Xước nhẹ', mediaIds: ids });
  assert.ok(product.revisionId);
});

test('từ chối file giả/hỏng, quá lớn và đường dẫn ID sai; không để lại media ready', async () => {
  const media = store(); const input = await source();
  await writeFile(join(dir, 'fake.png'), 'not an image');
  await assert.rejects(media.importFile(join(dir, 'fake.png')), code('media_invalid'));
  await writeFile(join(dir, 'broken.png'), input.bytes.subarray(0, Math.floor(input.bytes.length / 2)));
  await assert.rejects(media.importFile(join(dir, 'broken.png')), code('media_invalid'));
  await assert.rejects(createMediaStore(db, { dataDir: dir, maxBytes: 8 }).importFile(input.path), code('media_too_large'));
  await assert.rejects(createMediaStore(db, { dataDir: dir, maxPixels: 1 }).importFile(input.path), code('media_too_large'));
  await assert.rejects(media.verify('../outside'), code('invalid_input'));
  assert.equal(db.prepare('SELECT count(*) AS n FROM media').get()?.n, 0);
  assert.deepEqual(await readdir(join(dir, 'media', 'staging')), []);
});

test('lỗi sau chuyển file vào kho nhưng trước ready: metadata failed, dọn file riêng, giữ nguyên nguồn', async () => {
  const media = store(); const input = await source();
  db.exec("CREATE TRIGGER simulate_finalize_failure BEFORE UPDATE OF state ON media WHEN NEW.state='ready' BEGIN SELECT RAISE(ABORT,'simulated write failure'); END");
  await assert.rejects(media.importFile(input.path), code('conflict'));
  assert.equal(db.prepare('SELECT state FROM media').get()?.state, 'failed');
  assert.deepEqual(await readdir(join(dir, 'media', 'objects')), []);
  assert.deepEqual(await readdir(join(dir, 'media', 'staging')), []);
  assert.deepEqual(await readFile(input.path), input.bytes);
});

test('ảnh trong kho bị mất/hỏng: cập nhật missing/failed và chặn cả batch, không âm thầm bỏ ảnh', async () => {
  const media = store(); const input = await source();
  const corrupt = await media.importFile(input.path); const gone = await media.importFile(input.path);
  const good = await media.importFile(input.path);
  await writeFile((await media.verify(corrupt.id)).path, 'corrupt');
  await assert.rejects(media.verify(corrupt.id), code('media_invalid'));
  await unlink((await media.verify(gone.id)).path);
  await assert.rejects(media.resolveForPublish([good.id, gone.id]), code('media_missing'));
  assert.equal(db.prepare('SELECT state FROM media WHERE id=?').get(corrupt.id)?.state, 'failed');
  assert.equal(db.prepare('SELECT state FROM media WHERE id=?').get(gone.id)?.state, 'missing');
  assert.throws(() => createContentRepository(db).createProduct({ name: 'iPhone', condition: 'Cũ', mediaIds: [gone.id] }), code('not_ready'));
});

test('P05.8: dọn ảnh mồ côi chỉ khi đủ tuổi và không còn tham chiếu; ảnh đã gắn máy (kể cả bản cũ) được giữ', async () => {
  const media = store(); const products = createContentRepository(db);
  const input = await source();
  const [used, oldUsed, orphan] = [await media.importFile(input.path), await media.importFile(input.path), await media.importFile(input.path)];
  const made = products.createProduct({ name: 'iPhone 13', condition: 'Đẹp', mediaIds: [used.id, oldUsed.id] });
  products.reviseProduct(made.productId, made.revisionId, { name: 'iPhone 13', condition: 'Đẹp', mediaIds: [used.id] }); // oldUsed chỉ còn ở bản cũ

  await assert.rejects(media.purgeUnreferenced(-1), code('invalid_input'));
  assert.deepEqual(await media.purgeUnreferenced(), { purged: 0 }); // quá mới: chưa động tới ảnh nào
  const orphanPath = (await media.verify(orphan.id)).path;
  assert.deepEqual(await media.purgeUnreferenced(0), { purged: 1 });
  assert.deepEqual(await media.purgeUnreferenced(0), { purged: 0 }); // chạy lại không đổi gì

  await assert.rejects(media.verify(orphan.id), code('media_missing'));
  await assert.rejects(readFile(orphanPath), { code: 'ENOENT' });
  assert.equal((await media.resolveForPublish([used.id, oldUsed.id])).length, 2);
  assert.throws(() => products.createProduct({ name: 'x', condition: 'y', mediaIds: [orphan.id] }), code('not_ready'));
});
