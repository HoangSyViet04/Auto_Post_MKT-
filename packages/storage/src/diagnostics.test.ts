import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { createTestWorkspace, seedOfflineScenario } from '#test-support';
import { buildDiagnostics } from './diagnostics.ts';

let workspace: ReturnType<typeof createTestWorkspace>;
let scenario: Awaited<ReturnType<typeof seedOfflineScenario>>;
beforeEach(async () => {
  workspace = createTestWorkspace();
  scenario = await seedOfflineScenario(workspace);
});
afterEach(() => { workspace.dispose(); });

test('chẩn đoán: có số liệu vận hành nhưng không lộ nội dung bài, tên, mã đích, đường dẫn hay dữ liệu trong hồ sơ/log/khóa', () => {
  scenario.enqueue('d1');
  const claim = scenario.jobs.claimNext('worker-test', 'fake');
  assert.ok(claim);
  scenario.jobs.markSendStarted(claim);
  scenario.jobs.finish(claim, { outcome: 'unknown', source: 'fake', reasonCode: 'unknown' });
  for (const [dir, content] of [['profiles', 'COOKIE-SENTINEL'], ['secrets', 'SECRET-SENTINEL'], ['logs', 'LOG-SENTINEL']] as const) {
    mkdirSync(join(workspace.dataDir, dir), { recursive: true });
    writeFileSync(join(workspace.dataDir, dir, 'x.bin'), content);
  }

  mkdirSync(join(workspace.dataDir, 'diagnostics'), { recursive: true });
  writeFileSync(join(workspace.dataDir, 'diagnostics', '20261028080000-job-ui_changed.png'), 'SENTINEL-ANH-CHUP');
  const report = buildDiagnostics(workspace.db, { dataDir: workspace.dataDir, now: scenario.state.now });
  assert.deepEqual([report.integrity, report.jobsByStatus, report.jobsNeedingReconcile], ['ok', { unknown: 1 }, 1]);
  assert.deepEqual(report.accountsBySession, { logged_in: 1 });
  assert.deepEqual([report.media.ready, report.media.missingFiles], [1, 0]);
  assert.equal(report.diagnosticCaptures.files, 1); // chỉ đếm, không đưa nội dung hay tên file
  assert.ok(report.dataDirBytes.profiles && report.dataDirBytes.profiles > 0); // chỉ tổng kích thước

  const json = JSON.stringify(report);
  for (const secret of [scenario.versionInput.caption, 'iPhone 13', 'Fake account', 'fake-group', 'vanity', workspace.dataDir, 'SENTINEL']) {
    assert.equal(json.includes(secret), false, `báo cáo không được chứa: ${secret}`);
  }
});

test('chẩn đoán phát hiện ảnh trong DB mà file đã mất', async () => {
  const { path } = await workspace.media.verify(scenario.mediaIds[0] as string);
  rmSync(path);
  assert.equal(buildDiagnostics(workspace.db, { dataDir: workspace.dataDir }).media.missingFiles, 1);
});
