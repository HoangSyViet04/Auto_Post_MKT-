import assert from 'node:assert/strict';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { createFakePublisher } from '#contracts';
import { createAccountRepository, createGroupRepository, createJobQueries, createJobRepository, createMediaStore, createPostBatchService, openDatabase } from '#storage';
import { createTestWorkspace, seedOfflineScenario } from '#test-support';
import { createJobRunner } from './job-runner.ts';

let ws: ReturnType<typeof createTestWorkspace>;
let scenario: Awaited<ReturnType<typeof seedOfflineScenario>>;
let now: number;
beforeEach(async () => { ws = createTestWorkspace(); scenario = await seedOfflineScenario(ws); now = scenario.state.now; });
afterEach(() => ws.dispose());

function batch(minSeconds: number, maxSeconds: number, size = 2, key = 'interval-batch') {
  const groups = createGroupRepository(ws.db);
  const destinations = [scenario.groupId, ...Array.from({ length: size - 1 }, (_, i) => groups.add({
    reference: String(888888880001 + i), accountId: scenario.accountId, membership: 'joined', permission: 'allowed',
  }).id)];
  const result = createPostBatchService(ws.db, { mode: 'fake', clock: () => now }).submit({
    requestKey: key, accountId: scenario.accountId, productId: scenario.productId, scheduledAt: now,
    postingInterval: { minSeconds, maxSeconds }, items: destinations.map((destinationId) => ({ destinationId, caption: 'Bài thử khoảng nghỉ' })),
  });
  assert.ok(result.ok);
  return result;
}

const intervals = () => ws.db.prepare('SELECT job_id,rest_seconds,rest_until FROM job_posting_intervals ORDER BY job_id').all() as Array<{ job_id: string; rest_seconds: number; rest_until: number | null }>;
function setup(db = ws.db) {
  const group = createFakePublisher('group');
  const runner = createJobRunner({ db, workerId: 'interval-worker', mode: 'fake', clock: () => now, minGapMs: 0,
    overdueAfterMs: 15 * 60_000, media: createMediaStore(db, { dataDir: ws.dataDir }),
    publishers: { group, profile: createFakePublisher('profile'), page: createFakePublisher('page') } });
  return { runner, group };
}

test('nghỉ sau khi gửi xong, rút một lần trong khoảng; mở lại DB và Chạy ngay không bỏ qua nghỉ', async () => {
  batch(60, 120);
  const before = intervals();
  assert.ok(before.every((i) => i.rest_seconds >= 60 && i.rest_seconds <= 120 && i.rest_until === null));
  const f = setup();
  const submit = f.group.submit.bind(f.group);
  f.group.submit = async (req) => { now += 10_000; return submit(req); };
  await f.runner.processNext();
  const finished = intervals().find((i) => i.rest_until !== null);
  assert.ok(finished);
  assert.equal(finished.rest_until, now + finished.rest_seconds * 1000);
  const next = createJobQueries(ws.db, { clock: () => now }).list({ status: 'queued' }).items[0];
  assert.ok(next);
  assert.deepEqual(next.postingInterval, { minSeconds: 60, maxSeconds: 120 });
  assert.equal(next.restUntil, finished.rest_until);
  const reopened = openDatabase(join(ws.dataDir, 'db/test.sqlite'));
  try {
    const restarted = setup(reopened);
    const jobs = createJobRepository(reopened, { clock: () => now });
    jobs.changeState(next.id, 'queued', 'paused'); jobs.changeState(next.id, 'paused', 'queued');
    jobs.reschedule(next.id, now); // UI Chạy ngay changes schedule only, not rest.
    assert.equal(await restarted.runner.processNext(), 'idle');
    now = finished.rest_until - 1;
    assert.equal(await restarted.runner.processNext(), 'idle');
    now += 1;
    assert.equal(await restarted.runner.processNext(), 'processed');
    assert.equal(restarted.group.submitted.length, 1);
    assert.deepEqual(intervals().map((i) => i.rest_seconds), before.map((i) => i.rest_seconds));
  } finally { reopened.close(); }
});

test('nghỉ cố định dài hơn ngưỡng quá hạn: các nhóm phía sau vẫn tới lượt, không gửi dồn', async () => {
  batch(1200, 1200, 3);
  const f = setup();
  for (let i = 0; i < 3; i += 1) {
    assert.equal(await f.runner.processNext(), 'processed');
    assert.equal(f.group.submitted.length, i + 1);
    assert.equal(await f.runner.processNext(), 'idle');
    const pending = createJobQueries(ws.db, { clock: () => now }).list({ status: 'queued' }).items;
    assert.ok(pending.every((j) => j.scheduledAt === now + 1200_000 && !j.overdue));
    now += 1200_000;
  }
});

test('unknown vẫn nghỉ và không gửi lại; lô khác cùng tài khoản cũng phải chờ', async () => {
  batch(60, 60, 1);
  const f = setup();
  f.group.submit = async () => ({ status: 'unknown', reason: 'mất phản hồi giả' });
  await f.runner.processNext();
  batch(10, 10, 1, 'interval-other-batch');
  assert.equal(await setup().runner.processNext(), 'idle');
  assert.equal(createJobQueries(ws.db).list({ status: 'unknown' }).total, 1);
  now += 60_000;
  const later = setup();
  assert.equal(await later.runner.processNext(), 'processed');
  assert.equal(later.group.submitted.length, 1);
});

test('worker chết sau mốc gửi: phục hồi unknown và nghỉ bền; chết trước gửi không tạo nghỉ giả', async () => {
  batch(90, 90);
  const jobs = createJobRepository(ws.db, { clock: () => now });
  const first = jobs.claimNext('dead-worker', 'fake', 1000);
  assert.ok(first); jobs.markSendStarted(first);
  now += 1001;
  const f = setup();
  assert.equal(await f.runner.processNext(), 'idle');
  assert.equal(jobs.get(first.jobId).status, 'unknown');
  const until = intervals().find((i) => i.job_id === first.jobId)?.rest_until;
  assert.equal(until, now + 90_000);
  now += 90_000;
  const next = jobs.claimNext('dead-before-send', 'fake', 1000);
  assert.ok(next); now += 1001; jobs.recoverExpired('fake');
  assert.equal(jobs.get(next.jobId).status, 'paused');
  assert.equal(intervals().find((i) => i.job_id === next.jobId)?.rest_until, null);
});

test('lỗi trước mốc gửi không nghỉ và không gửi', async () => {
  batch(0, 0);
  const f = setup();
  f.group.prepare = async () => ({ ok: false, reasonCode: 'media_invalid', reason: 'ảnh giả hỏng' });
  assert.equal(await f.runner.processNext(), 'processed');
  assert.equal(await f.runner.processNext(), 'processed');
  assert.equal(f.group.submitted.length, 0);
  assert.ok(intervals().every((i) => i.rest_until === null && i.rest_seconds === 0));
});

test('khoảng riêng 0–0 thay mặc định môi trường; thời gian chờ của nick này không chặn nick khác', async () => {
  batch(0, 0);
  const f = setup();
  const withFallback = createJobRunner({ db: ws.db, workerId: 'fallback-test', mode: 'fake', clock: () => now, minGapMs: 600_000,
    media: ws.media, publishers: { group: f.group, profile: createFakePublisher('profile'), page: createFakePublisher('page') } });
  assert.equal(await withFallback.processNext(), 'processed');
  assert.equal(await withFallback.processNext(), 'processed');
  assert.equal(f.group.submitted.length, 2);
  batch(60, 60, 1, 'waiting-nick-one'); await withFallback.processNext();
  const accounts = createAccountRepository(ws.db);
  const other = accounts.create({ label: 'Nick khác' }).id;
  accounts.recordIdentity(other, 'vanity:other.interval'); accounts.recordSession(other, 'logged_in');
  createGroupRepository(ws.db).add({ accountId: other, reference: '999999991111', membership: 'joined', permission: 'allowed' });
  const dest = createGroupRepository(ws.db).list({ accountId: other }).items[0]?.id;
  assert.ok(dest);
  const result = createPostBatchService(ws.db, { mode: 'fake', clock: () => now }).submit({ requestKey: 'other-nick-interval',
    accountId: other, productId: scenario.productId, scheduledAt: now, postingInterval: { minSeconds: 30, maxSeconds: 30 },
    items: [{ destinationId: dest, caption: 'Bài nick thứ hai' }] });
  assert.ok(result.ok);
  assert.equal(await withFallback.processNext(), 'processed');
  assert.equal(f.group.submitted.length, 4);
});
