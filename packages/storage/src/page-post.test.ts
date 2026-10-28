import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { BusinessError, type BusinessErrorCode } from '#domain';
import { createTestWorkspace, seedOfflineScenario } from '#test-support';
import { createPageRepository } from './page-repository.ts';
import { createPostBatchService } from './post-batch.ts';
import { createSecretStore } from './secret-store.ts';

const PAGE_ID = '107892312229541';
const TOKEN = 'EAAPAGETOKEN-2222222222222222222222222-bi-mat';
let workspace: ReturnType<typeof createTestWorkspace>;
let scenario: Awaited<ReturnType<typeof seedOfflineScenario>>;
let pages: ReturnType<typeof createPageRepository>;
let batch: ReturnType<typeof createPostBatchService>;
let connectionId: string;
const code = (expected: BusinessErrorCode) => (error: unknown) => error instanceof BusinessError && error.code === expected;
const status = (id: string) => workspace.db.prepare('SELECT status FROM publish_jobs WHERE id=?').get(id)?.status as string;

beforeEach(async () => {
  workspace = createTestWorkspace();
  scenario = await seedOfflineScenario(workspace);
  const clock = () => scenario.state.now;
  pages = createPageRepository(workspace.db, { secrets: createSecretStore(workspace.db, { dataDir: workspace.dataDir }), clock });
  batch = createPostBatchService(workspace.db, { mode: 'live', clock });
  connectionId = (await pages.connect({ pageId: PAGE_ID, name: 'Góc Nghiện Đồ Hay', token: TOKEN, tasks: ['CREATE_CONTENT'] })).id;
});
afterEach(() => { workspace.dispose(); });

const post = (overrides: Partial<Parameters<typeof batch.submitPage>[0]> = {}) =>
  batch.submitPage({ requestKey: 'khoa-page-0001', pageConnectionId: connectionId, productId: scenario.productId, scheduledAt: scenario.state.now, caption: 'Bài thử fanpage', ...overrides });

test('xếp một bài lên fanpage: bản caption riêng cho đích Page, duyệt theo kết nối Page (không cần tài khoản), một job chờ; chống bấm hai lần', () => {
  const first = post();
  assert.equal(first.ok, true);
  const jobId = first.ok ? first.jobs[0]?.jobId as string : '';
  assert.equal(status(jobId), 'queued');
  const approval = workspace.db.prepare(`SELECT a.channel,a.account_id,a.page_connection_id,c.caption,d.external_id FROM publish_jobs j JOIN approvals a ON a.id=j.approval_id
    JOIN content_versions c ON c.id=a.content_version_id JOIN destinations d ON d.id=a.destination_id WHERE j.id=?`).get(jobId);
  assert.deepEqual([approval?.channel, approval?.account_id, approval?.page_connection_id, approval?.caption, approval?.external_id], ['page', null, connectionId, 'Bài thử fanpage', PAGE_ID]);

  const again = post(); // cùng mã yêu cầu, cùng nội dung → kết quả cũ, không job mới
  assert.deepEqual([again.ok && again.replayed, again.ok && again.jobs[0]?.jobId], [true, jobId]);
  assert.equal(Number(workspace.db.prepare('SELECT count(*) AS n FROM publish_jobs').get()?.n), 1);
  assert.throws(() => post({ caption: 'Nội dung khác' }), code('idempotency_conflict')); // cùng mã, khác nội dung
});

test('bị chặn đúng lúc: máy đã bán, kết nối không tồn tại/đã gỡ, Page không có quyền đăng hoặc token hết hạn → không xếp job nào', async () => {
  assert.throws(() => post({ pageConnectionId: '00000000-0000-4000-8000-000000000000', requestKey: 'khoa-page-0002' }), code('not_found'));
  assert.throws(() => post({ caption: '   ', requestKey: 'khoa-page-0003' }), code('invalid_input'));

  pages.markChecked(connectionId, 'expired'); // Meta đã từ chối token
  const blocked = post({ requestKey: 'khoa-page-0004' });
  assert.deepEqual([blocked.ok, !blocked.ok && blocked.failures[0]?.code], [false, 'not_ready']);
  pages.markChecked(connectionId, 'allowed');

  scenario.content.setProductStatus(scenario.productId, 'sold');
  assert.throws(() => post({ requestKey: 'khoa-page-0005' }), code('not_ready'));
  scenario.content.setProductStatus(scenario.productId, 'selling');

  await pages.disconnect(connectionId);
  assert.throws(() => post({ requestKey: 'khoa-page-0006' }), code('not_found'));
  assert.equal(Number(workspace.db.prepare('SELECT count(*) AS n FROM publish_jobs').get()?.n), 0);
});

test('gỡ Page dừng các job phụ thuộc: chờ → hủy, đang chạy → yêu cầu dừng, đã có kết quả giữ nguyên; token bị thu hồi', async () => {
  const waiting = post({ requestKey: 'khoa-page-0010' });
  const running = post({ requestKey: 'khoa-page-0011', caption: 'Bài thứ hai' });
  const settled = post({ requestKey: 'khoa-page-0012', caption: 'Bài thứ ba' });
  assert.ok(waiting.ok && running.ok && settled.ok);
  const ids = [waiting, running, settled].map((result) => (result.ok ? result.jobs[0]?.jobId : '') as string);
  const claim = scenario.jobs.claimNext('worker-test', 'live');
  assert.ok(claim);
  const claimed = claim.jobId;
  const other = ids.filter((id) => id !== claimed);
  workspace.db.prepare("UPDATE publish_jobs SET status='failed' WHERE id=?").run(other[1] as string); // đã có kết quả cuối

  const result = await pages.disconnect(connectionId);
  assert.equal(result.cancelledJobs, 1);
  assert.equal(status(other[0] as string), 'cancelled');
  assert.equal(status(other[1] as string), 'failed'); // giữ nguyên
  assert.equal(status(claimed), 'running');
  assert.ok(workspace.db.prepare('SELECT stop_requested_at FROM publish_jobs WHERE id=?').get(claimed)?.stop_requested_at); // yêu cầu dừng
  assert.deepEqual(pages.list(), []);
  await assert.rejects(pages.revealToken(connectionId), code('not_ready'));
});
