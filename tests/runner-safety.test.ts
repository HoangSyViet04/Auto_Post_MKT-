import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { createTestWorkspace, seedOfflineScenario } from '#test-support';

test('runner ép test/fake và dataDir tạm ngay cả khi shell đang production/live', async () => {
  await promisify(execFile)(process.execPath, ['scripts/test.ts', 'tests/fixtures/environment-probe.ts'], {
    env: { ...process.env, APM_ENV: 'production', APM_INTEGRATIONS: 'live', APM_DATA_DIR: 'do-not-use-parent-data' },
    windowsHide: true, timeout: 15_000,
  });
});

test('fixture offline có ảnh thật trong DB riêng, không seed tự động hoặc chạy ở production', async () => {
  const first = createTestWorkspace(); const second = createTestWorkspace();
  try {
    assert.notEqual(first.dataDir, second.dataDir);
    assert.equal(first.db.prepare('SELECT count(*) AS n FROM products').get()?.n, 0);
    const scenario = await seedOfflineScenario(first);
    assert.equal((await first.media.resolveForPublish([scenario.image.id])).length, 1);
    assert.equal(scenario.enqueue().status, 'queued');
    assert.equal(second.db.prepare('SELECT count(*) AS n FROM products').get()?.n, 0);
    const old = process.env.APM_ENV;
    try {
      process.env.APM_ENV = 'production'; assert.throws(createTestWorkspace, /test\/fake/);
      await assert.rejects(seedOfflineScenario(first), /test\/fake/);
      assert.equal(first.db.prepare('SELECT count(*) AS n FROM media').get()?.n, 1);
    }
    finally { if (old === undefined) delete process.env.APM_ENV; else process.env.APM_ENV = old; }
  } finally { first.dispose(); second.dispose(); }
  assert.equal(existsSync(first.dataDir), false); assert.equal(existsSync(second.dataDir), false);
});
