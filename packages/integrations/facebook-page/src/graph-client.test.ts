import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, beforeEach, test } from 'node:test';
import { classifyGraphError, createGraphClient, DEFAULT_GRAPH_VERSION, GRAPH_ERROR_MESSAGE, getGraphVersion } from './graph-client.ts';

const APP_SECRET = 'bi-mat-ung-dung-0123456789abcdef';
const USER_TOKEN = 'EAAUSERTOKEN-1111111111111111111111111';
const PAGE_TOKEN = 'EAAPAGETOKEN-2222222222222222222222222';

interface Seen { method: string; url: string; authorization: string | undefined; body: string }
let server: Server;
let base: string;
let seen: Seen[];
let handler: (request: Seen, response: ServerResponse) => void;

beforeEach(async () => {
  seen = [];
  handler = (_request, response) => { response.writeHead(404).end('{}'); };
  server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const entry = { method: String(request.method), url: String(request.url), authorization: request.headers.authorization, body: Buffer.concat(chunks).toString('utf8') };
      seen.push(entry);
      handler(entry, response);
    });
  });
  await new Promise<void>((done) => server.listen({ host: '127.0.0.1', port: 0 }, done));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterEach(async () => { await new Promise((done) => server.close(done)); });

const json = (response: ServerResponse, status: number, body: unknown) => { response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body)); };
const client = (extra: { timeoutMs?: number } = {}) => createGraphClient({ baseUrl: base, ...extra });
const everythingSent = () => JSON.stringify(seen);

test('đổi token: bí mật ứng dụng và token đi trong thân POST, TUYỆT ĐỐI không nằm trong URL hay header', async () => {
  handler = (_request, response) => json(response, 200, { access_token: 'EAALONGLIVED-3333333333333333', token_type: 'bearer', expires_in: 5_183_944 });
  const result = await client().exchangeUserToken({ appId: '1472561554750532', appSecret: APP_SECRET, shortLivedToken: USER_TOKEN });
  assert.deepEqual(result, { ok: true, value: { accessToken: 'EAALONGLIVED-3333333333333333', expiresInSec: 5_183_944 } });
  const [request] = seen;
  assert.ok(request);
  assert.equal(request.method, 'POST');
  assert.equal(request.url, `/${DEFAULT_GRAPH_VERSION}/oauth/access_token`); // không có query
  assert.equal(request.authorization, undefined);
  const form = new URLSearchParams(request.body);
  assert.deepEqual([form.get('grant_type'), form.get('client_id'), form.get('client_secret'), form.get('fb_exchange_token')], ['fb_exchange_token', '1472561554750532', APP_SECRET, USER_TOKEN]);
});

test('liệt kê Page: token trong header Authorization, URL chỉ có tham số không nhạy cảm; phân trang bằng con trỏ after, KHÔNG đi theo paging.next', async () => {
  let call = 0;
  handler = (_request, response) => {
    call += 1;
    if (call === 1) {
      return json(response, 200, {
        data: [{ id: '107892312229541', name: 'Góc Nghiện Đồ Hay', category: 'Trang phục & quần áo', access_token: PAGE_TOKEN, tasks: ['CREATE_CONTENT', 'MANAGE', 7] }, { id: 'abc', name: 'ID sai', access_token: 'x' }],
        paging: { cursors: { after: 'CURSOR2' }, next: 'https://evil.example/steal?access_token=SECRET' },
      });
    }
    return json(response, 200, { data: [{ id: '200000000000001', name: 'Page hai', access_token: 'EAATWO-44444444444444444444', tasks: [] }], paging: { cursors: { after: 'END' } } });
  };
  const result = await client().listPages(USER_TOKEN);
  assert.equal(result.ok && result.value.length, 2); // dòng có ID sai bị bỏ
  assert.deepEqual(result.ok && result.value[0], { id: '107892312229541', name: 'Góc Nghiện Đồ Hay', category: 'Trang phục & quần áo', accessToken: PAGE_TOKEN, tasks: ['CREATE_CONTENT', 'MANAGE'] });
  assert.equal(seen.length, 2);
  for (const request of seen) {
    assert.equal(request.authorization, `Bearer ${USER_TOKEN}`);
    assert.equal(request.url.includes(USER_TOKEN), false);
    assert.equal(new URL(request.url, base).searchParams.has('access_token'), false); // chỉ là tên trường cần đọc trong `fields`, không phải tham số token
    assert.equal(request.body, '');
  }
  assert.match(seen[1]?.url ?? '', /after=CURSOR2/u); // dùng con trỏ của mình, không gọi URL do Meta dựng
});

test('kiểm tra Page chỉ-đọc: đúng ID thì đạt; Meta trả ID khác hoặc thiếu tên thì bị từ chối', async () => {
  handler = (request, response) => json(response, 200, { id: request.url.includes('107892312229541') ? '107892312229541' : '999999999999', name: 'Góc Nghiện Đồ Hay' });
  assert.deepEqual(await client().checkPage('107892312229541', PAGE_TOKEN), { ok: true, value: { id: '107892312229541', name: 'Góc Nghiện Đồ Hay' } });
  const mismatch = await client().checkPage('555555555555', PAGE_TOKEN);
  assert.deepEqual([mismatch.ok, !mismatch.ok && mismatch.code], [false, 'bad_response']);
  assert.equal((await client().checkPage('không-phải-số', PAGE_TOKEN)).ok, false);
  assert.equal(seen.every((request) => request.method === 'GET' && !request.url.includes(PAGE_TOKEN)), true);
});

test('phân loại lỗi theo MÃ của Meta; kết quả lỗi không chứa nguyên văn thông báo, token hay bí mật', async () => {
  const cases: Array<[number, unknown, string]> = [
    [400, { error: { message: `Invalid OAuth access token ${USER_TOKEN}`, type: 'OAuthException', code: 190, error_subcode: 463 } }, 'token_expired'],
    [403, { error: { message: 'Permissions error', code: 200 } }, 'permission_denied'],
    [400, { error: { message: 'Application request limit reached', code: 4 } }, 'rate_limited'],
    [500, { error: { message: 'Unknown', code: 2 } }, 'temporary'],
    [502, 'html lỗi', 'temporary'],
    [400, { error: { message: 'Unsupported get request', code: 100 } }, 'invalid_request'],
  ];
  for (const [status, body, expected] of cases) {
    handler = (_request, response) => json(response, status, body);
    const result = await client().checkPage('107892312229541', PAGE_TOKEN);
    assert.deepEqual([result.ok, !result.ok && result.code], [false, expected], JSON.stringify(body));
    assert.equal(JSON.stringify(result).includes(USER_TOKEN), false);
    assert.equal(JSON.stringify(result).includes('Invalid OAuth'), false);
  }
  handler = (_request, response) => json(response, 400, { error: { code: 1, message: `secret ${APP_SECRET}` } });
  const exchange = await client().exchangeUserToken({ appId: '1472561554750532', appSecret: APP_SECRET, shortLivedToken: USER_TOKEN });
  assert.deepEqual([exchange.ok, !exchange.ok && exchange.code], [false, 'temporary']); // mã 1 = lỗi tạm thời của Meta
  handler = (_request, response) => json(response, 400, { error: { code: 100, message: 'x' } });
  assert.equal((await client().exchangeUserToken({ appId: '1472561554750532', appSecret: APP_SECRET, shortLivedToken: USER_TOKEN })).ok, false);
  assert.equal(everythingSent().includes('evil'), false);
});

test('lỗi mạng và quá giờ trả mã network, không ném lỗi; phản hồi không phải JSON object là bad_response', async () => {
  handler = (_request, response) => { setTimeout(() => json(response, 200, {}), 400); };
  const slow = await client({ timeoutMs: 50 }).checkPage('107892312229541', PAGE_TOKEN);
  assert.deepEqual([slow.ok, !slow.ok && slow.code], [false, 'network']);
  await new Promise((done) => server.close(done));
  const closed = await client().listPages(USER_TOKEN);
  assert.deepEqual([closed.ok, !closed.ok && closed.code], [false, 'network']);
  server = createServer(); // để afterEach đóng được
  await new Promise<void>((done) => server.listen({ host: '127.0.0.1', port: 0 }, done));
});

test('chỉ nói chuyện với graph.facebook.com (hoặc loopback khi test); phiên bản API kiểm tra định dạng; mọi mã lỗi có thông báo tiếng Việt', () => {
  for (const bad of ['http://evil.example', 'https://graph.facebook.com.evil.example', 'http://localhost:9', 'ftp://graph.facebook.com']) {
    assert.throws(() => createGraphClient({ baseUrl: bad }), /Địa chỉ Graph API không hợp lệ/u, bad);
  }
  assert.doesNotThrow(() => createGraphClient());
  assert.equal(getGraphVersion({}), DEFAULT_GRAPH_VERSION);
  assert.equal(getGraphVersion({ APM_GRAPH_VERSION: ' v24.0 ' }), 'v24.0');
  for (const bad of ['24', 'v', 'latest', 'v23.0/../x']) assert.throws(() => getGraphVersion({ APM_GRAPH_VERSION: bad }), /APM_GRAPH_VERSION/u, bad);
  assert.throws(() => createGraphClient({ version: '../x' }), /Phiên bản Graph API/u);
  assert.equal(classifyGraphError(null, 190), 'token_expired');
  assert.equal(classifyGraphError(401, null), 'token_expired');
  assert.equal(classifyGraphError(400, 80004), 'rate_limited');
  for (const message of Object.values(GRAPH_ERROR_MESSAGE)) assert.ok(message.length > 10);
});
