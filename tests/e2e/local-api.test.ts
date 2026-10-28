import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'vite';
import { loadMigrations } from '#storage';

async function availablePort(): Promise<number> {
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const address = listener.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

function statusWithHost(url: string, headers: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(url, { headers }, (res) => {
      res.resume();
      res.once('end', () => resolve(res.statusCode ?? 0));
    });
    req.once('error', reject);
    req.end();
  });
}

test('server thật + Vite proxy giữ Host: health/session hợp lệ, request lạ bị chặn', { timeout: 30_000 }, async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'apm local api '));
  const port = await availablePort();
  const child = spawn(process.execPath, ['apps/server/src/index.ts'], {
    env: { ...process.env, APM_ENV: 'development', APM_DATA_DIR: dataDir,
      APM_INTEGRATIONS: 'fake', APM_SERVER_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  let errors = '';
  child.stdout.on('data', (chunk: Buffer) => { logs += chunk.toString(); });
  child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString(); });
  let vite: Awaited<ReturnType<typeof createServer>> | undefined;
  const previousPort = process.env.APM_SERVER_PORT;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Server startup timed out: ${errors}`)), 10_000);
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Server exit ${code}: ${errors}`)); });
      child.stdout.on('data', () => {
        if (logs.includes('Server listening at')) { clearTimeout(timer); resolve(); }
      });
    });
    process.env.APM_SERVER_PORT = String(port);
    vite = await createServer({ configFile: 'apps/web/vite.config.ts', logLevel: 'silent', cacheDir: join(dataDir, 'vite-cache') });
    await vite.listen();
    const web = 'http://127.0.0.1:5173';
    const direct = `http://127.0.0.1:${port}`;
    const health = await fetch(`${web}/api/health`);
    assert.equal(health.status, 200);
    const healthBody = await health.json() as { integrations: string; schemaVersion: number };
    assert.equal(healthBody.integrations, 'fake');
    assert.equal(healthBody.schemaVersion, loadMigrations().at(-1)?.version);
    const session = await fetch(`${web}/api/session`, { headers: { Origin: web } });
    assert.equal(session.status, 200);
    assert.equal(session.headers.get('cache-control'), 'no-store');
    const { token } = await session.json() as { token: string };
    assert.match(token, /^[a-f0-9]{64}$/);
    const mutation = await fetch(`${web}/api/nonexistent-command`, {
      method: 'POST', headers: { Origin: web, 'X-APM-Token': token, 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal(mutation.status, 404, 'request hợp lệ đi qua guard nhưng chưa có API nghiệp vụ');
    const blocked = await fetch(`${web}/api/nonexistent-command`, { method: 'POST', body: '{}' });
    assert.equal(blocked.status, 403);
    const crossOrigin = await fetch(`${web}/api/session`, { headers: { Origin: 'https://evil.invalid' } });
    assert.equal(crossOrigin.status, 403);
    assert.equal(crossOrigin.headers.get('access-control-allow-origin'), null);
    // Node fetch normalizes Host; use raw HTTP headers to test the actual wire boundary.
    assert.equal(await statusWithHost(`${direct}/api/health`, ['Host', 'evil.invalid']), 403);
    const duplicateHost = await statusWithHost(`${direct}/api/health`, ['Host', `127.0.0.1:${port}`, 'Host', 'evil.invalid']);
    assert.ok([400, 403].includes(duplicateHost), 'duplicate Host rejected by HTTP parser or app hook');
    assert.ok(!logs.includes(token), 'token bootstrap không xuất trong log thật');
    assert.equal(errors, '');
  } finally {
    if (previousPort === undefined) delete process.env.APM_SERVER_PORT;
    else process.env.APM_SERVER_PORT = previousPort;
    await vite?.close();
    if (child.exitCode === null) {
      const stopped = once(child, 'exit');
      child.kill();
      await stopped;
    }
    // Vite có thể còn đang ghi vite-cache/deps_temp_* khi test kết thúc (bộ tối ưu phụ thuộc chạy nền): thử lại thay vì lỗi ENOTEMPTY.
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
});
