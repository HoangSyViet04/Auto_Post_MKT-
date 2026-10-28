import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, test } from 'node:test';
import { BusinessError, type BusinessErrorCode } from '#domain';
import { createTestWorkspace, seedOfflineScenario } from '#test-support';
import { createJobQueries } from './job-query.ts';
import { createPresetRepository } from './preset-repository.ts';

let workspace: ReturnType<typeof createTestWorkspace>;
let scenario: Awaited<ReturnType<typeof seedOfflineScenario>>;
const code = (expected: BusinessErrorCode) => (error: unknown) => error instanceof BusinessError && error.code === expected;
const count = (table: string) => Number(workspace.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n);

beforeEach(async () => {
  workspace = createTestWorkspace();
  scenario = await seedOfflineScenario(workspace);
});
afterEach(() => { workspace.dispose(); });

test('cấu hình thường dùng: lưu cặp tài khoản–đích rõ ràng, sửa, ngừng dùng; lưu/áp dụng không tạo job', () => {
  const presets = createPresetRepository(workspace.db, { clock: () => scenario.state.now });
  const jobsBefore = count('publish_jobs');
  const created = presets.create({ label: ' Máy mới buổi sáng ', captionTemplate: '{ten}\nGiá: {gia}', schedule: { startMode: 'daily', timeOfDay: '08:30' },
    targets: [{ accountId: scenario.accountId, destinationId: scenario.groupId }] });
  assert.equal(created.label, 'Máy mới buổi sáng');
  assert.deepEqual(created.schedule, { startMode: 'daily', timeOfDay: '08:30' });
  assert.deepEqual(created.targets.map((t) => [t.accountId, t.destinationId, t.channel, t.externalId]), [[scenario.accountId, scenario.groupId, 'group', 'fake-group']]);
  assert.equal(presets.list().length, 1);

  const updated = presets.update(created.id, { label: 'Đổi tên', captionTemplate: null, schedule: { startMode: 'now' }, targets: [{ accountId: scenario.accountId, destinationId: scenario.groupId }] });
  assert.deepEqual([updated.label, updated.captionTemplate, updated.schedule], ['Đổi tên', null, { startMode: 'now' }]);
  assert.equal(count('preset_targets'), 1); // thay hẳn danh sách đích, không cộng dồn

  presets.archive(created.id);
  assert.deepEqual(presets.list(), []);
  assert.throws(() => presets.update(created.id, { label: 'x', schedule: { startMode: 'now' }, targets: [{ accountId: scenario.accountId, destinationId: scenario.groupId }] }), code('not_found'));
  assert.equal(count('publish_jobs'), jobsBefore); // chỉ là dữ liệu điền sẵn
});

test('từ chối cấu hình sai: chỗ trống lạ, giờ sai, trùng cặp, không có quan hệ tài khoản–đích, đích fanpage, tài khoản/đích không tồn tại', () => {
  const presets = createPresetRepository(workspace.db, { clock: () => scenario.state.now });
  const target = { accountId: scenario.accountId, destinationId: scenario.groupId };
  const base = { label: 'x', schedule: { startMode: 'now' as const }, targets: [target] };
  assert.throws(() => presets.create({ ...base, captionTemplate: '{ten}\n{gía}' }), code('invalid_input'));
  assert.throws(() => presets.create({ ...base, schedule: { startMode: 'daily', timeOfDay: '25:00' } }), code('invalid_input'));
  assert.throws(() => presets.create({ ...base, schedule: { startMode: 'now', timeOfDay: '08:00' } as never }), code('invalid_input'));
  assert.throws(() => presets.create({ ...base, targets: [target, target] }), code('invalid_input'));
  assert.throws(() => presets.create({ ...base, targets: [] }), code('invalid_input'));
  assert.throws(() => presets.create({ ...base, label: '   ' }), code('invalid_input'));

  const unlinked = randomUUID();
  workspace.db.prepare("INSERT INTO destinations(id,channel,external_id,created_at) VALUES(?,'group','chua-lien-ket',?)").run(unlinked, scenario.state.now);
  assert.throws(() => presets.create({ ...base, targets: [{ accountId: scenario.accountId, destinationId: unlinked }] }), code('not_found')); // tài khoản chưa có quan hệ với nhóm
  const page = randomUUID();
  workspace.db.prepare("INSERT INTO destinations(id,channel,external_id,created_at) VALUES(?,'page','fanpage-1',?)").run(page, scenario.state.now);
  assert.throws(() => presets.create({ ...base, targets: [{ accountId: scenario.accountId, destinationId: page }] }), code('invalid_input'));
  assert.throws(() => presets.create({ ...base, targets: [{ accountId: randomUUID(), destinationId: scenario.groupId }] }), code('not_found'));
  assert.throws(() => presets.create({ ...base, targets: [{ accountId: scenario.accountId, destinationId: randomUUID() }] }), code('not_found'));
  assert.equal(count('posting_presets'), 0); // lỗi không để lại dữ liệu dở dang
});

test('xem trước tác động của việc sửa/bán máy lên job đã xếp, khớp với điều thực sự xảy ra', () => {
  const queries = createJobQueries(workspace.db, { clock: () => scenario.state.now });
  assert.deepEqual(queries.productImpact(scenario.productId), { productId: scenario.productId, pendingJobs: 0, runningJobs: 0, settledJobs: 0, byStatus: {} });
  const first = scenario.enqueue('i1');
  const second = scenario.enqueue('i2');
  // job được nhận đầu tiên đã gửi xong (unknown) nên không bị ảnh hưởng; job còn lại vẫn chờ
  const claim = scenario.jobs.claimNext('worker-test', 'fake');
  assert.ok(claim);
  scenario.jobs.markSendStarted(claim);
  scenario.jobs.finish(claim, { outcome: 'unknown', source: 'fake', reasonCode: 'unknown' });
  const impact = queries.productImpact(scenario.productId);
  assert.deepEqual([impact.pendingJobs, impact.runningJobs, impact.settledJobs], [1, 0, 1]);
  assert.deepEqual(impact.byStatus, { queued: 1, unknown: 1 });
  const waiting = claim.jobId === first.id ? second.id : first.id;

  scenario.content.reviseProduct(scenario.productId, scenario.revisionId, { name: 'iPhone 13 (sửa)', condition: 'Mới hơn', mediaIds: scenario.mediaIds });
  const after = (id: string) => workspace.db.prepare('SELECT status FROM publish_jobs WHERE id=?').get(id)?.status;
  assert.deepEqual([after(waiting), after(claim.jobId)], ['needs_review', 'unknown']); // đúng như xem trước: chưa gửi → cần xem lại; đã gửi → giữ nguyên
  assert.throws(() => queries.productImpact(randomUUID()), code('not_found'));
});
