import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { createFakePublisher, type Publisher, type SubmitResult } from '#contracts';
import { CHANNELS, type Channel } from '#domain';
import { createPageRepository, createSecretStore } from '#storage';
import { createTestWorkspace, seedOfflineScenario } from '#test-support';
import { createJobRunner } from './job-runner.ts';

const PAGE_ID = '107892312229541';
let workspace: ReturnType<typeof createTestWorkspace>;
let scenario: Awaited<ReturnType<typeof seedOfflineScenario>>;
let pages: ReturnType<typeof createPageRepository>;
let connectionId: string;
let calls: { prepare: number; submit: number };
let submitResult: SubmitResult;

const status = (id: string) => workspace.db.prepare('SELECT status FROM publish_jobs WHERE id=?').get(id)?.status as string;

beforeEach(async () => {
  workspace = createTestWorkspace();
  scenario = await seedOfflineScenario(workspace);
  pages = createPageRepository(workspace.db, { secrets: createSecretStore(workspace.db, { dataDir: workspace.dataDir }), clock: () => scenario.state.now });
  const connection = await pages.connect({ pageId: PAGE_ID, name: 'Góc Nghiện Đồ Hay', token: 'EAAPAGETOKEN-2222222222222222222222222-bi-mat', tasks: ['CREATE_CONTENT'] });
  connectionId = connection.id;
  calls = { prepare: 0, submit: 0 };
  submitResult = { status: 'published', remoteId: `${PAGE_ID}_555000111`, evidence: { source: 'graph_api', observedAt: new Date().toISOString(), remoteUrl: `https://www.facebook.com/${PAGE_ID}/posts/555000111` } };
});
afterEach(() => { workspace.dispose(); });

/** Job fanpage ở chế độ live: bản duyệt riêng cho đích Page, danh tính là kết nối Page (không có tài khoản trình duyệt). */
function enqueuePageJob(key: string): string {
  const destinationId = connectionDestination();
  const versionId = scenario.content.createVersion({ productRevisionId: scenario.revisionId, destinationId, caption: 'Bài thử fanpage', mediaIds: scenario.mediaIds, source: 'manual' });
  const approvalId = scenario.content.approve({ contentVersionId: versionId, mode: 'live', pageConnectionId: connectionId });
  const queued = scenario.jobs.enqueue({ requestKey: key, mode: 'live', jobs: [{ approvalId, scheduledAt: scenario.state.now }] });
  return queued.jobs[0]?.id as string;
}
const connectionDestination = () => workspace.db.prepare('SELECT destination_id FROM page_connections WHERE id=?').get(connectionId)?.destination_id as string;

function runner() {
  const page: Publisher = { capabilities: { channel: 'page', level: 'automatic', simulated: false },
    prepare: async () => { calls.prepare += 1; return { ok: true }; },
    submit: async () => { calls.submit += 1; return submitResult; },
    verify: async () => ({ status: 'unknown' }), stop: async () => ({ requested: true, futureSubmissionsBlocked: true, inFlight: 'none', remoteRecall: false }) };
  const publishers = Object.fromEntries(CHANNELS.map((channel) => [channel, channel === 'page' ? page : createFakePublisher(channel)])) as Record<Channel, Publisher>;
  return createJobRunner({ db: workspace.db, workerId: 'worker-test', mode: 'live', publishers, media: workspace.media, clock: () => scenario.state.now });
}

test('job fanpage (live): đăng đúng một lần qua publisher Page, nguồn bằng chứng là api_response, có ID và liên kết bài; không cần tài khoản trình duyệt', async () => {
  const id = enqueuePageJob('page-1');
  assert.equal(await runner().processNext(), 'processed');
  assert.equal(status(id), 'published');
  assert.deepEqual([calls.prepare, calls.submit], [1, 1]);
  const observation = workspace.db.prepare('SELECT source,outcome,remote_id,remote_url FROM publish_observations').get();
  assert.deepEqual([observation?.source, observation?.outcome, observation?.remote_id, observation?.remote_url], ['api_response', 'published', `${PAGE_ID}_555000111`, `https://www.facebook.com/${PAGE_ID}/posts/555000111`]);
  assert.equal(await runner().processNext(), 'idle');
  assert.equal(calls.submit, 1); // không gửi lại
});

test('kết quả không rõ (mạng đứt sau khi gửi): job là unknown, publisher chỉ được gọi một lần và không bao giờ tự thử lại', async () => {
  submitResult = { status: 'unknown', reasonCode: 'network_error', reason: 'Chưa nhận được xác nhận từ Meta.' };
  const id = enqueuePageJob('page-2');
  assert.equal(await runner().processNext(), 'processed');
  assert.equal(status(id), 'unknown');
  assert.equal(workspace.db.prepare('SELECT source FROM publish_observations').get()?.source, 'api_response');
  assert.equal(await runner().processNext(), 'idle');
  assert.equal(await runner().processNext(), 'idle');
  assert.deepEqual([calls.prepare, calls.submit], [1, 1]);
});

test('Page bị đánh dấu hết hạn (Meta từ chối token): job tiếp theo bị chặn, publisher không được gọi', async () => {
  const id = enqueuePageJob('page-3');
  pages.markChecked(connectionId, 'expired'); // việc mà worker làm khi Meta báo token hết hạn
  await runner().processNext();
  assert.equal(status(id), 'blocked');
  assert.deepEqual([calls.prepare, calls.submit], [0, 0]);
});
