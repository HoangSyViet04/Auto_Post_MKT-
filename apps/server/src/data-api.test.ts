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
