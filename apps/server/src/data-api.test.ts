import assert from 'node:assert/strict';
import { unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import sharp from 'sharp';
import type { createMediaStore, Database } from '#storage';
import { createTestWorkspace } from '#test-support';
import { buildApp } from './app.ts';

let dir: string; let db: Database; let media: ReturnType<typeof createMediaStore>;
let app: ReturnType<typeof buildApp>; let headers: Record<string, string>; let image: Buffer;
let workspace: ReturnType<typeof createTestWorkspace>;
beforeEach(async () => {
  workspace = createTestWorkspace(); dir = workspace.dataDir; db = workspace.db; media = workspace.media;
  app = buildApp({ db, env: 'test', integrations: 'fake', logger: false, mediaStore: media, uploadLimitBytes: 1024 });
  const session = await app.inject({ method: 'GET', url: '/api/session', headers: { host: '127.0.0.1:4317' } });
  headers = { host: '127.0.0.1:4317', origin: 'http://127.0.0.1:4317', 'x-apm-token': session.json().token, 'content-type': 'application/json' };
  image = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#336699' } }).png().toBuffer();
});
afterEach(async () => { await app.close(); workspace.dispose(); });

test('upload bytes → đọc đúng ảnh → tạo/liệt kê product phân trang, không lộ đường dẫn; ảnh mất trả lỗi rõ', async () => {
  const upload = await app.inject({ method: 'POST', url: '/api/media', headers: { ...headers, 'content-type': 'image/png' }, payload: image });
  assert.equal(upload.statusCode, 201); const saved = upload.json();
  assert.equal(saved.mimeType, 'image/png'); assert.ok(!upload.body.includes(dir)); assert.equal(saved.storage_key, undefined);
  const photo = await app.inject({ method: 'GET', url: `/api/media/${saved.id}`, headers });
  assert.equal(photo.statusCode, 200); assert.equal(photo.headers['x-content-type-options'], 'nosniff'); assert.deepEqual(photo.rawPayload, image);
  const product = await app.inject({ method: 'POST', url: '/api/products', headers,
    payload: { name: 'iPhone 13', condition: 'Xước viền', mediaIds: [saved.id] } });
  assert.equal(product.statusCode, 201);
  const list = await app.inject({ method: 'GET', url: '/api/products?page=1&pageSize=1', headers });
  assert.equal(list.statusCode, 200); assert.equal(list.json().total, 1); assert.equal(list.json().items[0].name, 'iPhone 13');
  assert.equal(list.json().items[0].priceVnd, null);
  assert.equal((await app.inject({ method: 'GET', url: '/api/products?page=2&pageSize=1', headers })).json().items.length, 0);
  await unlink((await media.verify(saved.id)).path);
  const missing = await app.inject({ method: 'GET', url: `/api/media/${saved.id}`, headers });
  assert.equal(missing.statusCode, 409); assert.equal(missing.json().error, 'media_missing');
});

test('validation/pagination/body limit: sai dữ liệu không ghi DB và không echo payload', async () => {
  for (const url of ['/api/products?page=0', '/api/products?pageSize=101', '/api/products?path=outside', '/api/media/not-a-uuid']) {
    assert.equal((await app.inject({ method: 'GET', url, headers })).statusCode, 400);
  }
  const bad = await app.inject({ method: 'POST', url: '/api/products', headers,
    payload: { name: 'private-sentinel', condition: 'cũ', mediaIds: [], path: 'outside' } });
  assert.equal(bad.statusCode, 400); assert.ok(!bad.body.includes('private-sentinel'));
  const large = await app.inject({ method: 'POST', url: '/api/media', headers: { ...headers, 'content-type': 'image/png' }, payload: Buffer.alloc(1025) });
  assert.equal(large.statusCode, 413);
  assert.equal(db.prepare('SELECT count(*) AS n FROM media').get()?.n, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM products').get()?.n, 0);
});

test('upload giữ CSRF/token; JSON path hoặc URL traversal không đọc/xóa file ngoài kho', async () => {
  const outside = join(dir, 'outside.txt'); await writeFile(outside, 'private-sentinel');
  const denied = await app.inject({ method: 'POST', url: '/api/media', headers: { host: headers.host, origin: headers.origin, 'content-type': 'image/png' }, payload: image });
  assert.equal(denied.statusCode, 403);
  const path = await app.inject({ method: 'POST', url: '/api/media', headers, payload: { path: outside } });
  assert.equal(path.statusCode, 400); assert.ok(!path.body.includes(outside));
  const traversal = await app.inject({ method: 'GET', url: '/api/media/%2e%2e%2foutside.txt', headers });
  assert.ok([400, 404].includes(traversal.statusCode)); assert.ok(!traversal.body.includes('private-sentinel'));
  assert.equal(db.prepare('SELECT count(*) AS n FROM media').get()?.n, 0);
});

test('P05: sửa máy tạo revision mới giữ thứ tự ảnh, xung đột phiên bản, đổi trạng thái, thumbnail', async () => {
  const upload = async (color: string) => (await app.inject({ method: 'POST', url: '/api/media', headers: { ...headers, 'content-type': 'image/png' },
    payload: await sharp({ create: { width: 640, height: 8, channels: 3, background: color } }).png().toBuffer() })).json().id as string;
  const [a, b] = [await upload('#336699'), await upload('#993333')];
  const created = (await app.inject({ method: 'POST', url: '/api/products', headers, payload: { name: 'iPhone 13', condition: 'Xước viền', mediaIds: [a, b] } })).json();

  const thumb = await app.inject({ method: 'GET', url: `/api/media/${a}?size=thumb`, headers });
  assert.equal(thumb.statusCode, 200, thumb.body); assert.equal(thumb.headers['content-type'], 'image/jpeg');
  assert.equal((await sharp(thumb.rawPayload).metadata()).width, 320);
  assert.equal((await app.inject({ method: 'GET', url: `/api/media/${a}?size=huge`, headers })).statusCode, 400);

  const detail = (await app.inject({ method: 'GET', url: `/api/products/${created.productId}`, headers })).json();
  assert.deepEqual(detail.mediaIds, [a, b]); assert.equal(detail.priceVnd, null); assert.equal(detail.status, 'selling');
  assert.equal((await app.inject({ method: 'GET', url: '/api/products?pageSize=1', headers })).json().items[0].firstMediaId, a);

  const revise = (expectedRevisionId: string, mediaIds: string[], extra: object = {}) => app.inject({ method: 'PUT',
    url: `/api/products/${created.productId}`, headers, payload: { expectedRevisionId, name: 'iPhone 13 128GB', condition: 'Đẹp', mediaIds, ...extra } });
  const revised = await revise(detail.revisionId, [b, a], { priceVnd: 9_000_000 });
  assert.equal(revised.statusCode, 200); assert.deepEqual(revised.json().mediaIds, [b, a]);
  assert.equal(revised.json().revisionNo, 2); assert.equal(revised.json().priceVnd, 9_000_000);
  assert.equal((await revise(detail.revisionId, [a])).statusCode, 409); // revision cũ
  assert.equal(db.prepare('SELECT count(*) AS n FROM product_revisions').get()?.n, 2);

  const sold = await app.inject({ method: 'POST', url: `/api/products/${created.productId}/status`, headers, payload: { status: 'sold' } });
  assert.equal(sold.statusCode, 200); assert.equal(sold.json().status, 'sold');
  assert.equal((await app.inject({ method: 'POST', url: `/api/products/${created.productId}/status`, headers, payload: { status: 'x' } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'GET', url: '/api/products/00000000-0000-4000-8000-000000000000', headers })).statusCode, 404);
});

test('P05.5: lưu bản caption theo đúng phiên bản máy, giữ thứ tự ảnh; phiên bản cũ/đã bán bị từ chối', async () => {
  const up = async (color: string) => (await app.inject({ method: 'POST', url: '/api/media', headers: { ...headers, 'content-type': 'image/png' },
    payload: await sharp({ create: { width: 4, height: 4, channels: 3, background: color } }).png().toBuffer() })).json().id as string;
  const [a, b] = [await up('#336699'), await up('#993333')];
  const made = (await app.inject({ method: 'POST', url: '/api/products', headers, payload: { name: 'iPhone 13', condition: 'Đẹp', mediaIds: [b, a] } })).json();
  const url = `/api/products/${made.productId}/content-versions`;
  const save = (revisionId: string, caption = 'iPhone 13\nTình trạng: Đẹp', source = 'template') => app.inject({ method: 'POST', url, headers, payload: { revisionId, caption, source } });

  assert.equal((await save(made.revisionId)).statusCode, 201);
  assert.equal((await save(made.revisionId, 'Bản chỉnh tay', 'manual')).statusCode, 201);
  const listed = (await app.inject({ method: 'GET', url, headers })).json().items;
  assert.equal(listed.length, 2); assert.deepEqual(listed[0].mediaIds, [b, a]); assert.equal(listed[0].destinationId, null);
  assert.deepEqual(listed.map((v: { source: string }) => v.source).sort(), ['manual', 'template']);

  assert.equal((await save(made.revisionId, '   ')).statusCode, 400);
  assert.equal((await save(made.revisionId, 'x', 'llm')).statusCode, 400);
  await app.inject({ method: 'PUT', url: `/api/products/${made.productId}`, headers,
    payload: { expectedRevisionId: made.revisionId, name: 'iPhone 13', condition: 'Đẹp hơn', mediaIds: [a] } });
  assert.equal((await save(made.revisionId)).statusCode, 409); // revision cũ không còn là bản hiện tại
  const after = (await app.inject({ method: 'GET', url, headers })).json().items;
  assert.equal(after.length, 2); assert.equal(after[0].revisionNo, 1); // bản cũ vẫn xem được

  await app.inject({ method: 'POST', url: `/api/products/${made.productId}/status`, headers, payload: { status: 'sold' } });
  const current = (await app.inject({ method: 'GET', url: `/api/products/${made.productId}`, headers })).json();
  assert.equal((await save(current.revisionId)).statusCode, 409); // máy đã bán không tạo bản mới
  assert.equal((await app.inject({ method: 'GET', url: '/api/products/00000000-0000-4000-8000-000000000000/content-versions', headers })).statusCode, 404);
});

test('P05.8: POST /api/media/cleanup cần token, không dọn ảnh còn mới, không nhận tham số xóa', async () => {
  const saved = (await app.inject({ method: 'POST', url: '/api/media', headers: { ...headers, 'content-type': 'image/png' }, payload: image })).json();
  const { 'x-apm-token': _token, ...noToken } = headers;
  assert.equal((await app.inject({ method: 'POST', url: '/api/media/cleanup', headers: noToken, payload: '{}' })).statusCode, 403);
  const done = await app.inject({ method: 'POST', url: '/api/media/cleanup', headers, payload: '{}' });
  assert.equal(done.statusCode, 200); assert.deepEqual(done.json(), { purged: 0 }); // vừa tải lên, chưa đủ 24 giờ
  assert.equal((await app.inject({ method: 'GET', url: `/api/media/${saved.id}`, headers })).statusCode, 200);
});
