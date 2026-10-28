import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { createTestWorkspace } from '#test-support';
import { buildApp } from './app.ts';

let root: string;
let workspace: ReturnType<typeof createTestWorkspace>;
let app: ReturnType<typeof buildApp>;
const good = { host: '127.0.0.1:4317' };
const get = (url: string, headers: Record<string, string> = good) => app.inject({ method: 'GET', url, headers });

beforeEach(() => {
  workspace = createTestWorkspace();
  root = mkdtempSync(join(tmpdir(), 'apm giao dien '));
  const dist = join(root, 'dist');
  mkdirSync(join(dist, 'assets'), { recursive: true });
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Auto Post MKT</title><script type="module" src="/assets/index-abc123.js"></script>');
  writeFileSync(join(dist, 'assets', 'index-abc123.js'), 'console.log("ui")');
  writeFileSync(join(dist, 'assets', 'index-abc123.css'), 'body{}');
  writeFileSync(join(dist, 'assets', 'index-abc123.js.map'), '{"sourcesContent":["MÃ-NGUỒN-BÍ-MẬT"]}');
  writeFileSync(join(root, 'bi-mat.txt'), 'NGOÀI-THƯ-MỤC-BUILD');
  writeFileSync(join(dist, '.env'), 'APM_SECRET=1');
  app = buildApp({ db: workspace.db, env: 'test', integrations: 'fake', logger: false, mediaStore: workspace.media, webDistDir: dist });
});
afterEach(async () => { await app.close(); workspace.dispose(); rmSync(root, { recursive: true, force: true }); });

test('phục vụ giao diện đã build: trang chính có CSP/nosniff, file băm nội dung có cache lâu và đúng loại', async () => {
  const index = await get('/');
  assert.equal(index.statusCode, 200);
  assert.match(String(index.headers['content-type']), /^text\/html/u);
  assert.match(String(index.headers['content-security-policy']), /default-src 'self'/u);
  assert.match(String(index.headers['content-security-policy']), /frame-ancestors 'none'/u);
  assert.equal(index.headers['x-content-type-options'], 'nosniff');
  assert.equal(index.headers['cache-control'], 'no-store');
  const script = await get('/assets/index-abc123.js');
  assert.deepEqual([script.statusCode, script.headers['content-type'], script.headers['cache-control']], [200, 'text/javascript; charset=utf-8', 'public, max-age=31536000, immutable']);
  assert.equal(script.body, 'console.log("ui")');
  assert.equal((await get('/assets/index-abc123.css')).headers['content-type'], 'text/css; charset=utf-8');
  assert.equal((await get('/api/health')).statusCode, 200); // API vẫn chạy bình thường
});

test('không tải được file nhạy cảm: bản đồ nguồn, .env, file ngoài thư mục build, thư mục, đường dẫn thoát, tên lạ', async () => {
  const blocked = [
    '/assets/index-abc123.js.map', '/index.html', '/.env', '/assets/.env', '/assets/', '/assets', '/assets/..%2f..%2fbi-mat.txt', '/assets/%2e%2e/bi-mat.txt',
    '/assets/../bi-mat.txt', '/bi-mat.txt', '/assets/index-abc123.js%00.png', '/assets/index-abc123.js/', '/assets/sub/index-abc123.js', '/assets/khong-co.js',
    '/assets/..\\..\\bi-mat.txt', '/apps/web/dist/index.html', '/package.json', '/packages/storage/src/db.ts', '/%2e%2e/%2e%2e/windows/win.ini',
  ];
  for (const url of blocked) {
    const response = await get(url);
    assert.ok([400, 404].includes(response.statusCode), `${url} → ${response.statusCode}`);
    assert.equal(response.body.includes('NGOÀI-THƯ-MỤC-BUILD') || response.body.includes('MÃ-NGUỒN-BÍ-MẬT') || response.body.includes('APM_SECRET'), false, url);
  }
  assert.ok([403, 404].includes((await app.inject({ method: 'POST', url: '/', headers: good })).statusCode)); // chỉ GET (ghi dữ liệu còn bị chặn vì thiếu token)
});

test('vẫn qua kiểm tra truy cập cục bộ: Host/Origin lạ bị từ chối cả với trang giao diện; không có bản build thì không cài route và API vẫn chạy', async () => {
  assert.equal((await get('/', { host: 'evil.example:4317' })).statusCode, 403);
  assert.equal((await get('/assets/index-abc123.js', { host: '127.0.0.1:4317', 'sec-fetch-site': 'cross-site' })).statusCode, 403);
  assert.equal((await get('/', { host: '127.0.0.1:4317', origin: 'http://evil.example' })).statusCode, 403);

  const bare = buildApp({ db: workspace.db, env: 'test', integrations: 'fake', logger: false, mediaStore: workspace.media, webDistDir: join(root, 'chua-build') });
  try {
    assert.equal((await bare.inject({ method: 'GET', url: '/', headers: good })).statusCode, 404);
    assert.equal((await bare.inject({ method: 'GET', url: '/api/health', headers: good })).statusCode, 200);
  } finally { await bare.close(); }
});
