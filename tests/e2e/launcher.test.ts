import assert from 'node:assert/strict';
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { pidAlive } from '#ops';

const root = resolve(import.meta.dirname, '..', '..');
let dataDir: string;
const spawned: ChildProcess[] = [];

before(() => { dataDir = mkdtempSync(join(tmpdir(), 'apm launcher ')); });
after(() => {
  for (const child of spawned) if (child.exitCode === null) child.kill();
  try { process.kill(Number(readFileSync(join(dataDir, 'worker.lock'), 'utf8')), 'SIGTERM'); } catch { /* đã dừng */ }
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
});

const freePort = (): Promise<number> => new Promise((resolvePort) => {
  const server = createServer();
  server.listen({ port: 0, host: '127.0.0.1' }, () => { const { port } = server.address() as { port: number }; server.close(() => resolvePort(port)); });
});
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
async function until<T>(probe: () => Promise<T | undefined | false>, timeoutMs: number): Promise<T | undefined> {
  for (const end = Date.now() + timeoutMs; Date.now() < end; await wait(250)) {
    const value = await probe().catch(() => undefined);
    if (value) return value;
  }
  return undefined;
}

/** Chạy launcher thật. APM_BROWSER=off vì test không được mở trình duyệt thật. */
function launch(args: string[], port: number) {
  const child = spawn(process.execPath, [join('scripts', 'launch.ts'), ...args], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    env: { ...process.env, APM_ENV: 'test', APM_INTEGRATIONS: 'fake', APM_BROWSER: 'off', APM_DATA_DIR: dataDir, APM_SERVER_PORT: String(port) },
  });
  spawned.push(child);
  let output = '';
  child.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); });
  child.stderr?.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); });
  const exited = new Promise<number | null>((done) => child.once('exit', (code) => done(code)));
  return { child, exited, output: () => output };
}
const health = async (port: number) => {
  const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1_000) });
  return response.ok ? (await response.json()) as { status: string; worker: { alive: boolean } } : undefined;
};

describe('launcher (tiến trình thật)', () => {
  test('--check: môi trường đạt thì thoát 0 và không khởi động gì; cổng bị chiếm thì báo lỗi rõ và thoát 1', async () => {
    const port = await freePort();
    const ok = launch(['--check'], port);
    assert.equal(await ok.exited, 0, ok.output());
    assert.match(ok.output(), /Môi trường đạt yêu cầu/u);
    assert.match(ok.output(), /Chế độ: MÔ PHỎNG/u);
    assert.equal(await health(port).catch(() => undefined), undefined); // không có gì được khởi động

    // "Chương trình khác" chiếm cổng: nhận kết nối rồi đóng ngay (không đáp /api/health), để server này đóng lại được khi test xong.
    const busy = createServer((socket) => socket.destroy());
    await new Promise<void>((done) => busy.listen({ port, host: '127.0.0.1' }, done));
    try {
      const blocked = launch(['--check'], port);
      assert.equal(await blocked.exited, 1);
      assert.match(blocked.output(), /\[LỖI\] Cổng \d+ đang bị chương trình khác dùng/u);
      assert.match(blocked.output(), /APM_SERVER_PORT/u);
    } finally { await new Promise((done) => busy.close(done)); }
  });

  test('chạy thật: một cổng phục vụ cả giao diện và API; chỉ một worker; bản thứ hai bị từ chối; launcher chết đột ngột thì server và worker tự dừng', { timeout: 240_000 }, async () => {
    const port = await freePort();
    const app = launch(['--no-open'], port);
    const index = await until(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1_000) });
      return response.ok ? response : undefined;
    }, 180_000); // lần đầu có thể phải build giao diện
    assert.ok(index, app.output());
    assert.match(String(index.headers.get('content-type')), /^text\/html/u);
    assert.match(await index.text(), /<div id="root">/u);
    // Dòng này in sau khi bật worker nên có thể đến muộn hơn trang đầu tiên một chút.
    assert.ok(await until(async () => /Đang chạy tại/u.test(app.output()), 15_000), app.output());

    const alive = await until(async () => (await health(port))?.worker.alive, 20_000);
    assert.equal(alive, true, 'worker phải báo nhịp sống');
    assert.equal(existsSync(join(dataDir, 'worker.lock')), true);
    const workerPid = Number(readFileSync(join(dataDir, 'worker.lock'), 'utf8'));
    assert.equal(pidAlive(workerPid), true);

    // Chỉ một scheduler: bản thứ hai (cổng khác, cùng dữ liệu) bị từ chối ngay ở bước kiểm tra
    const second = launch(['--check'], await freePort());
    assert.equal(await second.exited, 1);
    assert.match(second.output(), /\[LỖI\] Đã có một worker đang chạy/u);

    // Launcher bị giết đột ngột (như đóng cửa sổ): Windows không dừng tiến trình con, nên chúng phải tự dừng
    app.child.kill();
    await app.exited;
    const stopped = await until(async () => (await health(port).then(() => false, () => true)), 30_000);
    assert.equal(stopped, true, 'server phải tự dừng khi mất launcher');
    // Worker cũng phải dừng (không còn ai nhận việc ngầm). Nó có thể dừng không "sạch" nên khóa có thể còn sót lại; khóa mồ côi đó
    // không được chặn lần khởi động kế tiếp.
    const dead = await until(async () => !pidAlive(workerPid), 30_000);
    assert.equal(dead, true, 'worker phải tự dừng khi mất launcher');
    const again = launch(['--check'], await freePort());
    assert.equal(await again.exited, 0, again.output());
    assert.doesNotMatch(again.output(), /\[LỖI\]/u);
  });
});
