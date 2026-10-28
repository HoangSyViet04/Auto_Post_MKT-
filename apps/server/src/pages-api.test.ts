import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { createPageRepository, createSecretStore } from '#storage';
import { createTestWorkspace, seedOfflineScenario } from '#test-support';
import { buildApp } from './app.ts';

const PAGE_ID = '107892312229541';
const TOKEN = 'EAAPAGETOKEN-2222222222222222222222222-bi-mat-rieng';
let workspace: ReturnType<typeof createTestWorkspace>;
let scenario: Awaited<ReturnType<typeof seedOfflineScenario>>;
let app: ReturnType<typeof buildApp>;
let headers: Record<string, string>;
let connectionId: string;
let pages: ReturnType<typeof createPageRepository>;
const WHEN = Date.now() + 3_600_000; // cố định: cùng mã yêu cầu phải cùng nội dung (kể cả giờ hẹn)

beforeEach(async () => {
  workspace = createTestWorkspace();
  scenario = await seedOfflineScenario(workspace);
  pages = createPageRepository(workspace.db, { secrets: createSecretStore(workspace.db, { dataDir: workspace.dataDir }) });
  connectionId = (await pages.connect({ pageId: PAGE_ID, name: 'Góc Nghiện Đồ Hay', token: TOKEN, tasks: ['CREATE_CONTENT'] })).id;
  app = buildApp({ db: workspace.db, env: 'test', integrations: 'live', logger: false, mediaStore: workspace.media });
  const session = await app.inject({ method: 'GET', url: '/api/session', headers: { host: '127.0.0.1:4317' } });
  headers = { host: '127.0.0.1:4317', origin: 'http://127.0.0.1:4317', 'x-apm-token': session.json().token, 'content-type': 'application/json' };
});
afterEach(async () => { await app.close(); workspace.dispose(); });

const call = (method: string, url: string, payload?: object) => app.inject({ method: method as 'GET', url, headers, ...(payload ? { payload } : {}) });
const body = (overrides: Record<string, unknown> = {}) => ({ requestKey: 'khoa-page-api-0001', pageConnectionId: connectionId, productId: scenario.productId, scheduledAt: WHEN, caption: 'Bài thử fanpage', ...overrides });

test('GET /api/pages chỉ trả metadata và trạng thái; không route nào trả token Page', async () => {
  const response = await call('GET', '/api/pages');
  assert.equal(response.statusCode, 200);
  const [item] = response.json().items;
  assert.deepEqual([item.pageId, item.name, item.permissionStatus, item.secretStatus, item.canPost], [PAGE_ID, 'Góc Nghiện Đồ Hay', 'allowed', 'available', true]);
  assert.equal(response.body.includes(TOKEN), false);
  assert.equal(Object.keys(item).some((key) => /token|secret_ref|access/iu.test(key)), false);
});

test('POST /api/page-posts: xếp một job fanpage, chống bấm hai lần, từ chối dữ liệu sai và thiếu token; Page chưa đủ điều kiện thì 409 và không xếp gì', async () => {
  const first = await call('POST', '/api/page-posts', body());
  assert.equal(first.statusCode, 201);
  assert.equal(first.json().jobs.length, 1);
  const replay = await call('POST', '/api/page-posts', body());
  assert.deepEqual([replay.statusCode, replay.json().replayed, replay.json().jobs[0].jobId], [200, true, first.json().jobs[0].jobId]);
  assert.equal((await call('GET', '/api/jobs')).json().total, 1);
  const jobs = (await call('GET', '/api/jobs')).json().items;
  assert.deepEqual([jobs[0].channel, jobs[0].account, jobs[0].mode], ['page', null, 'live']); // không có tài khoản trình duyệt

  assert.equal((await call('POST', '/api/page-posts', body({ extra: 1 }))).statusCode, 400);
  assert.equal((await call('POST', '/api/page-posts', body({ requestKey: 'x' }))).statusCode, 400);
  assert.equal((await call('POST', '/api/page-posts', body({ requestKey: 'khoa-page-api-0002', pageConnectionId: 'khong-phai-uuid' }))).statusCode, 400);
  assert.equal((await call('POST', '/api/page-posts', body({ requestKey: 'khoa-page-api-0003', caption: 'Nội dung khác' }))).statusCode, 201); // mã mới
  const { 'x-apm-token': _token, ...noToken } = headers;
  assert.equal((await app.inject({ method: 'POST', url: '/api/page-posts', headers: noToken, payload: body({ requestKey: 'khoa-page-api-0004' }) })).statusCode, 403);

  pages.markChecked(connectionId, 'expired');
  const blocked = await call('POST', '/api/page-posts', body({ requestKey: 'khoa-page-api-0005' }));
  assert.equal(blocked.statusCode, 409);
  assert.equal(blocked.json().failures.length, 1);
  assert.equal((await call('GET', '/api/jobs')).json().total, 2); // không xếp thêm
});

test('POST /api/pages/:id/disconnect: thu hồi token, hủy job chờ, Page biến mất khỏi danh sách; gỡ lần hai là 404', async () => {
  await call('POST', '/api/page-posts', body());
  const result = await call('POST', `/api/pages/${connectionId}/disconnect`, {});
  assert.deepEqual([result.statusCode, result.json().cancelledJobs], [200, 1]);
  assert.deepEqual((await call('GET', '/api/pages')).json().items, []);
  assert.equal((await call('GET', '/api/jobs')).json().items[0].status, 'cancelled');
  assert.equal((await call('POST', `/api/pages/${connectionId}/disconnect`, {})).statusCode, 404);
  assert.equal((await call('POST', '/api/pages/khong-phai-uuid/disconnect', {})).statusCode, 400);
});
