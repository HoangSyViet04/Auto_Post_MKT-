import assert from 'node:assert/strict';
import { type ChildProcess, spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { createTestWorkspace, seedOfflineScenario } from '#test-support';

const root = resolve(import.meta.dirname, '..', '..');
let workspace: ReturnType<typeof createTestWorkspace>;
let scenario: Awaited<ReturnType<typeof seedOfflineScenario>>;
let worker: ChildProcess | undefined;

beforeEach(async () => {
  workspace = createTestWorkspace();
  scenario = await seedOfflineScenario(workspace);
});
afterEach(async () => {
  if (worker && worker.exitCode === null) {
    const exited = new Promise((done) => worker?.once('exit', done));
    worker.kill();
    await exited;
  }
  worker = undefined;
  workspace.db.close();
  const { rmSync } = await import('node:fs');
  rmSync(workspace.dataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
});

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
async function until(probe: () => boolean, timeoutMs: number): Promise<boolean> {
  for (const end = Date.now() + timeoutMs; Date.now() < end; await wait(200)) if (probe()) return true;
  return false;
}
const status = (id: string) => workspace.db.prepare('SELECT status FROM publish_jobs WHERE id=?').get(id)?.status as string;
const attempts = (id: string) => Number(workspace.db.prepare('SELECT count(*) AS n FROM publish_attempts WHERE job_id=?').get(id)?.n);
const reasons = (id: string) => (workspace.db.prepare("SELECT reason_code FROM activity_log WHERE job_id=? AND action_code='claim_recovered'").all(id) as Array<{ reason_code: string }>).map((row) => row.reason_code);

/** Worker THẬT (tiến trình riêng) trên chính cơ sở dữ liệu của test; mô phỏng, không gọi Facebook. */
function startWorker(): ChildProcess {
  worker = spawn(process.execPath, [join('apps', 'worker', 'src', 'index.ts')], {
    cwd: root, stdio: 'ignore', windowsHide: true,
    env: { ...process.env, APM_ENV: 'test', APM_INTEGRATIONS: 'fake', APM_BROWSER: 'off', APM_DATA_DIR: workspace.dataDir, APM_MIN_GAP_SECONDS: '0', APM_OVERDUE_MINUTES: '15' },
  });
  return worker;
}

test('T13 mở lại với nhiều lịch quá hạn: chỉ job đến hạn chạy; job quá hạn không bị phát dồn và vẫn còn đó để người dùng quyết định', async () => {
  const hour = 3_600_000;
  const due = scenario.enqueue('den-han', Date.now());
  const late = [scenario.enqueue('qua-han-1', Date.now() - 2 * hour), scenario.enqueue('qua-han-2', Date.now() - 5 * hour)];
  startWorker();
  assert.equal(await until(() => status(due.id) === 'published', 20_000), true, 'job đến hạn phải chạy');
  await wait(3_000); // thêm vài vòng của worker: job quá hạn vẫn không được nhận
  for (const job of late) {
    assert.equal(status(job.id), 'queued');
    assert.equal(attempts(job.id), 0, 'chưa từng được thử');
  }
  assert.equal(attempts(due.id), 1);
});

test('T08 worker chết giữa chừng rồi mở lại: sau mốc gửi → unknown (không gửi lại), trước mốc gửi → tạm dừng; không job nào bị chạy lại', async () => {
  // Hai job bị một worker đã chết bỏ dở. Lease cực ngắn nên đã hết hạn khi worker mới khởi động.
  // Giờ hẹn theo đồng hồ của fixture (để nhận được job); worker thật coi chúng là quá hạn, nhưng việc khôi phục job chạy dở không phụ thuộc giờ hẹn.
  const afterSend = scenario.enqueue('sau-gui');
  const beforeSend = scenario.enqueue('truoc-gui');
  const first = scenario.jobs.claimNext('worker-da-chet', 'fake', 1);
  const second = scenario.jobs.claimNext('worker-da-chet', 'fake', 1);
  assert.ok(first && second);
  const sent = first.jobId === afterSend.id ? first : second;
  const unsent = first.jobId === afterSend.id ? second : first;
  assert.equal(unsent.jobId, beforeSend.id);
  scenario.jobs.markSendStarted(sent); // đã bấm gửi rồi mới chết
  assert.deepEqual([status(afterSend.id), status(beforeSend.id)], ['running', 'running']);

  startWorker();
  assert.equal(await until(() => status(afterSend.id) === 'unknown' && status(beforeSend.id) === 'paused', 20_000), true,
    `trạng thái hiện tại: ${status(afterSend.id)} / ${status(beforeSend.id)}`);
  assert.deepEqual([reasons(afterSend.id), reasons(beforeSend.id)], [['expired_after_send'], ['expired_before_send']]);

  await wait(3_000);
  assert.deepEqual([status(afterSend.id), status(beforeSend.id)], ['unknown', 'paused']); // không tự chạy lại
  assert.deepEqual([attempts(afterSend.id), attempts(beforeSend.id)], [1, 1]); // không có lần thử mới nào
  const published = Number(workspace.db.prepare("SELECT count(*) AS n FROM publish_observations WHERE outcome='published'").get()?.n);
  assert.equal(published, 0, 'không có bài nào được đăng/ghi nhận đăng');
});
