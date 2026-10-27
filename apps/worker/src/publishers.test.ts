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

  test('live cần cấu hình trình duyệt; có thì nhóm/TCN là adapter thật, fanpage bị tắt rõ ràng và dừng trước khi gửi', async () => {
    assert.throws(() => createPublishers('live'), /APM_BROWSER=real/);
    const live = createPublishers('live', { profileDirFor: (accountId) => `x/${accountId}` });
    assert.deepEqual([live.group.capabilities.simulated, live.profile.capabilities.simulated, live.group.capabilities.level], [false, false, 'automatic']);
    assert.deepEqual([live.page.capabilities.level, live.page.capabilities.simulated], ['unsupported', false]);
    const request = { jobId: 'j', destinationId: 'd', caption: 'x', mediaPaths: ['a'] };
    assert.deepEqual(await live.page.prepare(request), { ok: false, reasonCode: 'unsupported', reason: 'Kênh page chưa được hỗ trợ.' });
    assert.equal((await live.page.submit(request)).status, 'failed'); // không giả thành công
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
