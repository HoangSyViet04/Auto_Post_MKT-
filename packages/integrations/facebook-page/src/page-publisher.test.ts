import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import type { ApprovedPublishRequest } from '#contracts';
import { createGraphClient } from './graph-client.ts';
import { createPagePublisher, reasonFor, sniffImage } from './page-publisher.ts';

const PAGE_ID = '107892312229541';
const CONNECTION = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'EAAPAGETOKEN-2222222222222222222222222-bi-mat-rieng';
const CAPTION = 'Máy thử P12 (xóa sau)\nTình trạng: bài thử nghiệm, không bán';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('DU-LIEU-ANH-MAU-1')]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('DU-LIEU-ANH-MAU-2')]);

interface Seen { method: string; path: string; query: string; authorization: string | undefined; contentType: string; body: Buffer }
let server: Server;
let base: string;
let seen: Seen[];
let dir: string;
let photoCounter: number;
let problems: Array<[string, string]>;
type Handler = (request: Seen, response: ServerResponse) => boolean | undefined;
let override: Handler | undefined;

const json = (response: ServerResponse, status: number, body: unknown) => { response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body)); };

beforeEach(async () => {
  seen = []; photoCounter = 0; problems = []; override = undefined;
  dir = mkdtempSync(join(tmpdir(), 'apm fanpage '));
  server = createServer((incoming: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
    incoming.on('end', () => {
      const url = new URL(String(incoming.url), 'http://x');
      const entry: Seen = { method: String(incoming.method), path: url.pathname, query: url.search, authorization: incoming.headers.authorization,
        contentType: String(incoming.headers['content-type'] ?? ''), body: Buffer.concat(chunks) };
      seen.push(entry);
      if (override?.(entry, response)) return;
      const m = /^\/v23\.0\/(\d+)(?:\/(\w+))?$/u.exec(entry.path);
      if (!m) return json(response, 404, {});
      const [, id, edge] = m;
      if (entry.method === 'GET' && !edge) return json(response, 200, { id, name: 'Góc Nghiện Đồ Hay' });
      if (entry.method === 'POST' && edge === 'photos') { photoCounter += 1; return json(response, 200, { id: String(900000 + photoCounter) }); }
      if (entry.method === 'POST' && edge === 'feed') return json(response, 200, { id: `${id}_555000111` });
      if (entry.method === 'DELETE' && !edge) return json(response, 200, { success: true });
      if (entry.method === 'GET' && edge === 'posts') return json(response, 200, { data: [{ id: `${PAGE_ID}_777`, message: CAPTION, created_time: '2026-10-28T10:00:00+0000', permalink_url: `https://www.facebook.com/${PAGE_ID}/posts/777` }] });
      return json(response, 404, {});
    });
  });
  await new Promise<void>((done) => server.listen({ host: '127.0.0.1', port: 0 }, done));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterEach(async () => { await new Promise((done) => server.close(done)); rmSync(dir, { recursive: true, force: true }); });

function files(...contents: Buffer[]): string[] {
  return contents.map((content, index) => { const path = join(dir, `${index}-kho-ung-dung.blob`); writeFileSync(path, content); return path; }); // đuôi .blob như ảnh trong kho thật
}
function request(mediaPaths: string[], overrides: Partial<ApprovedPublishRequest> = {}): ApprovedPublishRequest {
  return { jobId: 'job-1', destinationId: 'dest-1', caption: CAPTION, mediaPaths,
    context: { requestId: 'req', approvalId: 'apr', contentVersionId: 'ver', expectedIdentity: { kind: 'page', localId: CONNECTION, remoteId: PAGE_ID }, destination: { channel: 'page', remoteId: PAGE_ID } }, ...overrides };
}
function publisher(extra: { tokenFor?: () => Promise<{ pageId: string; token: string }>; maxPhotos?: number } = {}) {
  return createPagePublisher({ graph: createGraphClient({ baseUrl: base, version: 'v23.0', timeoutMs: 800, uploadTimeoutMs: 800, feedTimeoutMs: 800 }), tokenFor: extra.tokenFor ?? (async () => ({ pageId: PAGE_ID, token: TOKEN })),
    onConnectionProblem: (id, status) => problems.push([id, status]), ...(extra.maxPhotos ? { maxPhotos: extra.maxPhotos } : {}) });
}
const count = (method: string, edge: string) => seen.filter((entry) => entry.method === method && entry.path.endsWith(edge)).length;
const form = (entry: Seen) => new URLSearchParams(entry.body.toString('utf8'));

test('đăng 2 ảnh đúng thứ tự: prepare chỉ tải ảnh CHƯA xuất bản và chưa tạo bài; submit tạo bài đúng một lần với ảnh theo thứ tự; bằng chứng graph_api', async () => {
  const pub = publisher();
  const req = request(files(PNG, JPEG));
  assert.deepEqual(await pub.prepare(req), { ok: true });
  assert.equal(count('POST', '/photos'), 2);
  assert.equal(count('POST', '/feed'), 0); // chuẩn bị xong nhưng chưa có bài nào
  const uploads = seen.filter((entry) => entry.path.endsWith('/photos'));
  assert.match(uploads[0]?.body.toString('latin1') ?? '', /name="published"\r\n\r\nfalse/u);
  assert.match(uploads[0]?.body.toString('latin1') ?? '', /filename="01-0-kho-ung-dung\.blob\.png"/u); // tên suy từ chữ ký file, không tin đuôi .blob
  assert.match(uploads[1]?.body.toString('latin1') ?? '', /filename="02-1-kho-ung-dung\.blob\.jpg"/u);
  assert.equal(uploads[0]?.body.includes(PNG), true); // gửi đúng byte ảnh

  const result = await pub.submit(req);
  assert.equal(result.status, 'published');
  assert.equal(result.status === 'published' && result.remoteId, `${PAGE_ID}_555000111`);
  assert.equal(result.evidence?.source, 'graph_api');
  assert.equal(result.evidence?.remoteUrl, `https://www.facebook.com/${PAGE_ID}/posts/555000111`);
  assert.equal(count('POST', '/feed'), 1);
  const feed = seen.find((entry) => entry.path.endsWith('/feed'));
  assert.ok(feed);
  const fields = form(feed);
  assert.equal(fields.get('message'), CAPTION);
  assert.deepEqual([fields.get('attached_media[0]'), fields.get('attached_media[1]')], [JSON.stringify({ media_fbid: '900001' }), JSON.stringify({ media_fbid: '900002' })]); // đúng thứ tự đã duyệt
  assert.equal((await pub.submit(req)).status, 'failed'); // phiên đã dùng: không gửi lại được
  assert.equal(count('POST', '/feed'), 1);
});

test('token chỉ ở header Authorization: không có trong URL, thân yêu cầu, bằng chứng hay kết quả', async () => {
  const pub = publisher();
  const req = request(files(PNG));
  await pub.prepare(req);
  const result = await pub.submit(req);
  for (const entry of seen) {
    assert.equal(entry.authorization, `Bearer ${TOKEN}`);
    assert.equal(entry.query.includes(TOKEN) || entry.path.includes(TOKEN), false);
    assert.equal(entry.body.includes(Buffer.from(TOKEN)), false);
  }
  assert.equal(JSON.stringify(result).includes(TOKEN), false);
});

test('dừng TRƯỚC khi gửi và không có bài nào được tạo: ảnh không phải ảnh, quá nhiều ảnh, token thuộc Page khác, không lấy được token', async () => {
  const notImage = await publisher().prepare(request(files(PNG, Buffer.from('day-la-van-ban-khong-phai-anh'))));
  assert.deepEqual([notImage.ok, !notImage.ok && notImage.reasonCode], [false, 'media_invalid']);
  assert.equal(count('POST', '/photos'), 0); // ảnh hỏng được phát hiện TRƯỚC khi tải bất cứ ảnh nào lên

  const tooMany = await publisher({ maxPhotos: 2 }).prepare(request(files(PNG, PNG, PNG)));
  assert.deepEqual([tooMany.ok, !tooMany.ok && tooMany.reasonCode], [false, 'media_invalid']);

  const other = await publisher({ tokenFor: async () => ({ pageId: '999999999999', token: TOKEN }) }).prepare(request(files(PNG)));
  assert.deepEqual([other.ok, !other.ok && other.reasonCode], [false, 'identity_mismatch']);

  const lost = await publisher({ tokenFor: async () => { throw new Error('secret_lost'); } }).prepare(request(files(PNG)));
  assert.deepEqual([lost.ok, !lost.ok && lost.reasonCode], [false, 'session_expired']);
  assert.equal(count('POST', '/feed'), 0);
  assert.equal(count('POST', '/photos'), 0);
});

test('Meta từ chối token/quyền khi chuẩn bị: báo đúng mã, đánh dấu kết nối (hết hạn/bị từ chối) để job sau bị chặn; không tải gì', async () => {
  override = (_entry, response) => { json(response, 400, { error: { code: 190, message: `Invalid token ${TOKEN}` } }); return true; };
  const expired = await publisher().prepare(request(files(PNG)));
  assert.deepEqual([expired.ok, !expired.ok && expired.reasonCode], [false, 'session_expired']);
  assert.equal(JSON.stringify(expired).includes(TOKEN), false);
  override = (_entry, response) => { json(response, 403, { error: { code: 200, message: 'Permissions error' } }); return true; };
  const denied = await publisher().prepare(request(files(PNG)));
  assert.deepEqual([denied.ok, !denied.ok && denied.reasonCode], [false, 'destination_not_allowed']);
  assert.deepEqual(problems, [[CONNECTION, 'expired'], [CONNECTION, 'denied']]);
  assert.equal(count('POST', '/photos'), 0);
});

test('tải ảnh lỗi giữa chừng: các ảnh đã tải (chưa xuất bản) bị xóa, báo dừng trước khi gửi, không có bài', async () => {
  override = (entry, response) => {
    if (entry.method === 'POST' && entry.path.endsWith('/photos') && photoCounter === 1) { json(response, 400, { error: { code: 100, message: 'Invalid image' } }); return true; }
    return undefined;
  };
  const result = await publisher().prepare(request(files(PNG, JPEG)));
  assert.deepEqual([result.ok, !result.ok && result.reasonCode], [false, 'media_invalid']);
  assert.match(!result.ok ? result.reason : '', /chưa có bài nào được đăng/u);
  assert.equal(count('DELETE', '900001'), 1); // ảnh đầu đã tải thì được dọn
  assert.equal(count('POST', '/feed'), 0);
});

test('kết quả không rõ khi gửi: mất kết nối, quá giờ hoặc lỗi tạm thời của Meta → unknown, KHÔNG gửi lại (đúng một yêu cầu tạo bài)', async () => {
  const modes: Array<[string, Handler]> = [
    ['ngắt kết nối', (_e, response) => { response.socket?.destroy(); return true; }],
    ['quá giờ', (_e, _response) => true], // không bao giờ trả lời
    ['lỗi tạm thời của Meta', (_e, response) => { json(response, 500, { error: { code: 2, message: 'Service temporarily unavailable' } }); return true; }],
    ['phản hồi lạ', (_e, response) => { json(response, 200, { khong: 'co id' }); return true; }],
  ];
  for (const [label, handle] of modes) {
    seen = [];
    const pub = publisher();
    const req = request(files(PNG));
    assert.deepEqual(await pub.prepare(req), { ok: true });
    override = (entry, response) => (entry.path.endsWith('/feed') ? handle(entry, response) : undefined);
    const result = await pub.submit(req);
    assert.equal(result.status, 'unknown', label);
    assert.equal(result.status === 'unknown' && result.reasonCode, 'network_error', label);
    assert.equal(count('POST', '/feed'), 1, `${label}: chỉ một yêu cầu tạo bài`);
    assert.equal((await pub.submit(req)).status, 'failed', label); // gọi lại cũng không gửi thêm
    assert.equal(count('POST', '/feed'), 1, label);
    override = undefined;
  }
});

test('Meta trả lỗi rõ ràng khi tạo bài → failed với mã đúng (token hết hạn, bị từ chối quyền, giới hạn tần suất) và đánh dấu kết nối', async () => {
  const cases: Array<[number, number, string, [string, string] | null]> = [
    [400, 190, 'session_expired', [CONNECTION, 'expired']],
    [403, 200, 'destination_not_allowed', [CONNECTION, 'denied']],
    [400, 4, 'network_error', null],
  ];
  for (const [status, fbCode, reason, problem] of cases) {
    problems = []; seen = [];
    const pub = publisher();
    const req = request(files(PNG));
    await pub.prepare(req);
    override = (entry, response) => { if (entry.path.endsWith('/feed')) { json(response, status, { error: { code: fbCode, message: 'x' } }); return true; } return undefined; };
    const result = await pub.submit(req);
    assert.deepEqual([result.status, result.reasonCode], ['failed', reason]);
    assert.deepEqual(problems, problem ? [problem] : []);
    assert.equal(count('POST', '/feed'), 1);
    override = undefined;
  }
});

test('verify chỉ đọc: thấy bài đúng caption → published; không thấy → not_found (không phải phép gửi lại); lỗi token → unknown', async () => {
  const pub = publisher();
  const req = request(files(PNG));
  const found = await pub.verify(req);
  assert.deepEqual([found.status, found.evidence?.remoteUrl], ['published', `https://www.facebook.com/${PAGE_ID}/posts/777`]);
  const none = await pub.verify(request(files(PNG), { caption: 'Caption khác hoàn toàn' }));
  assert.equal(none.status, 'not_found');
  override = (_e, response) => { json(response, 400, { error: { code: 190, message: 'x' } }); return true; };
  const expired = await pub.verify(req);
  assert.deepEqual([expired.status, expired.reasonCode], ['unknown', 'session_expired']);
  assert.equal(seen.every((entry) => entry.method === 'GET'), true); // chỉ đọc
  assert.equal(count('POST', '/feed') + count('POST', '/photos'), 0);
});

test('stop: dọn ảnh đã tải của bài chưa gửi và chặn việc sau đó; không thu hồi bài đã gửi', async () => {
  const pub = publisher();
  const req = request(files(PNG, JPEG));
  await pub.prepare(req);
  assert.deepEqual(await pub.stop(), { requested: true, futureSubmissionsBlocked: true, inFlight: 'none', remoteRecall: false });
  assert.equal(count('DELETE', '900001') + count('DELETE', '900002'), 2);
  assert.equal((await pub.submit(req)).status, 'failed');
  assert.equal(count('POST', '/feed'), 0);
  const after = await pub.prepare(request(files(PNG), { jobId: 'job-2' }));
  assert.deepEqual([after.ok, !after.ok && after.reasonCode], [false, 'stopped']);
});

test('hợp đồng: yêu cầu thiếu ngữ cảnh/sai kênh bị từ chối; nhận dạng ảnh theo chữ ký file; ánh xạ mã lỗi', async () => {
  const pub = publisher();
  const noContext = await pub.prepare({ jobId: 'j', destinationId: 'd', caption: 'abc', mediaPaths: ['x'] });
  assert.deepEqual([noContext.ok, !noContext.ok && noContext.reasonCode], [false, 'invalid_request']);
  const group = request(files(PNG), { context: { requestId: 'r', approvalId: 'a', contentVersionId: 'v', expectedIdentity: { kind: 'account', localId: 'acc', remoteId: 'g1' }, destination: { channel: 'group', remoteId: 'g1' } } });
  const wrongChannel = await pub.prepare(group);
  assert.deepEqual([wrongChannel.ok, !wrongChannel.ok && wrongChannel.reasonCode], [false, 'destination_not_allowed']);
  assert.equal(sniffImage(PNG), 'image/png');
  assert.equal(sniffImage(JPEG), 'image/jpeg');
  assert.equal(sniffImage(Buffer.concat([Buffer.from('RIFF....WEBP'), Buffer.alloc(8)])), 'image/webp');
  assert.equal(sniffImage(Buffer.from('chu')), null);
  assert.deepEqual([reasonFor('token_expired'), reasonFor('permission_denied'), reasonFor('rate_limited'), reasonFor('invalid_request')], ['session_expired', 'destination_not_allowed', 'network_error', 'unknown']);
  assert.equal(count('POST', '/feed') + count('POST', '/photos'), 0);
});
