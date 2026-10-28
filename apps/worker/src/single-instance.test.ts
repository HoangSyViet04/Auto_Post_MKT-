import assert from 'node:assert/strict';
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('./index.ts', import.meta.url));

test('chỉ một worker mỗi thư mục dữ liệu: bản thứ hai bị từ chối; khóa của tiến trình đã chết được dọn nên khởi động lại được', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'apm worker khóa '));
  const env = { ...process.env, APM_ENV: 'test', APM_DATA_DIR: dir, APM_INTEGRATIONS: 'fake', APM_BROWSER: 'off' };
  const children: ChildProcess[] = [];
  const start = () => { const child = spawn(process.execPath, [entry], { env, stdio: 'ignore' }); children.push(child); return child; };
  const waitForLock = async () => { for (let i = 0; i < 60 && !existsSync(join(dir, 'worker.lock')); i += 1) await new Promise((resolve) => setTimeout(resolve, 250)); };
  try {
    const first = start();
    await waitForLock();
    assert.ok(existsSync(join(dir, 'worker.lock')));
    const second = spawnSync(process.execPath, [entry], { env, encoding: 'utf8', timeout: 30_000 });
    assert.equal(second.status, 1);
    assert.match(second.stdout + second.stderr, /worker khác đang chạy/u);
    assert.equal(first.exitCode, null); // worker đầu vẫn sống

    first.kill('SIGKILL'); // chết đột ngột: khóa còn trên đĩa nhưng chủ đã chết
    await new Promise((resolve) => first.once('exit', resolve));
    const third = start();
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    assert.equal(third.exitCode, null); // khởi động được vì khóa mồ côi đã được dọn
  } finally {
    for (const child of children) child.kill('SIGKILL');
    await new Promise((resolve) => setTimeout(resolve, 500));
    rmSync(dir, { recursive: true, force: true });
  }
});
