/**
 * Cập nhật Auto Post MKT lên bản mới an toàn: npm run update (hoặc Cap-nhat-Auto-Post-MKT.cmd). Đóng ứng dụng trước.
 * Sao lưu đã kiểm tra → git pull --ff-only → (npm ci nếu cần) → migration → build giao diện. Dừng ngay khi có gì bất thường và
 * in cách quay về. Không xóa dữ liệu, hồ sơ đăng nhập hay ảnh.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { acquireProfileLock } from '#browser';
import { getDataDir, getDatabasePath, getServerPort } from '#config';
import { runUpdate, type UpdateDeps } from '#ops';
import { createBackup, openDatabase, verifyBackup } from '#storage';

const root = resolve(import.meta.dirname, '..');
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env')); // các bước con thừa hưởng biến môi trường
const say = (message: string) => process.stdout.write(`${message}\n`);

const nodeStep = (...args: string[]): number => spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' }).status ?? 1;
const npmCli = (): string | undefined => [process.env.npm_execpath, join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')].find((path): path is string => Boolean(path) && existsSync(path as string));

async function isRunning(): Promise<boolean> {
  try { acquireProfileLock(join(getDataDir(), 'worker.lock')).release(); } catch { return true; }
  try { return (await fetch(`http://127.0.0.1:${getServerPort()}/api/health`, { signal: AbortSignal.timeout(1_500) })).ok; } catch { return false; }
}

const deps: UpdateDeps = {
  isRunning,
  git: async (args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    return { code: result.status ?? 1, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
  },
  run: async (step) => {
    if (step === 'install') { const cli = npmCli(); return cli ? nodeStep(cli, 'ci') : 1; }
    if (step === 'migrate') return nodeStep(join('scripts', 'db-migrate.ts'));
    return nodeStep(join('node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', join('apps', 'web', 'vite.config.ts'));
  },
  lockfileHash: () => createHash('sha256').update(readFileSync(join(root, 'package-lock.json'))).digest('hex'),
  backupDir: () => join(getDataDir(), 'backups', `truoc-cap-nhat-${new Date().toISOString().replace(/\D/gu, '').slice(0, 14)}`),
  // Mở DB KHÔNG migrate: sao lưu phải chụp đúng trạng thái trước khi cập nhật.
  backupAndVerify: async (dir) => {
    const db = openDatabase(getDatabasePath());
    try { await createBackup(db, { dataDir: getDataDir(), outDir: dir }); } finally { db.close(); }
    return verifyBackup(dir).problems;
  },
  log: say,
};

const result = await runUpdate(deps);
say(result.message);
process.exitCode = result.ok ? 0 : 1;
