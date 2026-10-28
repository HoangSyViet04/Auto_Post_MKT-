/**
 * Khởi động Auto Post MKT cho người vận hành: npm start (hoặc nhấp đúp Auto-Post-MKT.cmd).
 *  --check    chỉ kiểm tra môi trường rồi thoát (không khởi động gì).
 *  --no-open  không tự mở trình duyệt.
 * Một cổng duy nhất (server phục vụ cả giao diện), chỉ 127.0.0.1. Giữ cửa sổ này mở: đóng cửa sổ là dừng nhận việc.
 * Chế độ THẬT hay MÔ PHỎNG do APM_INTEGRATIONS quyết định (mặc định mô phỏng); launcher không bao giờ tự bật chế độ thật.
 */
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { acquireProfileLock } from '#browser';
import { getDataDir, getIntegrationMode, getServerPort } from '#config';
import { checkEdge, runPreflight } from '#ops';

const root = resolve(import.meta.dirname, '..');
// Nạp .env (nếu có) một lần ở đây; server và worker thừa hưởng biến môi trường nên không cần nạp lại.
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
const distDir = join(root, 'apps', 'web', 'dist');
const args = new Set(process.argv.slice(2));
const say = (message: string) => process.stdout.write(`${message}\n`);

const workerRunning = (dataDir: string): boolean => {
  try { acquireProfileLock(join(dataDir, 'worker.lock')).release(); return false; } catch { return true; }
};

async function main(): Promise<number> {
  const port = getServerPort();
  const dataDir = getDataDir();
  const mode = getIntegrationMode();
  // Mở trình duyệt chỉ để người dùng đăng nhập/kiểm tra phiên và (khi bật chế độ THẬT) đăng bài đã duyệt; mặc định bật nếu có Edge.
  const edgeFound = checkEdge(process.env).ok;
  const browser = process.env.APM_BROWSER ?? (edgeFound ? 'real' : 'off');
  const engines = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { engines: { node: string } }).engines.node;

  say('Auto Post MKT');
  say(mode === 'live'
    ? 'Chế độ: THẬT — bài đã duyệt sẽ được đăng lên Facebook bằng trình duyệt.'
    : 'Chế độ: MÔ PHỎNG — không gửi gì tới Facebook (đặt APM_INTEGRATIONS=live trong .env để đăng thật).');

  const checks = await runPreflight({ rootDir: root, distDir, dataDir, port, nodeVersion: process.version, nodeRange: engines, env: process.env,
    wantBrowser: browser === 'real', workerRunning: () => workerRunning(dataDir) });
  for (const check of checks) {
    say(`  [${check.ok ? 'ĐẠT' : check.severity === 'error' ? 'LỖI' : 'LƯU Ý'}] ${check.message}${check.ok || !check.fix ? '' : `\n         → ${check.fix}`}`);
  }
  if (checks.some((check) => !check.ok && check.severity === 'error')) { say('Chưa khởi động được. Xử lý các mục [LỖI] ở trên rồi chạy lại.'); return 1; }
  if (args.has('--check')) { say('Môi trường đạt yêu cầu.'); return 0; }

  if (!checks.find((check) => check.id === 'web')?.ok) {
    say('Đang build giao diện (lần đầu)…');
    const built = spawnSync(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', join('apps', 'web', 'vite.config.ts')], { cwd: root, stdio: 'inherit' });
    if (built.status !== 0) { say('Build giao diện không thành công.'); return 1; }
  }

  const url = `http://127.0.0.1:${port}/`;
  const env = { ...process.env, APM_SERVE_WEB: 'on', APM_BROWSER: browser, APM_PARENT_PID: String(process.pid), APM_LOG_LEVEL: process.env.APM_LOG_LEVEL ?? 'warn' };
  const children: Array<{ name: string; child: ChildProcess }> = [];
  const spawnApp = (name: string, entry: string) => {
    const child = spawn(process.execPath, [join('apps', name, 'src', 'index.ts')], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    for (const stream of [child.stdout, child.stderr]) createInterface({ input: stream }).on('line', (line) => say(`[${entry}] ${line}`));
    children.push({ name, child });
    return child;
  };

  let stopping = false;
  const stopAll = async (): Promise<void> => {
    stopping = true;
    for (const { child } of children) if (child.exitCode === null) child.kill();
    await Promise.race([Promise.all(children.map(({ child }) => (child.exitCode === null ? new Promise((done) => child.once('exit', done)) : undefined))), new Promise((done) => setTimeout(done, 5_000))]);
  };

  const server = spawnApp('server', 'máy chủ');
  const ready = await (async () => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (server.exitCode !== null) return false;
      try { if ((await fetch(`${url}api/health`, { signal: AbortSignal.timeout(1_000) })).ok) return true; } catch { /* chưa lên */ }
      await new Promise((done) => setTimeout(done, 500));
    }
    return false;
  })();
  if (!ready) { say('Máy chủ không khởi động được (xem các dòng [máy chủ] ở trên).'); await stopAll(); return 1; }
  spawnApp('worker', 'worker');

  const exited = new Promise<number>((done) => {
    for (const { name, child } of children) {
      child.once('exit', (code) => {
        if (stopping) return;
        say(`${name === 'server' ? 'Máy chủ' : 'Worker'} đã dừng (mã ${code ?? '?'}); đang dừng toàn bộ ứng dụng.`);
        done(1);
      });
    }
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.once(signal, () => { say('Đang dừng Auto Post MKT…'); done(0); });
  });

  say('');
  say(`Đang chạy tại ${url}`);
  say('Giữ cửa sổ này mở. Máy phải bật và cửa sổ này đang mở thì lịch đăng mới chạy; đóng cửa sổ (hoặc Ctrl+C) là dừng nhận việc.');
  say('Job đã gửi mà chưa rõ kết quả sẽ hiện ở "Hàng chờ đăng" để bạn kiểm tra; ứng dụng không tự gửi lại.');
  if (!args.has('--no-open') && process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();

  const code = await exited;
  await stopAll();
  return code;
}

process.exitCode = await main().catch((error: unknown) => { say(`Lỗi: ${error instanceof Error ? error.message : String(error)}`); return 1; });
