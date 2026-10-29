import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { BusinessError, type BusinessErrorCode } from '#domain';
import { createTestWorkspace, seedOfflineScenario } from '#test-support';
import { createAccountRepository } from './account-repository.ts';
import { createContentRepository } from './content-repository.ts';
import { createGroupRepository } from './group-repository.ts';
import { createPostBatchService } from './post-batch.ts';

let workspace: ReturnType<typeof createTestWorkspace>;
let scenario: Awaited<ReturnType<typeof seedOfflineScenario>>;
let service: ReturnType<typeof createPostBatchService>;
let second: string; // nhóm thứ hai đủ điều kiện
let blocked: string; // nhóm chưa được khai báo quyền đăng
const count = (table: string) => Number(workspace.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n);
const code = (expected: BusinessErrorCode) => (error: unknown) => error instanceof BusinessError && error.code === expected;

beforeEach(async () => {
  workspace = createTestWorkspace();
  scenario = await seedOfflineScenario(workspace);
  const groups = createGroupRepository(workspace.db, { clock: () => scenario.state.now });
  second = groups.add({ reference: '222222222222', accountId: scenario.accountId, name: 'Nhóm hai', membership: 'joined', permission: 'allowed' }).id;
  blocked = groups.add({ reference: '333333333333', accountId: scenario.accountId, name: 'Nhóm chưa có quyền', membership: 'joined' }).id;
  service = createPostBatchService(workspace.db, { mode: 'fake', clock: () => scenario.state.now });
});
afterEach(() => { workspace.dispose(); });

const input = (overrides: Record<string, unknown> = {}) => ({
  requestKey: 'khoa-yeu-cau-0001', accountId: scenario.accountId, productId: scenario.productId, scheduledAt: scenario.state.now,
  items: [{ destinationId: scenario.groupId, caption: 'Caption nhóm một\nDòng hai' }, { destinationId: second, caption: 'Caption nhóm hai' }], ...overrides,
}) as Parameters<typeof service.submit>[0];

test('tạo bản caption riêng từng đích (đúng ảnh và thứ tự của máy), duyệt và xếp một job cho mỗi đích', () => {
  const result = service.submit(input());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.replayed, false);
  assert.deepEqual(result.jobs.map((job) => job.destinationId).sort(), [scenario.groupId, second].sort());
  assert.deepEqual([count('content_versions') - 1, count('approvals') - 1, count('publish_jobs')], [2, 2, 2]); // trừ bản của fixture
  const rows = workspace.db.prepare(`SELECT c.caption,d.id AS dest,(SELECT count(*) FROM content_version_media m WHERE m.content_version_id=c.id) AS media
    FROM publish_jobs j JOIN approvals a ON a.id=j.approval_id JOIN content_versions c ON c.id=a.content_version_id JOIN destinations d ON d.id=a.destination_id
    WHERE j.request_id=? ORDER BY d.id`).all(result.requestId) as Array<{ caption: string; dest: string; media: number }>;
  const byDest = Object.fromEntries(rows.map((row) => [row.dest, row]));
  assert.equal(byDest[scenario.groupId]?.caption, 'Caption nhóm một\nDòng hai');
  assert.equal(byDest[second]?.caption, 'Caption nhóm hai');
  assert.ok(rows.every((row) => row.media === scenario.mediaIds.length));
  assert.deepEqual(workspace.db.prepare("SELECT DISTINCT status FROM publish_jobs WHERE request_id=?").all(result.requestId).map((r) => r.status), ['queued']);
});

test('khoảng nghỉ: lưu min/max và draw trong giới hạn; replay không rút lại, đổi khoảng phải dùng mã mới', () => {
  const payload = input({ postingInterval: { minSeconds: 2, maxSeconds: 8 } });
  assert.ok(service.submit(payload).ok);
  const rows = workspace.db.prepare('SELECT * FROM job_posting_intervals ORDER BY job_id').all();
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.min_seconds === 2 && r.max_seconds === 8 && Number(r.rest_seconds) >= 2 && Number(r.rest_seconds) <= 8));
  assert.ok(service.submit(payload).ok);
  assert.deepEqual(workspace.db.prepare('SELECT * FROM job_posting_intervals ORDER BY job_id').all(), rows);
  assert.throws(() => service.submit(input({ postingInterval: { minSeconds: 3, maxSeconds: 8 } })), code('idempotency_conflict'));
  for (const postingInterval of [{ minSeconds: 5, maxSeconds: 4 }, { minSeconds: -1, maxSeconds: 5 }, { minSeconds: 1.5, maxSeconds: 5 },
    { minSeconds: 0, maxSeconds: 86401 }, { minSeconds: '2', maxSeconds: 5 }, { minSeconds: 0 }, null]) {
    assert.throws(() => service.submit(input({ postingInterval })), code('invalid_input'));
  }
  assert.equal(count('publish_jobs'), 2);
});

test('bấm gửi hai lần cùng mã yêu cầu: trả lại kết quả cũ, không tạo thêm bản/duyệt/job; cùng mã nhưng nội dung khác bị từ chối', () => {
  const first = service.submit(input());
  assert.equal(first.ok, true);
  const before = [count('content_versions'), count('approvals'), count('publish_jobs')];
  const replay = service.submit(input());
  assert.equal(replay.ok && replay.replayed, true);
  assert.deepEqual(replay.ok && replay.jobs.map((job) => job.jobId).sort(), first.ok ? first.jobs.map((job) => job.jobId).sort() : []);
  assert.deepEqual([count('content_versions'), count('approvals'), count('publish_jobs')], before);
  assert.throws(() => service.submit(input({ items: [{ destinationId: scenario.groupId, caption: 'Caption khác' }] })), code('idempotency_conflict'));
  assert.equal(count('publish_jobs'), 2);
});

test('tất cả hoặc không gì: một đích không đủ điều kiện thì không xếp job nào, trả đúng đích bị chặn và mã khóa vẫn dùng lại được', () => {
  const bad = service.submit(input({ items: [{ destinationId: scenario.groupId, caption: 'A' }, { destinationId: blocked, caption: 'B' }] }));
  assert.deepEqual(bad, { ok: false, failures: [{ destinationId: blocked, code: 'not_ready' }] });
  assert.deepEqual([count('publish_jobs'), count('command_requests')], [0, 0]); // không job, không đánh dấu mã yêu cầu đã dùng
  const good = service.submit(input({ items: [{ destinationId: scenario.groupId, caption: 'A' }] })); // bỏ nhóm bị chặn, dùng lại cùng mã
  assert.equal(good.ok, true);
  assert.equal(count('publish_jobs'), 1);
});

test('từ chối đầu vào sai: trùng đích, rỗng, caption trống; máy đã bán; tài khoản chưa có danh tính', () => {
  assert.throws(() => service.submit(input({ items: [{ destinationId: second, caption: 'A' }, { destinationId: second, caption: 'B' }] })), code('invalid_input'));
  assert.throws(() => service.submit(input({ items: [] })), code('invalid_input'));
  assert.throws(() => service.submit(input({ items: [{ destinationId: second, caption: '   ' }] })), code('invalid_input'));

  const bare = createAccountRepository(workspace.db, { clock: () => scenario.state.now }).create({ label: 'Chưa đăng nhập' }).id;
  assert.throws(() => service.submit(input({ accountId: bare, requestKey: 'khoa-chua-dang-nhap' })), code('not_ready'));

  createContentRepository(workspace.db, { clock: () => scenario.state.now }).setProductStatus(scenario.productId, 'sold');
  assert.throws(() => service.submit(input({ requestKey: 'khoa-may-da-ban' })), code('not_ready'));
  assert.equal(count('publish_jobs'), 0);
});
