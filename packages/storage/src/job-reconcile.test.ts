import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { BusinessError, type BusinessErrorCode } from '#domain';
import { createTestWorkspace, seedOfflineScenario } from '#test-support';
import { createJobQueries } from './job-query.ts';

let workspace: ReturnType<typeof createTestWorkspace>;
let scenario: Awaited<ReturnType<typeof seedOfflineScenario>>;
let queries: ReturnType<typeof createJobQueries>;
const code = (expected: BusinessErrorCode) => (error: unknown) => error instanceof BusinessError && error.code === expected;
const status = (id: string) => workspace.db.prepare('SELECT status FROM publish_jobs WHERE id=?').get(id)?.status;

beforeEach(async () => {
  workspace = createTestWorkspace();
  scenario = await seedOfflineScenario(workspace);
  queries = createJobQueries(workspace.db, { clock: () => scenario.state.now });
});
afterEach(() => { workspace.dispose(); });

/** Chạy một job tới trạng thái cho trước (đã ghi mốc gửi, kết quả chưa chắc). */
function sendAndFinish(key: string, outcome: 'unknown' | 'pending_approval' | 'published') {
  const queued = scenario.enqueue(key);
  const claim = scenario.jobs.claimNext('worker-test', 'fake');
  assert.equal(claim?.jobId, queued.id);
  scenario.jobs.markSendStarted(claim as NonNullable<typeof claim>);
  scenario.jobs.finish(claim as NonNullable<typeof claim>, outcome === 'published'
    ? { outcome, source: 'fake', remoteId: 'r1' } : { outcome, source: 'fake', reasonCode: 'unknown' });
  return queued.id;
}

test('đối chiếu job unknown: xác nhận thủ công có nguồn và quan sát mới; không có đường nào đưa job về hàng chờ để gửi lại', () => {
  const id = sendAndFinish('r1', 'unknown');
  assert.equal(status(id), 'unknown');
  const done = scenario.jobs.reconcile(id, { resolution: 'published', source: 'manual', remoteUrl: 'https://www.facebook.com/groups/1/posts/2' });
  assert.equal(done.status, 'published');
  const detail = queries.detail(id);
  assert.deepEqual(detail.attemptsDetail[0]?.observations.map((o) => [o.outcome, o.source]), [['unknown', 'fake'], ['published', 'manual']]); // lịch sử giữ nguyên, thêm quan sát mới
  assert.equal(detail.attemptsDetail[0]?.observations[1]?.remoteUrl, 'https://www.facebook.com/groups/1/posts/2');
  assert.ok(detail.activity.some((entry) => entry.actionCode === 'job_reconciled' && entry.reasonCode === 'manual_published'));
  assert.throws(() => scenario.jobs.reconcile(id, { resolution: 'not_published', source: 'manual' }), code('invalid_transition')); // đã chốt, không đổi lại

  const second = sendAndFinish('r2', 'unknown');
  const failed = scenario.jobs.reconcile(second, { resolution: 'not_published', source: 'manual' });
  assert.equal(failed.status, 'failed');
  assert.deepEqual(queries.detail(second).attemptsDetail[0]?.observations.at(-1) && [queries.detail(second).attemptsDetail[0]?.observations.at(-1)?.outcome,
    queries.detail(second).attemptsDetail[0]?.observations.at(-1)?.reasonCode], ['not_found', 'confirmed_not_posted']);
  for (const next of ['queued', 'paused', 'cancelled'] as const) assert.throws(() => scenario.jobs.changeState(second, 'failed', next), code('invalid_transition')); // không thử lại mù
  assert.equal(scenario.jobs.claimNext('worker-test', 'fake'), undefined); // không có gì để nhận lại
});

test('pending_approval không tự thành published: chỉ đổi khi có xác nhận; không đối chiếu được job chưa từng gửi hoặc nguồn/URL không an toàn', () => {
  const pending = sendAndFinish('p1', 'pending_approval');
  assert.throws(() => scenario.jobs.reconcile(pending, { resolution: 'pending_approval', source: 'manual' }), code('invalid_transition')); // vẫn đang chờ
  // Nguồn ui_observation chỉ hợp lệ cho job chế độ live (do worker quan sát thật); job mô phỏng chỉ nhận xác nhận thủ công.
  assert.throws(() => scenario.jobs.reconcile(pending, { resolution: 'published', source: 'ui_observation', remoteId: 'x1' }), code('conflict'));
  assert.equal(status(pending), 'pending_approval');
  assert.equal(scenario.jobs.reconcile(pending, { resolution: 'published', source: 'manual', remoteId: 'x1' }).status, 'published');

  const rejected = sendAndFinish('p2', 'pending_approval');
  assert.equal(scenario.jobs.reconcile(rejected, { resolution: 'not_published', source: 'manual' }).status, 'failed'); // admin từ chối

  const unsent = scenario.enqueue('p3'); // đang chờ, chưa gửi
  assert.throws(() => scenario.jobs.reconcile(unsent.id, { resolution: 'published', source: 'manual', remoteId: 'x' }), code('invalid_transition'));
  scenario.jobs.changeState(unsent.id, 'queued', 'cancelled'); // dọn để không bị nhận nhầm ở bước sau
  const unknown = sendAndFinish('p4', 'unknown');
  assert.throws(() => scenario.jobs.reconcile(unknown, { resolution: 'published', source: 'manual', remoteUrl: 'https://x.test/p?token=abc' }), code('invalid_input'));
  assert.throws(() => scenario.jobs.reconcile(unknown, { resolution: 'published', source: 'bot' as never }), code('invalid_input'));
  assert.equal(status(unknown), 'unknown');
  const noId = scenario.jobs.reconcile(unknown, { resolution: 'published', source: 'manual' }); // người dùng thấy bài nhưng không có ID
  assert.equal(noId.status, 'published');
  assert.equal(queries.detail(unknown).attemptsDetail[0]?.observations.at(-1)?.remoteId, 'manual:no_id');
});

test('chi tiết giữ nguyên phiên bản đã duyệt khi máy sửa sau đó; bộ lọc theo máy/đích/giờ/mã job; máy sửa/đã bán được phản ánh', () => {
  const first = scenario.enqueue('f1');
  const detailBefore = queries.detail(first.id);
  assert.equal(detailBefore.caption, scenario.versionInput.caption);
  assert.deepEqual(detailBefore.mediaIds, [...scenario.mediaIds].reverse()); // ảnh theo thứ tự đã lưu của bản duyệt
  assert.deepEqual([detailBefore.approvedRevisionNo, detailBefore.currentRevisionNo, detailBefore.productStatus], [1, 1, 'selling']);

  scenario.content.reviseProduct(scenario.productId, scenario.revisionId, { name: 'iPhone 13 (sửa)', condition: 'Mới hơn', mediaIds: scenario.mediaIds });
  const afterEdit = queries.detail(first.id);
  assert.deepEqual([afterEdit.status, afterEdit.approvedRevisionNo, afterEdit.currentRevisionNo], ['needs_review', 1, 2]); // cần xem lại, bản duyệt vẫn là bản 1
  assert.equal(afterEdit.caption, scenario.versionInput.caption); // không âm thầm sửa bài đã duyệt
  assert.equal(afterEdit.productName, 'iPhone 13'); // tên của phiên bản đã duyệt

  const all = queries.list({});
  assert.equal(all.total, 1);
  assert.equal(queries.list({ productId: scenario.productId }).total, 1);
  assert.equal(queries.list({ destinationId: scenario.groupId }).total, 1);
  assert.equal(queries.list({ destinationId: '00000000-0000-4000-8000-000000000000' }).total, 0);
  assert.equal(queries.list({ accountId: scenario.accountId }).total, 1);
  const at = all.items[0]?.scheduledAt ?? 0;
  assert.equal(queries.list({ from: at, to: at }).total, 1);
  assert.equal(queries.list({ from: at + 1 }).total, 0);
  assert.equal(queries.list({ jobId: first.id }).items[0]?.id, first.id);
  assert.throws(() => queries.detail('00000000-0000-4000-8000-000000000000'), code('not_found'));
  assert.throws(() => queries.list({ from: -1 }), code('invalid_input'));

  scenario.content.setProductStatus(scenario.productId, 'sold');
  assert.equal(queries.detail(first.id).productStatus, 'sold');
});
