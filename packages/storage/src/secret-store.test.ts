import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { BusinessError } from '#domain';
import { createSecretStore, type Database, migrate, openDatabase } from '#storage';

let dir: string; let db: Database;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'apm secrets ')); db = openDatabase(':memory:'); migrate(db); });
afterEach(async () => { db.close(); assert.equal(dirname(dir), tmpdir()); await rm(dir, { recursive: true, force: true }); });
const lost = (error: unknown) => error instanceof BusinessError && error.code === 'secret_lost' && error.message.includes('kết nối lại');

test('Windows DPAPI thật: lưu/đọc Unicode, thư mục ACL riêng, disk/DB không chứa plaintext', { skip: process.platform !== 'win32' }, async () => {
  const store = createSecretStore(db, { dataDir: dir }); const value = 'fake-only-API-password-điện-thoại';
  const ref = await store.put(value); assert.equal(await store.get(ref.id), value);
  const [file] = await readdir(join(dir, 'secrets')); assert.ok(file);
  const disk = await readFile(join(dir, 'secrets', file), 'utf8');
  assert.ok(!disk.includes(value)); assert.ok(!disk.includes(Buffer.from(value).toString('base64')));
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM secret_refs').all()).includes(value));
  await store.revoke(ref.id);
  await assert.rejects(store.get(ref.id), (e) => e instanceof BusinessError && e.code === 'secret_unavailable');
  assert.deepEqual(await readdir(join(dir, 'secrets')), []);
});

test('ciphertext mất/hỏng báo kết nối lại và đánh dấu lost, không fallback plaintext', { skip: process.platform !== 'win32' }, async () => {
  const store = createSecretStore(db, { dataDir: dir });
  const ref = await store.put('fake-only-sentinel');
  const file = db.prepare('SELECT reference_id FROM secret_refs WHERE id=?').get(ref.id)?.reference_id;
  await writeFile(join(dir, 'secrets', `${file}.dpapi`), '{"version":1,"ciphertext":"AA=="}');
  await assert.rejects(store.get(ref.id), lost);
  assert.equal(db.prepare('SELECT status FROM secret_refs WHERE id=?').get(ref.id)?.status, 'lost');
  const missing = await store.put('fake-only-missing');
  const other = db.prepare('SELECT reference_id FROM secret_refs WHERE id=?').get(missing.id)?.reference_id;
  await unlink(join(dir, 'secrets', `${other}.dpapi`));
  await assert.rejects(store.get(missing.id), lost);
});
