import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CHANNELS } from '#domain';
import { createPublishers } from './publishers.ts';

const workerEntry = fileURLToPath(new URL('./index.ts', import.meta.url));

function runWorker(env: Record<string, string>) {
  return spawnSync(process.execPath, [workerEntry, '--once'], { env: { ...process.env, ...env }, encoding: 'utf8' });
}

describe('worker publishers', () => {
  test('fake: đủ ba kênh, tất cả là adapter mô phỏng', () => {
    const publishers = createPublishers('fake');
    assert.deepEqual(Object.keys(publishers).sort(), [...CHANNELS].sort());
    for (const p of Object.values(publishers)) assert.equal(p.capabilities.simulated, true);
  });

  test('live bị từ chối khi chưa có adapter thật', () => {
    assert.throws(() => createPublishers('live'), /Chưa có adapter Facebook thật/);
  });

  test('khởi động worker mặc định chạy mô phỏng và không tự đăng', () => {
    const res = runWorker({ APM_ENV: 'development', APM_INTEGRATIONS: '' });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /integrations=fake \(mô phỏng/);
  });

  test('worker từ chối live trong test', () => {
    const res = runWorker({ APM_ENV: 'test', APM_INTEGRATIONS: 'live' });
    assert.notEqual(res.status, 0);
    assert.match(res.stdout, /bị cấm/);
  });
});
