import assert from 'node:assert/strict';
import { unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import sharp from 'sharp';
import type { createMediaStore, Database } from '#storage';
import { createTestWorkspace } from '#test-support';
import { buildApp } from './app.ts';

let dir: string; let db: Database; let media: ReturnType<typeof createMediaStore>;
let app: ReturnType<typeof buildApp>; let headers: Record<string, string>; let image: Buffer;
let workspace: ReturnType<typeof createTestWorkspace>;
beforeEach(async () => {
  workspace = createTestWorkspace(); dir = workspace.dataDir; db = workspace.db; media = workspace.media;
  app = buildApp({ db, env: 'test', integrations: 'fake', logger: false, mediaStore: media, uploadLimitBytes: 1024 });
  const session = await app.inject({ method: 'GET', url: '/api/session', headers: { host: '127.0.0.1:4317' } });
  headers = { host: '127.0.0.1:4317', origin: 'http://127.0.0.1:4317', 'x-apm-token': session.json().token, 'content-type': 'application/json' };
  image = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#336699' } }).png().toBuffer();
});
afterEach(async () => { await app.close(); workspace.dispose(); });

test('upload bytes → đọc đúng ảnh → tạo/liệt kê product phân trang, không lộ đường dẫn; ảnh mất trả lỗi rõ', async () => {
  const upload = await app.inject({ method: 'POST', url: '/api/media', headers: { ...headers, 'content-type': 'image/png' }, payload: image });
  assert.equal(upload.statusCode, 201); const saved = upload.json();
  assert.equal(saved.mimeType, 'image/png'); assert.ok(!upload.body.includes(dir)); assert.equal(saved.storage_key, undefined);
  const photo = await app.inject({ method: 'GET', url: `/api/media/${saved.id}`, headers });
  assert.equal(photo.statusCode, 200); assert.equal(photo.headers['x-content-type-options'], 'nosniff'); assert.deepEqual(photo.rawPayload, image);
  const product = await app.inject({ method: 'POST', url: '/api/products', headers,
    payload: { name: 'iPhone 13', condition: 'Xước viền', mediaIds: [saved.id] } });
  assert.equal(product.statusCode, 201);
  const list = await app.inject({ method: 'GET', url: '/api/products?page=1&pageSize=1', headers });
  assert.equal(list.statusCode, 200); assert.equal(list.json().total, 1); assert.equal(list.json().items[0].name, 'iPhone 13');
  assert.equal(list.json().items[0].priceVnd, null);
  assert.equal((await app.inject({ method: 'GET', url: '/api/products?page=2&pageSize=1', headers })).json().items.length, 0);
  await unlink((await media.verify(saved.id)).path);
  const missing = await app.inject({ method: 'GET', url: `/api/media/${saved.id}`, headers });
  assert.equal(missing.statusCode, 409); assert.equal(missing.json().error, 'media_missing');
});

test('validation/pagination/body limit: sai dữ liệu không ghi DB và không echo payload', async () => {
  for (const url of ['/api/products?page=0', '/api/products?pageSize=101', '/api/products?path=outside', '/api/media/not-a-uuid']) {
    assert.equal((await app.inject({ method: 'GET', url, headers })).statusCode, 400);
  }
  const bad = await app.inject({ method: 'POST', url: '/api/products', headers,
    payload: { name: 'private-sentinel', condition: 'cũ', mediaIds: [], path: 'outside' } });
  assert.equal(bad.statusCode, 400); assert.ok(!bad.body.includes('private-sentinel'));
  const large = await app.inject({ method: 'POST', url: '/api/media', headers: { ...headers, 'content-type': 'image/png' }, payload: Buffer.alloc(1025) });
  assert.equal(large.statusCode, 413);
  assert.equal(db.prepare('SELECT count(*) AS n FROM media').get()?.n, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM products').get()?.n, 0);
});

test('upload giữ CSRF/token; JSON path hoặc URL traversal không đọc/xóa file ngoài kho', async () => {
  const outside = join(dir, 'outside.txt'); await writeFile(outside, 'private-sentinel');
  const denied = await app.inject({ method: 'POST', url: '/api/media', headers: { host: headers.host, origin: headers.origin, 'content-type': 'image/png' }, payload: image });
  assert.equal(denied.statusCode, 403);
  const path = await app.inject({ method: 'POST', url: '/api/media', headers, payload: { path: outside } });
  assert.equal(path.statusCode, 400); assert.ok(!path.body.includes(outside));
  const traversal = await app.inject({ method: 'GET', url: '/api/media/%2e%2e%2foutside.txt', headers });
  assert.ok([400, 404].includes(traversal.statusCode)); assert.ok(!traversal.body.includes('private-sentinel'));
  assert.equal(db.prepare('SELECT count(*) AS n FROM media').get()?.n, 0);
});

test('P05: sửa máy tạo revision mới giữ thứ tự ảnh, xung đột phiên bản, đổi trạng thái, thumbnail', async () => {
  const upload = async (color: string) => (await app.inject({ method: 'POST', url: '/api/media', headers: { ...headers, 'content-type': 'image/png' },
    payload: await sharp({ create: { width: 640, height: 8, channels: 3, background: color } }).png().toBuffer() })).json().id as string;
  const [a, b] = [await upload('#336699'), await upload('#993333')];
  const created = (await app.inject({ method: 'POST', url: '/api/products', headers, payload: { name: 'iPhone 13', condition: 'Xước viền', mediaIds: [a, b] } })).json();

  const thumb = await app.inject({ method: 'GET', url: `/api/media/${a}?size=thumb`, headers });
  assert.equal(thumb.statusCode, 200, thumb.body); assert.equal(thumb.headers['content-type'], 'image/jpeg');
  assert.equal((await sharp(thumb.rawPayload).metadata()).width, 320);
  assert.equal((await app.inject({ method: 'GET', url: `/api/media/${a}?size=huge`, headers })).statusCode, 400);

  const detail = (await app.inject({ method: 'GET', url: `/api/products/${created.productId}`, headers })).json();
  assert.deepEqual(detail.mediaIds, [a, b]); assert.equal(detail.priceVnd, null); assert.equal(detail.status, 'selling');
  assert.equal((await app.inject({ method: 'GET', url: '/api/products?pageSize=1', headers })).json().items[0].firstMediaId, a);

  const revise = (expectedRevisionId: string, mediaIds: string[], extra: object = {}) => app.inject({ method: 'PUT',
    url: `/api/products/${created.productId}`, headers, payload: { expectedRevisionId, name: 'iPhone 13 128GB', condition: 'Đẹp', mediaIds, ...extra } });
  const revised = await revise(detail.revisionId, [b, a], { priceVnd: 9_000_000 });
  assert.equal(revised.statusCode, 200); assert.deepEqual(revised.json().mediaIds, [b, a]);
  assert.equal(revised.json().revisionNo, 2); assert.equal(revised.json().priceVnd, 9_000_000);
  assert.equal((await revise(detail.revisionId, [a])).statusCode, 409); // revision cũ
  assert.equal(db.prepare('SELECT count(*) AS n FROM product_revisions').get()?.n, 2);

  const sold = await app.inject({ method: 'POST', url: `/api/products/${created.productId}/status`, headers, payload: { status: 'sold' } });
  assert.equal(sold.statusCode, 200); assert.equal(sold.json().status, 'sold');
  assert.equal((await app.inject({ method: 'POST', url: `/api/products/${created.productId}/status`, headers, payload: { status: 'x' } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'GET', url: '/api/products/00000000-0000-4000-8000-000000000000', headers })).statusCode, 404);
});

test('P05.5: lưu bản caption theo đúng phiên bản máy, giữ thứ tự ảnh; phiên bản cũ/đã bán bị từ chối', async () => {
  const up = async (color: string) => (await app.inject({ method: 'POST', url: '/api/media', headers: { ...headers, 'content-type': 'image/png' },
    payload: await sharp({ create: { width: 4, height: 4, channels: 3, background: color } }).png().toBuffer() })).json().id as string;
  const [a, b] = [await up('#336699'), await up('#993333')];
  const made = (await app.inject({ method: 'POST', url: '/api/products', headers, payload: { name: 'iPhone 13', condition: 'Đẹp', mediaIds: [b, a] } })).json();
  const url = `/api/products/${made.productId}/content-versions`;
  const save = (revisionId: string, caption = 'iPhone 13\nTình trạng: Đẹp', source = 'template') => app.inject({ method: 'POST', url, headers, payload: { revisionId, caption, source } });

  assert.equal((await save(made.revisionId)).statusCode, 201);
  assert.equal((await save(made.revisionId, 'Bản chỉnh tay', 'manual')).statusCode, 201);
  const listed = (await app.inject({ method: 'GET', url, headers })).json().items;
  assert.equal(listed.length, 2); assert.deepEqual(listed[0].mediaIds, [b, a]); assert.equal(listed[0].destinationId, null);
  assert.deepEqual(listed.map((v: { source: string }) => v.source).sort(), ['manual', 'template']);

  assert.equal((await save(made.revisionId, '   ')).statusCode, 400);
  assert.equal((await save(made.revisionId, 'x', 'llm')).statusCode, 400);
  await app.inject({ method: 'PUT', url: `/api/products/${made.productId}`, headers,
    payload: { expectedRevisionId: made.revisionId, name: 'iPhone 13', condition: 'Đẹp hơn', mediaIds: [a] } });
  assert.equal((await save(made.revisionId)).statusCode, 409); // revision cũ không còn là bản hiện tại
  const after = (await app.inject({ method: 'GET', url, headers })).json().items;
  assert.equal(after.length, 2); assert.equal(after[0].revisionNo, 1); // bản cũ vẫn xem được

  await app.inject({ method: 'POST', url: `/api/products/${made.productId}/status`, headers, payload: { status: 'sold' } });
  const current = (await app.inject({ method: 'GET', url: `/api/products/${made.productId}`, headers })).json();
  assert.equal((await save(current.revisionId)).statusCode, 409); // máy đã bán không tạo bản mới
  assert.equal((await app.inject({ method: 'GET', url: '/api/products/00000000-0000-4000-8000-000000000000/content-versions', headers })).statusCode, 404);
});

test('P05.8: POST /api/media/cleanup cần token, không dọn ảnh còn mới, không nhận tham số xóa', async () => {
  const saved = (await app.inject({ method: 'POST', url: '/api/media', headers: { ...headers, 'content-type': 'image/png' }, payload: image })).json();
  const { 'x-apm-token': _token, ...noToken } = headers;
  assert.equal((await app.inject({ method: 'POST', url: '/api/media/cleanup', headers: noToken, payload: '{}' })).statusCode, 403);
  const done = await app.inject({ method: 'POST', url: '/api/media/cleanup', headers, payload: '{}' });
  assert.equal(done.statusCode, 200); assert.deepEqual(done.json(), { purged: 0 }); // vừa tải lên, chưa đủ 24 giờ
  assert.equal((await app.inject({ method: 'GET', url: `/api/media/${saved.id}`, headers })).statusCode, 200);
});

test('P03: API tài khoản — thêm, giới hạn hai, đổi nhãn, tạm dừng, gỡ; thiếu token bị chặn', async () => {
  const call = (method: string, url: string, payload?: object) => app.inject({ method: method as 'GET', url, headers, ...(payload ? { payload } : {}) });
  const a = (await call('POST', '/api/accounts', { label: 'Bán hàng 1' })).json();
  const b = (await call('POST', '/api/accounts', { label: 'Bán hàng 2' })).json();
  assert.deepEqual([a.slot, b.slot], [1, 2]);
  assert.equal((await call('POST', '/api/accounts', { label: 'Thứ ba' })).statusCode, 409);
  assert.equal((await call('POST', '/api/accounts', { label: 'bán hàng 1' })).statusCode, 409);
  assert.equal((await call('POST', '/api/accounts', { label: 'x', extra: 1 })).statusCode, 400);
  assert.equal((await call('PUT', `/api/accounts/${a.id}`, { label: 'Đổi tên' })).json().label, 'Đổi tên');
  assert.equal((await call('POST', `/api/accounts/${a.id}/pause`, { paused: true })).json().paused, true);
  const all = (await call('POST', '/api/accounts/pause-all', { paused: false })).json();
  assert.deepEqual(all.items.map((x: { paused: boolean }) => x.paused), [false, false]); assert.equal(all.limit, 2);
  assert.equal((await call('POST', `/api/accounts/${a.id}/remove`, {})).statusCode, 204);
  assert.equal((await call('POST', `/api/accounts/${a.id}/remove`, {})).statusCode, 404);
  const listed = (await call('GET', '/api/accounts')).json();
  assert.deepEqual(listed.items.map((x: { id: string }) => x.id), [b.id]);
  assert.ok(!JSON.stringify(listed).includes('directory') && !JSON.stringify(listed).includes('secret'));
  const { 'x-apm-token': _token, ...noToken } = headers;
  assert.equal((await app.inject({ method: 'POST', url: '/api/accounts', headers: noToken, payload: { label: 'Lén' } })).statusCode, 403);
});

test('P06: API nhóm — nhập link/ID, dùng chung một nhóm cho hai tài khoản, lọc theo tài khoản, đổi quan hệ, lưu trữ', async () => {
  const call = (method: string, url: string, payload?: object) => app.inject({ method: method as 'GET', url, headers, ...(payload ? { payload } : {}) });
  const a = (await call('POST', '/api/accounts', { label: 'Bán hàng 1' })).json().id as string;
  const b = (await call('POST', '/api/accounts', { label: 'Bán hàng 2' })).json().id as string;
  const added = await call('POST', '/api/groups', { reference: 'https://www.facebook.com/groups/123456789012/?ref=x', accountId: a, name: 'Chợ iPhone', membership: 'joined', permission: 'allowed' });
  assert.equal(added.statusCode, 201); const id = added.json().id as string;
  assert.equal((await call('POST', '/api/groups', { reference: '123456789012', accountId: b })).json().id, id);
  assert.equal((await call('POST', '/api/groups', { reference: 'https://example.com/groups/123456789012', accountId: a })).statusCode, 400);
  assert.equal((await call('POST', '/api/groups', { reference: '123456789012', accountId: a, channel: 'page' })).statusCode, 400);

  const forB = (await call('GET', `/api/groups?accountId=${b}`)).json();
  assert.equal(forB.total, 1); assert.deepEqual(forB.items[0].accounts.map((r: { accountId: string }) => r.accountId), [b]);
  assert.equal(forB.items[0].accounts[0].eligible, false);
  assert.equal((await call('PUT', `/api/groups/${id}/accounts/${b}`, { membership: 'joined', permission: 'allowed' })).statusCode, 204);
  assert.equal((await call('PUT', `/api/groups/${id}/accounts/${b}`, {})).statusCode, 400);
  assert.equal((await call('PUT', `/api/groups/${id}`, { rulesNote: 'Cấm quảng cáo', curation: 'preferred' })).statusCode, 204);
  assert.equal((await call('PUT', `/api/groups/${id}`, { external_id: 'x' })).statusCode, 400); // không sửa được danh tính
  const found = (await call('GET', '/api/groups?q=cho%20iphone&membership=joined&pageSize=5')).json();
  assert.equal(found.items[0].rulesNote, 'Cấm quảng cáo'); assert.ok(found.items[0].accounts.every((r: { eligible: boolean }) => r.eligible));

  assert.equal((await call('POST', `/api/groups/${id}/archive`, { archived: true })).statusCode, 204);
  assert.equal((await call('GET', '/api/groups')).json().total, 0);
  assert.equal((await call('GET', '/api/groups?includeArchived=true')).json().total, 1);
  assert.equal((await call('GET', '/api/groups?pageSize=500')).statusCode, 400);
  const { 'x-apm-token': _token, ...noToken } = headers;
  assert.equal((await app.inject({ method: 'POST', url: '/api/groups', headers: noToken, payload: { reference: '123456789012', accountId: a } })).statusCode, 403);
});

test('P03.3: API lệnh trình duyệt — từ chối khi worker chưa chạy/tắt trình duyệt, ghi lệnh khi bật, một lệnh mỗi tài khoản, hủy', async () => {
  const call = (method: string, url: string, payload?: object) => app.inject({ method: method as 'GET', url, headers, ...(payload ? { payload } : {}) });
  const account = (await call('POST', '/api/accounts', { label: 'Nick A' })).json().id as string;
  assert.equal((await call('GET', '/api/health')).json().worker.alive, false);
  assert.equal((await call('POST', `/api/accounts/${account}/browser`, { kind: 'login' })).statusCode, 503); // chưa có worker

  const { writeWorkerHeartbeat } = await import('#storage');
  writeWorkerHeartbeat(db, 'off');
  assert.equal((await call('POST', `/api/accounts/${account}/browser`, { kind: 'login' })).statusCode, 503); // có worker nhưng tắt trình duyệt
  writeWorkerHeartbeat(db, 'real');
  assert.deepEqual((await call('GET', '/api/health')).json().worker, { alive: true, browser: 'real' });

  assert.equal((await call('POST', `/api/accounts/${account}/browser`, { kind: 'delete' })).statusCode, 400);
  const queued = await call('POST', `/api/accounts/${account}/browser`, { kind: 'login' });
  assert.equal(queued.statusCode, 202);
  assert.equal((await call('POST', `/api/accounts/${account}/browser`, { kind: 'verify' })).statusCode, 409); // đã có lệnh đang chờ
  assert.equal((await call('GET', '/api/accounts')).json().items[0].browser.status, 'queued');
  assert.deepEqual((await call('POST', `/api/browser-commands/${queued.json().id}/cancel`, {})).json(), { state: 'cancelled' });
  assert.equal((await call('GET', '/api/accounts')).json().items[0].browser.resultCode, 'cancelled_before_start');
  assert.equal((await call('POST', `/api/accounts/00000000-0000-4000-8000-000000000000/browser`, { kind: 'login' })).statusCode, 404);
  const { 'x-apm-token': _token, ...noToken } = headers;
  assert.equal((await app.inject({ method: 'POST', url: `/api/accounts/${account}/browser`, headers: noToken, payload: { kind: 'login' } })).statusCode, 403);
});

test('P07: API duyệt và hàng chờ — duyệt cần danh tính, xếp job chống bấm hai lần, tạm dừng/tiếp tục/hủy/đổi lịch, danh sách từ dữ liệu bền', async () => {
  const { createAccountRepository, createGroupRepository } = await import('#storage');
  const call = (method: string, url: string, payload?: object) => app.inject({ method: method as 'GET', url, headers, ...(payload ? { payload } : {}) });
  const accounts = createAccountRepository(db);
  const account = accounts.create({ label: 'Nick A' }).id;
  const group = createGroupRepository(db).add({ reference: '123456789012', accountId: account, name: 'Nhóm thử', membership: 'joined', permission: 'allowed' }).id;
  const workspace_count = (table: string) => Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n);
  const image_ = image;
  const media = (await app.inject({ method: 'POST', url: '/api/media', headers: { ...headers, 'content-type': 'image/png' }, payload: image_ })).json().id as string;
  const made = (await call('POST', '/api/products', { name: 'iPhone 13', condition: 'Đẹp', mediaIds: [media] })).json();
  const version = (await call('POST', `/api/products/${made.productId}/content-versions`, { revisionId: made.revisionId, caption: 'iPhone 13\nTình trạng: Đẹp', source: 'template', destinationId: group })).json().id as string;

  assert.equal((await call('POST', '/api/approvals', { contentVersionId: version, accountId: account })).statusCode, 409); // chưa đăng nhập, chưa có danh tính
  accounts.recordIdentity(account, 'vanity:nick.a'); accounts.recordSession(account, 'logged_in');
  const approval = (await call('POST', '/api/approvals', { contentVersionId: version, accountId: account }));
  assert.equal(approval.statusCode, 201);
  const approvalId = approval.json().approvalId as string;

  const now = Date.now();
  const body = { requestKey: 'khoa-yeu-cau-1', jobs: [{ approvalId, scheduledAt: now + 3_600_000 }] };
  const first = await call('POST', '/api/jobs', body);
  assert.equal(first.statusCode, 201); const jobId = first.json().jobIds[0] as string;
  const replay = await call('POST', '/api/jobs', body); // bấm gửi lần hai cùng mã yêu cầu
  assert.deepEqual([replay.statusCode, replay.json().replayed, replay.json().jobIds[0]], [200, true, jobId]);
  assert.equal((await call('POST', '/api/jobs', { ...body, jobs: [{ approvalId, scheduledAt: now + 7_200_000 }] })).statusCode, 409); // cùng mã, khác nội dung
  assert.equal((await call('POST', '/api/jobs', { requestKey: 'short', jobs: [] })).statusCode, 400);
  assert.equal(workspace_count('publish_jobs'), 1);

  const listed = (await call('GET', '/api/jobs?pageSize=5')).json();
  assert.deepEqual([listed.total, listed.items[0].status, listed.items[0].channel, listed.items[0].account.label, listed.items[0].productName, listed.items[0].destination.name],
    [1, 'queued', 'group', 'Nick A', 'iPhone 13', 'Nhóm thử']);
  assert.deepEqual([listed.items[0].overdue, listed.items[0].sendStarted, listed.items[0].scheduledAt], [false, false, now + 3_600_000]);
  assert.equal((await call('GET', `/api/jobs?status=published`)).json().total, 0);
  assert.equal((await call('GET', '/api/jobs?status=sai')).statusCode, 400);

  assert.equal((await call('POST', `/api/jobs/${jobId}/pause`, {})).json().status, 'paused');
  assert.equal((await call('POST', `/api/jobs/${jobId}/pause`, {})).statusCode, 409); // đã tạm dừng
  assert.equal((await call('POST', `/api/jobs/${jobId}/reschedule`, { scheduledAt: now })).json().scheduledAt, now); // chạy ngay khi tiếp tục
  assert.equal((await call('POST', `/api/jobs/${jobId}/resume`, {})).json().status, 'queued');
  assert.equal((await call('POST', `/api/jobs/${jobId}/stop`, {})).statusCode, 409); // chưa chạy nên không có gì để dừng
  assert.equal((await call('POST', `/api/jobs/${jobId}/cancel`, {})).json().status, 'cancelled');
  assert.equal((await call('POST', `/api/jobs/${jobId}/cancel`, {})).statusCode, 409);
  assert.equal((await call('POST', `/api/jobs/00000000-0000-4000-8000-000000000000/pause`, {})).statusCode, 404);
  const { 'x-apm-token': _token, ...noToken } = headers;
  assert.equal((await app.inject({ method: 'POST', url: '/api/jobs', headers: noToken, payload: body })).statusCode, 403);
});

test('P10: POST /api/posts — một lần gửi tạo bản caption riêng, duyệt và xếp job cho nhiều nhóm; chống bấm hai lần; đích bị chặn thì không xếp gì', async () => {
  const { createAccountRepository, createGroupRepository } = await import('#storage');
  const call = (method: string, url: string, payload?: object) => app.inject({ method: method as 'GET', url, headers, ...(payload ? { payload } : {}) });
  const accounts = createAccountRepository(db);
  const account = accounts.create({ label: 'Nick A' }).id;
  accounts.recordIdentity(account, 'vanity:nick.a'); accounts.recordSession(account, 'logged_in');
  const groups = createGroupRepository(db);
  const [g1, g2] = ['111111111111', '222222222222'].map((id, i) => groups.add({ reference: id, accountId: account, name: `Nhóm ${i + 1}`, membership: 'joined', permission: 'allowed' }).id);
  const blocked = groups.add({ reference: '333333333333', accountId: account, name: 'Chưa có quyền', membership: 'joined' }).id;
  const media = (await app.inject({ method: 'POST', url: '/api/media', headers: { ...headers, 'content-type': 'image/png' }, payload: image })).json().id as string;
  const product = (await call('POST', '/api/products', { name: 'iPhone 13', condition: 'Đẹp', mediaIds: [media] })).json();
  const when = Date.now(); // cố định: cùng mã yêu cầu phải cùng nội dung (kể cả giờ hẹn)
  const body = (items: object[], requestKey = 'khoa-dang-bai-0001') => ({ requestKey, accountId: account, productId: product.productId, scheduledAt: when, items });

  const blockedResult = await call('POST', '/api/posts', body([{ destinationId: g1, caption: 'A' }, { destinationId: blocked, caption: 'B' }]));
  assert.equal(blockedResult.statusCode, 409);
  assert.deepEqual(blockedResult.json().failures, [{ destinationId: blocked, code: 'not_ready' }]);
  assert.equal((await call('GET', '/api/jobs')).json().total, 0); // không xếp job nào

  const items = [{ destinationId: g1, caption: 'Caption nhóm 1' }, { destinationId: g2, caption: 'Caption nhóm 2', source: 'manual' }];
  const ok = await call('POST', '/api/posts', body(items));
  assert.equal(ok.statusCode, 201); assert.equal(ok.json().jobs.length, 2);
  const replay = await call('POST', '/api/posts', body(items));
  assert.deepEqual([replay.statusCode, replay.json().replayed, replay.json().jobs.length], [200, true, 2]);
  assert.equal((await call('POST', '/api/posts', body([{ destinationId: g1, caption: 'Khác' }]))).statusCode, 409); // cùng mã, khác nội dung
  assert.equal((await call('GET', '/api/jobs')).json().total, 2);
  assert.equal((await call('POST', '/api/posts', { ...body(items, 'x'), requestKey: 'x' })).statusCode, 400);
  const { 'x-apm-token': _token, ...noToken } = headers;
  assert.equal((await app.inject({ method: 'POST', url: '/api/posts', headers: noToken, payload: body(items, 'khoa-khong-token-1') })).statusCode, 403);
});

test('P10.3: đăng trang cá nhân — đích là TCN của chính tài khoản, mỗi tài khoản một job riêng, không lẫn với nhóm', async () => {
  const { createAccountRepository, createGroupRepository } = await import('#storage');
  const call = (method: string, url: string, payload?: object) => app.inject({ method: method as 'GET', url, headers, ...(payload ? { payload } : {}) });
  const accounts = createAccountRepository(db);
  const [a, b] = ['Nick A', 'Nick B'].map((label) => accounts.create({ label }).id) as [string, string];
  assert.equal((await call('POST', `/api/accounts/${a}/profile-destination`, {})).statusCode, 409); // chưa có danh tính xác nhận
  accounts.recordIdentity(a, 'vanity:nick.a'); accounts.recordSession(a, 'logged_in');
  accounts.recordIdentity(b, 'vanity:nick.b'); accounts.recordSession(b, 'logged_in');
  createGroupRepository(db).add({ reference: '111111111111', accountId: a, name: 'Nhóm', membership: 'joined', permission: 'allowed' });
  const destA = (await call('POST', `/api/accounts/${a}/profile-destination`, {})).json().id as string;
  const destB = (await call('POST', `/api/accounts/${b}/profile-destination`, {})).json().id as string;
  assert.notEqual(destA, destB);
  assert.equal((await call('POST', `/api/accounts/${a}/profile-destination`, {})).json().id, destA); // chạy lại không tạo trùng
  assert.equal((await call('GET', '/api/groups')).json().total, 1); // danh sách nhóm không chứa trang cá nhân

  const media = (await app.inject({ method: 'POST', url: '/api/media', headers: { ...headers, 'content-type': 'image/png' }, payload: image })).json().id as string;
  const product = (await call('POST', '/api/products', { name: 'iPhone 13', condition: 'Đẹp', mediaIds: [media] })).json();
  const post = (accountId: string, destinationId: string, key: string) => call('POST', '/api/posts', { requestKey: key, accountId, productId: product.productId,
    scheduledAt: Date.now(), items: [{ destinationId, caption: 'Bán iPhone 13' }] });
  assert.equal((await post(a, destA, 'khoa-tcn-nick-a-1')).statusCode, 201);
  assert.equal((await post(b, destB, 'khoa-tcn-nick-b-1')).statusCode, 201);
  assert.equal((await post(a, destB, 'khoa-tcn-lech-doi-1')).statusCode, 409); // TCN của người khác không phải đích của tài khoản này
  const listed = (await call('GET', '/api/jobs')).json();
  assert.deepEqual(listed.items.map((job: { channel: string }) => job.channel), ['profile', 'profile']);
  assert.deepEqual(listed.items.map((job: { account: { label: string } }) => job.account.label).sort(), ['Nick A', 'Nick B']);
});

test('P11: API chi tiết/lọc job và đối chiếu unknown — nguồn luôn là manual, không có đường gửi lại', async () => {
  const { createAccountRepository, createGroupRepository, createJobRepository } = await import('#storage');
  const call = (method: string, url: string, payload?: object) => app.inject({ method: method as 'GET', url, headers, ...(payload ? { payload } : {}) });
  const accounts = createAccountRepository(db);
  const account = accounts.create({ label: 'Nick A' }).id;
  accounts.recordIdentity(account, 'vanity:nick.a'); accounts.recordSession(account, 'logged_in');
  const group = createGroupRepository(db).add({ reference: '111111111111', accountId: account, name: 'Nhóm một', membership: 'joined', permission: 'allowed' }).id;
  const media = (await app.inject({ method: 'POST', url: '/api/media', headers: { ...headers, 'content-type': 'image/png' }, payload: image })).json().id as string;
  const product = (await call('POST', '/api/products', { name: 'iPhone 13', condition: 'Đẹp', mediaIds: [media] })).json();
  const posted = (await call('POST', '/api/posts', { requestKey: 'khoa-doi-chieu-001', accountId: account, productId: product.productId, scheduledAt: Date.now(),
    items: [{ destinationId: group, caption: 'Bán iPhone 13' }] })).json();
  const jobId = posted.jobs[0].jobId as string;

  const jobs = createJobRepository(db);
  const claim = jobs.claimNext('worker-test', 'fake');
  jobs.markSendStarted(claim as NonNullable<typeof claim>);
  jobs.finish(claim as NonNullable<typeof claim>, { outcome: 'unknown', source: 'fake', reasonCode: 'unknown' });

  const detail = (await call('GET', `/api/jobs/${jobId}`)).json();
  assert.deepEqual([detail.status, detail.caption, detail.mediaIds, detail.sendStarted, detail.attemptsDetail.length], ['unknown', 'Bán iPhone 13', [media], true, 1]);
  assert.equal((await call('GET', `/api/jobs?status=unknown&destinationId=${group}&productId=${product.productId}`)).json().total, 1);
  assert.equal((await call('GET', `/api/jobs?destinationId=${product.productId}`)).json().total, 0);
  assert.equal((await call('GET', '/api/jobs?from=-5')).statusCode, 400);

  assert.equal((await call('POST', `/api/jobs/${jobId}/reconcile`, { resolution: 'published', remoteUrl: 'https://x.test/p?token=abc' })).statusCode, 400); // URL chứa bí mật
  assert.equal((await call('POST', `/api/jobs/${jobId}/reconcile`, { resolution: 'queued' })).statusCode, 400); // không có đường đưa về hàng chờ
  assert.equal((await call('POST', `/api/jobs/${jobId}/reconcile`, { resolution: 'published', remoteUrl: 'https://www.facebook.com/groups/1/posts/2' })).json().status, 'published');
  const after = (await call('GET', `/api/jobs/${jobId}`)).json();
  assert.deepEqual(after.attemptsDetail[0].observations.map((o: { source: string }) => o.source), ['fake', 'manual']);
  assert.equal((await call('POST', `/api/jobs/${jobId}/reconcile`, { resolution: 'not_published' })).statusCode, 409); // đã chốt
  assert.equal((await call('GET', '/api/jobs/00000000-0000-4000-8000-000000000000')).statusCode, 404);
});

test('P10.5/P10.9: API cấu hình đăng thường dùng (lưu/sửa/ngừng, không tạo job) và xem trước tác động của việc sửa/bán máy', async () => {
  const { createAccountRepository, createGroupRepository } = await import('#storage');
  const call = (method: string, url: string, payload?: object) => app.inject({ method: method as 'GET', url, headers, ...(payload ? { payload } : {}) });
  const accounts = createAccountRepository(db);
  const account = accounts.create({ label: 'Nick A' }).id;
  accounts.recordIdentity(account, 'vanity:nick.a'); accounts.recordSession(account, 'logged_in');
  const group = createGroupRepository(db).add({ reference: '111111111111', accountId: account, name: 'Nhóm 1', membership: 'joined', permission: 'allowed' }).id;
  const media = (await app.inject({ method: 'POST', url: '/api/media', headers: { ...headers, 'content-type': 'image/png' }, payload: image })).json().id as string;
  const product = (await call('POST', '/api/products', { name: 'iPhone 13', condition: 'Đẹp', mediaIds: [media] })).json();
  const body = { label: 'Buổi sáng', captionTemplate: '{ten}\nGiá: {gia}', schedule: { startMode: 'daily', timeOfDay: '08:30' }, targets: [{ accountId: account, destinationId: group }] };

  const created = await call('POST', '/api/presets', body);
  assert.equal(created.statusCode, 201);
  assert.deepEqual(created.json().targets.map((t: { name: string }) => t.name), ['Nhóm 1']);
  assert.equal((await call('GET', '/api/presets')).json().items.length, 1);
  assert.equal((await call('GET', '/api/jobs')).json().total, 0); // lưu cấu hình không tạo job
  assert.equal((await call('POST', '/api/presets', { ...body, captionTemplate: '{ten}\n{mau}' })).statusCode, 400); // chỗ trống lạ
  assert.equal((await call('POST', '/api/presets', { ...body, schedule: { startMode: 'daily', timeOfDay: '8:30' } })).statusCode, 400);
  assert.equal((await call('POST', '/api/presets', { ...body, targets: [] })).statusCode, 400);
  assert.equal((await call('POST', '/api/presets', { ...body, extra: 1 })).statusCode, 400);
  const updated = await call('PUT', `/api/presets/${created.json().id}`, { ...body, label: 'Đổi tên', captionTemplate: null, schedule: { startMode: 'now' } });
  assert.deepEqual([updated.statusCode, updated.json().label, updated.json().schedule], [200, 'Đổi tên', { startMode: 'now' }]);
  assert.equal((await call('POST', `/api/presets/${created.json().id}/archive`, {})).statusCode, 204);
  assert.deepEqual((await call('GET', '/api/presets')).json().items, []);
  assert.equal((await call('POST', `/api/presets/${created.json().id}/archive`, {})).statusCode, 404);
  const { 'x-apm-token': _token, ...noToken } = headers;
  assert.equal((await app.inject({ method: 'POST', url: '/api/presets', headers: noToken, payload: body })).statusCode, 403);

  assert.deepEqual((await call('GET', `/api/products/${product.productId}/impact`)).json(), { productId: product.productId, pendingJobs: 0, runningJobs: 0, settledJobs: 0, byStatus: {} });
  const posted = await call('POST', '/api/posts', { requestKey: 'khoa-impact-0001', accountId: account, productId: product.productId, scheduledAt: Date.now() + 3_600_000, items: [{ destinationId: group, caption: 'Bán iPhone 13' }] });
  assert.equal(posted.statusCode, 201);
  assert.deepEqual((await call('GET', `/api/products/${product.productId}/impact`)).json().byStatus, { queued: 1 });
  assert.equal((await call('GET', `/api/products/${product.productId}/impact`)).json().pendingJobs, 1);
  assert.equal((await call('GET', '/api/products/00000000-0000-4000-8000-000000000000/impact')).statusCode, 404);
  assert.equal((await call('GET', '/api/products/khong-phai-uuid/impact')).statusCode, 400);
});
