import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runOfflineScenario, SCENARIOS } from '../../spikes/scenarios.ts';

const entry = fileURLToPath(new URL('../../spikes/run.ts', import.meta.url));
function run(args: string[], integrations = 'fake') {
  return spawnSync(process.execPath, [entry, ...args], {
    encoding: 'utf8', env: { ...process.env, APM_ENV: 'test', APM_INTEGRATIONS: integrations },
  });
}

describe('offline spike harness', () => {
  test('mặc định thiếu scenario không chạy; --help không tạo evidence', () => {
    const missing = run([]);
    assert.equal(missing.status, 2);
    assert.ok(!missing.stdout.includes('"evidence"'));
    const help = run(['--help']);
    assert.equal(help.status, 0);
    assert.ok(!help.stdout.includes('"evidence"'));
    assert.match(help.stdout, /not_tested/);
  });

  test('chỉ chạy fake, từ chối live qua CLI và env', () => {
    for (const response of [run(['--scenario=published', '--mode=live']), run(['--scenario=published'], 'live')]) {
      assert.equal(response.status, 2);
      assert.ok(!response.stdout.includes('"evidence"'));
      assert.equal(response.stderr, '');
    }
  });

  test('CLI chạy từng bước explicit, kênh lựa chọn và nhãn mô phỏng rõ', () => {
    const response = run(['--scenario=pending_approval', '--channel=page']);
    assert.equal(response.status, 0, response.stderr);
    const evidence = JSON.parse(response.stdout).evidence;
    assert.equal(evidence.channel, 'page');
    assert.equal(evidence.simulated, true);
    assert.equal(evidence.realCapability, 'not_tested');
    assert.equal(evidence.outcome, 'pending_approval');
    assert.equal(evidence.submittedCount, 1);
  });

  test('không echo dữ liệu nhạy cảm trong đối số lỗi hoặc tham số lặp', () => {
    for (const args of [
      ['--scenario=password=secret-sentinel'],
      ['--scenario=unknown', '--cookie=cookie-sentinel'],
      ['--scenario=unknown', '--scenario=token-sentinel'],
    ]) {
      const response = run(args);
      assert.equal(response.status, 2);
      assert.ok(!`${response.stdout}${response.stderr}`.includes('sentinel'));
      assert.ok(!response.stdout.includes('"evidence"'));
    }
  });

  test('mọi fixture không gọi mạng; unknown không gửi lại và stop/block không submit', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = () => { throw new Error('Offline scenario must not call network'); };
    try {
      for (const scenario of SCENARIOS) {
        const evidence = await runOfflineScenario(scenario, 'group');
        assert.equal(evidence.simulated, true);
        assert.equal(evidence.realCapability, 'not_tested');
        if (scenario === 'unknown') {
          assert.equal(evidence.outcome, 'unknown');
          assert.equal(evidence.verified, 'unknown');
          assert.equal(evidence.submittedCount, 1);
        } else if (scenario === 'stop' || scenario === 'expired' || scenario === 'checkpoint' || scenario === 'ambiguous_selector') {
          assert.equal(evidence.submittedCount, 0);
          assert.equal(evidence.verified, 'not_run');
          assert.equal(evidence.stage, 'prepare');
        } else {
          assert.equal(evidence.outcome, scenario);
          assert.equal(evidence.verified, scenario);
          assert.equal(evidence.submittedCount, 1);
        }
      }
    } finally { globalThis.fetch = realFetch; }
  });
});
