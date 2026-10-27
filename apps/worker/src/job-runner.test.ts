import assert from 'node:assert/strict';
import { unlink } from 'node:fs/promises';
import { afterEach, beforeEach, test } from 'node:test';
import { createFakePublisher, type FakePublisher, type Publisher, type SubmitResult } from '#contracts';
import { CHANNELS, type Channel } from '#domain';
import { createAccountRepository, createJobRepository, createLeaseRepository } from '#storage';
import { createTestWorkspace, seedOfflineScenario } from '#test-support';
import { createJobRunner, type JobRunnerDeps } from './job-runner.ts';

let workspace: ReturnType<typeof createTestWorkspace>;
let scenario: Awaited<ReturnType<typeof seedOfflineScenario>>;
let fakes: Record<Channel, FakePublisher>;
let override: Partial<Record<Channel, Publisher>> = {};
const clock = { now: 1_700_000_000_000 };
const job = (id: string) => workspace.db.prepare(`SELECT status,scheduled_at FROM publish_jobs WHERE id=?`).get(id) as { status: string; scheduled_at: number };
const sendMarked = (id: string) => Number(workspace.db.prepare('SELECT count(*) AS n FROM publish_attempts WHERE job_id=? AND send_started_at IS NOT NULL').get(id)?.n);

function runner(extra: Partial<JobRunnerDeps> = {}) {
  const publishers = Object.fromEntries(CHANNELS.map((channel) => [channel, override[channel] ?? fakes[channel]])) as Record<Channel, Publisher>;
  return createJobRunner({ db: workspace.db, workerId: 'worker-test', mode: 'fake', publishers, media: workspace.media, clock: () => clock.now, ...extra });
}
const fakeWith = (submit: (() => SubmitResult) | undefined) => createFakePublisher('group', submit ? { submit } : {});

beforeEach(async () => {
  workspace = createTestWorkspace();
  scenario = await seedOfflineScenario(workspace);
  clock.now = scenario.state.now;
  fakes = { profile: createFakePublisher('profile'), group: createFakePublisher('group'), page: createFakePublisher('page') };
  override = {};
});
afterEach(() => { workspace.dispose(); });

test('đến hạn thì chạy đúng một lần: ghi mốc gửi trước, kết quả giả có nguồn fake, nhả khóa; lần sau rảnh', async () => {
  const queued = scenario.enqueue();
  assert.equal(await runner().processNext(), 'processed');
  assert.equal(job(queued.id).status, 'published');
  assert.equal(sendMarked(queued.id), 1);
  assert.equal(fakes.group.submitted.length, 1);
  assert.equal(workspace.db.prepare('SELECT source FROM publish_observations').get()?.source, 'fake');
  assert.equal(createLeaseRepository(workspace.db, { clock: () => clock.now }).isBrowserBusy(scenario.accountId), false);
  assert.deepEqual(workspace.db.prepare('SELECT action_code FROM activity_log ORDER BY rowid').all().map((r) => r.action_code), ['send_started', 'job_published']);
  assert.equal(await runner().processNext(), 'idle');
  assert.equal(fakes.group.submitted.length, 1); // không gửi lại
});

test('job chưa đến hạn không chạy; job quá hạn không tự chạy (không phát dồn bài cũ) cho tới khi người dùng chọn tiếp tục', async () => {
  const future = scenario.enqueue('khoa-tuong-lai', clock.now + 60_000);
  assert.equal(await runner().processNext(), 'idle');
  assert.equal(job(future.id).status, 'queued');

  clock.now += 3 * 60 * 60_000; // máy tắt 3 giờ: job đã trễ nhiều
  const overdue = { overdueAfterMs: 15 * 60_000 };
  assert.equal(await runner(overdue).processNext(), 'idle');
  assert.equal(job(future.id).status, 'queued');
  assert.equal(fakes.group.submitted.length, 0);

  createJobRepository(workspace.db, { clock: () => clock.now }).reschedule(future.id, clock.now); // "tiếp tục": chạy từ bây giờ
  assert.equal(await runner(overdue).processNext(), 'processed');
  assert.equal(job(future.id).status, 'published');
});

test('kết quả không rõ hoặc adapter ném lỗi sau mốc gửi: unknown và KHÔNG gửi lại; chờ duyệt được ghi nhận riêng', async () => {
  const first = scenario.enqueue('k1');
  override = { group: fakeWith(() => ({ status: 'unknown', reason: 'timeout' })) };
  await runner().processNext();
  assert.equal(job(first.id).status, 'unknown');
  assert.equal(await runner().processNext(), 'idle'); // không tự nhận lại job có thể đã gửi
  assert.equal((override.group as FakePublisher).submitted.length, 1);

  const second = scenario.enqueue('k2');
  override = { group: fakeWith(() => { throw new Error('mất kết nối sau khi bấm gửi'); }) };
  await runner().processNext();
  assert.equal(job(second.id).status, 'unknown');
  assert.equal(sendMarked(second.id), 1);

  const third = scenario.enqueue('k3');
  override = { group: fakeWith(() => ({ status: 'pending_approval' })) };
  await runner().processNext();
  assert.equal(job(third.id).status, 'pending_approval');
});

test('lỗi trước khi gửi (prepare, ảnh mất) → failed không có mốc gửi và không gọi submit; ảnh mất không biến bài thành chỉ chữ', async () => {
  const first = scenario.enqueue('p1');
  const fake = fakeWith(undefined);
  override = { group: { ...fake, capabilities: fake.capabilities, prepare: async () => ({ ok: false, reasonCode: 'destination_not_allowed', reason: 'x' }), submit: fake.submit, verify: fake.verify, stop: fake.stop } };
  await runner().processNext();
  assert.deepEqual([job(first.id).status, sendMarked(first.id), fake.submitted.length], ['failed', 0, 0]);
  assert.equal(workspace.db.prepare('SELECT reason_code FROM publish_observations').get()?.reason_code, 'destination_not_allowed');

  override = {};
  const second = scenario.enqueue('p2');
  await unlink((await workspace.media.verify(scenario.image.id)).path);
  await runner().processNext();
  assert.deepEqual([job(second.id).status, sendMarked(second.id), fakes.group.submitted.length], ['failed', 0, 0]);
  assert.equal(workspace.db.prepare('SELECT reason_code FROM publish_observations ORDER BY rowid DESC').get()?.reason_code, 'media_invalid');
});

test('yêu cầu dừng trước mốc gửi: job bị hủy, không gửi', async () => {
  const queued = scenario.enqueue('s1');
  const fake = fakeWith(undefined);
  override = { group: { ...fake, capabilities: fake.capabilities, submit: fake.submit, verify: fake.verify, stop: fake.stop,
    prepare: async (request) => { createJobRepository(workspace.db, { clock: () => clock.now }).requestStop(request.jobId); return { ok: true }; } } };
  await runner().processNext();
  assert.deepEqual([job(queued.id).status, sendMarked(queued.id), fake.submitted.length], ['cancelled', 0, 0]);
});

test('tuần tự theo tài khoản: khóa trình duyệt đang bận hoặc chưa đủ giãn cách thì job chờ; hết bận/đủ giãn cách thì chạy', async () => {
  const leases = createLeaseRepository(workspace.db, { clock: () => clock.now });
  const first = scenario.enqueue('t1');
  const second = scenario.enqueue('t2');
  const held = leases.acquireBrowser(scenario.accountId, 'dang-nhap-tay', 60_000); // người dùng đang đăng nhập tay
  assert.equal(await runner().processNext(), 'idle');
  assert.deepEqual([job(first.id).status, job(second.id).status], ['queued', 'queued']);
  leases.release(held);

  const spaced = { minGapMs: 120_000 };
  assert.equal(await runner(spaced).processNext(), 'processed'); // job đầu chạy
  assert.equal(await runner(spaced).processNext(), 'idle'); // job hai phải chờ đủ giãn cách
  assert.equal(fakes.group.submitted.length, 1);
  clock.now += 121_000;
  assert.equal(await runner(spaced).processNext(), 'processed');
  assert.equal(fakes.group.submitted.length, 2);
  assert.deepEqual([job(first.id).status, job(second.id).status], ['published', 'published']);
});

test('phiên hết hạn/checkpoint khi gửi: chỉ chặn đúng tài khoản đó; job sau của tài khoản đó bị chặn thay vì chạy', async () => {
  const first = scenario.enqueue('e1');
  const next = scenario.enqueue('e2'); // đã xếp hàng trước khi phiên hết hạn
  override = { group: fakeWith(() => ({ status: 'failed', reason: 'phiên hết hạn', reasonCode: 'session_expired' })) };
  await runner().processNext();
  // Hai job cùng giờ hẹn: thứ tự theo id nên không biết job nào chạy trước; một job lỗi, job kia vẫn chờ.
  assert.deepEqual([job(first.id).status, job(next.id).status].sort(), ['failed', 'queued']);
  assert.equal(createAccountRepository(workspace.db).get(scenario.accountId).sessionStatus, 'login_required');

  override = {};
  assert.equal(await runner().processNext(), 'idle'); // không nhận được: tài khoản chưa đăng nhập
  assert.deepEqual([job(first.id).status, job(next.id).status].sort(), ['blocked', 'failed']); // chặn thay vì chạy
  assert.equal(fakes.group.submitted.length, 0);
  assert.throws(() => scenario.enqueue('e3'), (error: unknown) => (error as { code?: string }).code === 'not_ready'); // không cho xếp job mới
});

test('worker chết giữa chừng: trước mốc gửi → paused, sau mốc gửi → unknown; không tự chạy lại', async () => {
  const jobs = createJobRepository(workspace.db, { clock: () => clock.now });
  const before = scenario.enqueue('c1');
  const claimBefore = jobs.claimNext('worker-chet', 'fake', 1_000);
  assert.equal(claimBefore?.jobId, before.id); // nhận rồi chết, chưa gửi
  clock.now += 5_000;
  assert.equal(await runner().processNext(), 'idle');
  assert.equal(job(before.id).status, 'paused');

  const after = scenario.enqueue('c2');
  const claimAfter = jobs.claimNext('worker-chet', 'fake', 1_000);
  assert.equal(claimAfter?.jobId, after.id);
  jobs.markSendStarted(claimAfter as NonNullable<typeof claimAfter>); // đã ghi mốc gửi rồi chết
  clock.now += 5_000;
  assert.equal(await runner().processNext(), 'idle');
  assert.equal(job(after.id).status, 'unknown');
  assert.equal(fakes.group.submitted.length, 0); // không ai gửi lại
});

test('nhiều đích, kết quả xen kẽ: một đích lỗi không chặn đích khác; giãn cách tính theo mốc gửi thực tế, không theo số lần thành công', async () => {
  const jobs = [scenario.enqueue('x1'), scenario.enqueue('x2'), scenario.enqueue('x3')];
  const outcomes: SubmitResult[] = [{ status: 'published', remoteId: 'r1' }, { status: 'failed', reason: 'x', reasonCode: 'ui_changed' }, { status: 'published', remoteId: 'r3' }];
  let call = 0;
  override = { group: fakeWith(() => outcomes[call++] as SubmitResult) };
  const spaced = { minGapMs: 60_000 };
  assert.equal(await runner(spaced).processNext(), 'processed'); // 1: thành công
  assert.equal(await runner(spaced).processNext(), 'idle'); // chưa đủ giãn cách từ mốc gửi của job 1
  clock.now += 61_000;
  assert.equal(await runner(spaced).processNext(), 'processed'); // 2: lỗi giao diện
  clock.now += 61_000;
  assert.equal(await runner(spaced).processNext(), 'processed'); // 3: vẫn chạy bình thường sau một lỗi
  const statuses = jobs.map((item) => job(item.id).status).sort();
  assert.deepEqual(statuses, ['failed', 'published', 'published']);
  assert.equal(createAccountRepository(workspace.db).get(scenario.accountId).sessionStatus, 'logged_in'); // ui_changed không đổi phiên
  assert.equal((override.group as FakePublisher).submitted.length, 3); // mỗi job gửi đúng một lần
});
