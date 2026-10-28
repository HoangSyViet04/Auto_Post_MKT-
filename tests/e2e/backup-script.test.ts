import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { loadMigrations, migrate, openDatabase, verifyBackup } from '#storage';

const root = resolve(import.meta.dirname, '..', '..');
let dataDir: string;
beforeEach(() => { dataDir = mkdtempSync(join(tmpdir(), 'apm sao luu script ')); });
afterEach(() => { rmSync(dataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }); });

const run = (...args: string[]) => spawnSync(process.execPath, [join('scripts', 'backup.ts'), ...args], {
  cwd: root, encoding: 'utf8', env: { ...process.env, APM_ENV: 'test', APM_INTEGRATIONS: 'fake', APM_DATA_DIR: dataDir },
});

test('npm run backup chụp dữ liệu NGUYÊN TRẠNG: DB schema cũ được sao lưu đúng và không bị tự nâng cấp', () => {
  mkdirSync(join(dataDir, 'db'), { recursive: true });
  const old = openDatabase(join(dataDir, 'db', 'test.sqlite'));
  migrate(old, loadMigrations().slice(0, 1)); // schema v1
  old.close();
  const out = join(dataDir, 'ban-sao-luu');
  const result = run('--out', out);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(verifyBackup(out).manifest?.schemaVersion, 1); // bản sao lưu ở đúng schema cũ

  const after = openDatabase(join(dataDir, 'db', 'test.sqlite'));
  try {
    assert.equal(after.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()?.v, 1, 'sao lưu không được tự migrate dữ liệu thật');
  } finally { after.close(); }
});

test('chưa có cơ sở dữ liệu thì báo lỗi rõ và không tạo DB mới', () => {
  const result = run('--out', join(dataDir, 'khong-co'));
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /Chưa có cơ sở dữ liệu để sao lưu/u);
});
