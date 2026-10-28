import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { createBackup, loadMigrations, migrate, openDatabase, restoreBackup, verifyBackup } from '#storage';
import { rollbackHelp, runUpdate, type UpdateDeps } from './update.ts';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'apm cap nhat ')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

type StepCodes = Partial<Record<'install' | 'migrate' | 'build', number>>;
interface FakeOptions { dirty?: boolean; pullCode?: number; lockChanges?: boolean; steps?: StepCodes; deps?: Partial<UpdateDeps> }

function fake(options: FakeOptions = {}): { deps: UpdateDeps; calls: string[] } {
  const calls: string[] = [];
  let lock = 'lock-1';
  const deps: UpdateDeps = {
    isRunning: async () => false,
    git: async (args) => {
      calls.push(`git ${args.join(' ')}`);
      if (args[0] === 'status') return { code: 0, out: options.dirty ? ' M file.ts\n' : '' };
      if (args[0] === 'rev-parse') return { code: 0, out: 'abc1234def\n' };
      if (args[0] === 'pull') {
        if (options.lockChanges) lock = 'lock-2';
        return { code: options.pullCode ?? 0, out: options.pullCode ? 'fatal: không fast-forward\n' : 'Updating\n' };
      }
      return { code: 1, out: '' };
    },
    run: async (step) => { calls.push(`run ${step}`); return options.steps?.[step] ?? 0; },
    lockfileHash: () => lock,
    backupAndVerify: async () => { calls.push('backup'); return []; },
    backupDir: () => join(root, 'backups', 'pre-update'),
    log: () => undefined,
    ...options.deps,
  };
  return { deps, calls };
}

test('thứ tự đúng: kiểm tra → sao lưu (đạt) → pull → migrate → build; không cài lại thư viện khi package-lock không đổi', async () => {
  const { deps, calls } = fake();
  const result = await runUpdate(deps);
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ['git status --porcelain', 'git rev-parse HEAD', 'backup', 'git pull --ff-only', 'git rev-parse HEAD', 'run migrate', 'run build']);
  assert.match(result.message, /giữ nguyên/u);
});

test('package-lock đổi thì cài lại thư viện trước khi migrate', async () => {
  const { deps, calls } = fake({ lockChanges: true });
  assert.equal((await runUpdate(deps)).ok, true);
  assert.deepEqual(calls.filter((call) => call.startsWith('run')), ['run install', 'run migrate', 'run build']);
});

test('không cập nhật khi ứng dụng đang chạy hoặc mã nguồn có thay đổi chưa commit; chưa chạm vào gì', async () => {
  const running = fake({ deps: { isRunning: async () => true } });
  assert.equal((await runUpdate(running.deps)).failure, 'running');
  assert.deepEqual(running.calls, []);
  const dirty = fake({ dirty: true });
  const result = await runUpdate(dirty.deps);
  assert.equal(result.failure, 'dirty');
  assert.equal(dirty.calls.some((call) => call.includes('pull') || call === 'backup' || call.startsWith('run')), false);
});

test('sao lưu không đạt (hoặc ném lỗi) thì dừng TRƯỚC khi tải bản mới', async () => {
  const failures: Array<UpdateDeps['backupAndVerify']> = [
    async () => ['Cơ sở dữ liệu: mã băm không khớp'],
    async () => { throw new Error('đĩa đầy'); },
  ];
  for (const backupAndVerify of failures) {
    const { deps, calls } = fake({ deps: { backupAndVerify } });
    const result = await runUpdate(deps);
    assert.equal(result.failure, 'backup_failed');
    assert.match(result.message, /CHƯA cập nhật/u);
    assert.equal(calls.some((call) => call.includes('pull') || call.startsWith('run')), false);
  }
});

test('lỗi ở các bước sau: dừng ngay, nêu rõ cách quay về (git + khôi phục từ sao lưu) và KHÔNG chạy lệnh phá hủy nào', async () => {
  const cases: Array<[FakeOptions, string]> = [
    [{ pullCode: 1 }, 'pull_failed'],
    [{ lockChanges: true, steps: { install: 1 } }, 'install_failed'],
    [{ steps: { migrate: 1 } }, 'migrate_failed'],
    [{ steps: { build: 1 } }, 'build_failed'],
  ];
  for (const [options, failure] of cases) {
    const { deps, calls } = fake(options);
    const result = await runUpdate(deps);
    assert.equal(result.failure, failure);
    assert.match(result.message, /bản sao lưu/iu);
    if (failure !== 'pull_failed') assert.match(result.message, /git checkout abc1234def[\s\S]*npm run restore/u);
    assert.equal(calls.some((call) => /reset|clean|checkout|--force| -f\b/u.test(call)), false, calls.join('; '));
    if (failure === 'migrate_failed') assert.equal(calls.includes('run build'), false); // không build khi migration lỗi
  }
  assert.match(rollbackHelp('abc', '/b'), /1\. git checkout abc/u);
});

test('cập nhật thật trên dữ liệu tạm: DB cũ được nâng, dữ liệu/ảnh/hồ sơ/khóa giữ nguyên; khôi phục từ sao lưu đưa về đúng bản cũ', async () => {
  const dataDir = join(root, 'Dữ liệu');
  const dbPath = join(dataDir, 'db', 'development.sqlite');
  mkdirSync(join(dataDir, 'db'), { recursive: true });
  const old = openDatabase(dbPath);
  migrate(old, loadMigrations().slice(0, 1)); // DB đang ở bản cũ (v1)
  old.prepare('INSERT INTO app_meta(key,value) VALUES (?,?)').run('mau-du-lieu', 'giữ nguyên');
  old.close();
  const sentinels: Array<[string, string]> = [['profiles/nick/Cookies', 'COOKIE-PHIEN-DANG-NHAP'], ['secrets/khoa.bin', 'KHOA'], ['media/objects/a.blob', 'ANH']];
  for (const [file, content] of sentinels) {
    mkdirSync(dirname(join(dataDir, file)), { recursive: true });
    writeFileSync(join(dataDir, file), content);
  }
  const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
  const before = new Map(sentinels.map(([file]) => [file, hash(join(dataDir, file))]));

  const { deps } = fake({ deps: {
    backupAndVerify: async (dir) => {
      const db = openDatabase(dbPath);
      try { await createBackup(db, { dataDir, outDir: dir }); } finally { db.close(); }
      return verifyBackup(dir).problems;
    },
    run: async (step) => {
      if (step === 'migrate') { const db = openDatabase(dbPath); try { migrate(db); } finally { db.close(); } }
      return 0;
    },
  } });
  const result = await runUpdate(deps);
  assert.equal(result.ok, true, result.message);

  const upgraded = openDatabase(dbPath);
  try {
    assert.equal(upgraded.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()?.v, loadMigrations().at(-1)?.version);
    assert.equal(upgraded.prepare("SELECT value FROM app_meta WHERE key='mau-du-lieu'").get()?.value, 'giữ nguyên');
  } finally { upgraded.close(); }
  for (const [file] of sentinels) assert.equal(hash(join(dataDir, file)), before.get(file), `${file} không được thay đổi`);

  // Quay về: khôi phục từ bản sao lưu trước cập nhật (schema v1) sang thư mục khác, kiểm chứng dữ liệu cũ còn đủ.
  const backupDir = result.backupDir as string;
  assert.equal(verifyBackup(backupDir).manifest?.schemaVersion, 1);
  const restored = join(root, 'khoi-phuc');
  restoreBackup({ backupDir, targetDataDir: restored, dbFileName: 'development.sqlite' });
  assert.equal(existsSync(join(restored, 'db', 'development.sqlite')), true);
});
