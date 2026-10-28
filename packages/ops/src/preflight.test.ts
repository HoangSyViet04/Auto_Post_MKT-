import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { checkDataDir, checkDependencies, checkEdge, checkNode, checkPort, checkWebBuilt, edgeCandidates, runPreflight, satisfiesNodeRange } from './preflight.ts';

let root: string;
const servers: Server[] = [];
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'Thư mục thử có dấu ')); });
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise((resolve) => server.close(resolve));
  rmSync(root, { recursive: true, force: true });
});
const listen = (): Promise<{ server: Server; port: number }> => new Promise((resolve) => {
  const server = createServer();
  servers.push(server);
  server.listen({ port: 0, host: '127.0.0.1' }, () => resolve({ server, port: (server.address() as { port: number }).port }));
});

test('Node: chỉ chấp nhận đúng khoảng của engines; phiên bản/khoảng lạ bị từ chối', () => {
  const range = '>=24.11.0 <25';
  for (const ok of ['v24.16.0', '24.11.0', 'v24.99.9']) assert.equal(satisfiesNodeRange(ok, range), true, ok);
  for (const bad of ['v24.10.9', 'v25.0.0', 'v22.12.0', 'v18.0.0', 'abc', '']) assert.equal(satisfiesNodeRange(bad, range), false, bad);
  assert.equal(satisfiesNodeRange('v24.16.0', '^24'), false); // dạng khoảng không hỗ trợ → không coi là thỏa
  const old = checkNode('v20.1.0', range);
  assert.deepEqual([old.ok, old.severity], [false, 'error']);
  assert.match(old.fix ?? '', /Node 24/u);
  assert.equal(checkNode('v24.16.0', range).ok, true);
});

test('thiếu thư viện là lỗi chặn kèm cách khắc phục; thiếu bản build chỉ là cảnh báo (sẽ tự build)', () => {
  const missing = checkDependencies(root);
  assert.deepEqual([missing.ok, missing.severity], [false, 'error']);
  assert.match(missing.fix ?? '', /npm ci/u);
  mkdirSync(join(root, 'node_modules', 'fastify'), { recursive: true });
  writeFileSync(join(root, 'node_modules', 'fastify', 'package.json'), '{}');
  assert.equal(checkDependencies(root).ok, true);

  const web = checkWebBuilt(join(root, 'dist'));
  assert.deepEqual([web.ok, web.severity], [false, 'warn']);
  mkdirSync(join(root, 'dist'));
  writeFileSync(join(root, 'dist', 'index.html'), '<html>');
  assert.equal(checkWebBuilt(join(root, 'dist')).ok, true);
});

test('thư mục dữ liệu: tạo và ghi được dù đường dẫn có dấu tiếng Việt và khoảng trắng; không ghi được thì báo lỗi rõ', () => {
  const fancy = join(root, 'Dữ liệu vận hành', 'Ứng dụng đăng bài');
  assert.equal(checkDataDir(fancy).ok, true);
  const blocker = join(root, 'la-file');
  writeFileSync(blocker, 'x');
  const bad = checkDataDir(join(blocker, 'con')); // cha là file: không tạo được
  assert.deepEqual([bad.ok, bad.severity], [false, 'error']);
  assert.match(bad.fix ?? '', /quyền ghi/u);
});

test('cổng: trống thì đạt; bị chiếm bởi chương trình khác và bị chiếm bởi chính Auto Post MKT được phân biệt', async () => {
  const { server, port } = await listen();
  const other = await checkPort(port, async () => false);
  assert.deepEqual([other.ok, other.severity], [false, 'error']);
  assert.match(other.message, /chương trình khác/u);
  assert.match(other.fix ?? '', /APM_SERVER_PORT/u);
  const ours = await checkPort(port, async () => true);
  assert.match(ours.message, /Auto Post MKT đã đang chạy/u);
  await new Promise((resolve) => server.close(resolve));
  assert.equal((await checkPort(port, async () => false)).ok, true);
});

test('Edge: tìm theo biến môi trường (không đường dẫn cứng); không có thì cảnh báo chứ không chặn', () => {
  const env = { ProgramFiles: 'X:/PF', 'ProgramFiles(x86)': 'X:/PF86', LOCALAPPDATA: 'X:/Local' };
  const candidates = edgeCandidates(env);
  assert.equal(candidates.length, 3);
  assert.ok(candidates.every((path) => path.endsWith(join('Microsoft', 'Edge', 'Application', 'msedge.exe'))));
  assert.equal(checkEdge(env, (path) => path.includes('PF86')).ok, true);
  const none = checkEdge(env, () => false);
  assert.deepEqual([none.ok, none.severity], [false, 'warn']);
  assert.deepEqual(edgeCandidates({}), []);
});

test('chạy đủ các kiểm tra: gom nhiều lỗi một lượt; worker đang chạy là lỗi; không cần Edge khi không mở trình duyệt', async () => {
  mkdirSync(join(root, 'node_modules', 'fastify'), { recursive: true });
  writeFileSync(join(root, 'node_modules', 'fastify', 'package.json'), '{}');
  const { port } = await listen();
  const base = { rootDir: root, distDir: join(root, 'dist'), dataDir: join(root, 'Dữ liệu'), port, nodeVersion: 'v24.16.0', nodeRange: '>=24.11.0 <25',
    env: {}, wantBrowser: false, workerRunning: () => true, probeHealth: async () => false };
  const checks = await runPreflight(base);
  const errors = checks.filter((check) => !check.ok && check.severity === 'error').map((check) => check.id).sort();
  assert.deepEqual(errors, ['port', 'worker']); // cả hai lỗi được báo cùng lúc
  assert.equal(checks.some((check) => check.id === 'browser'), false);
  assert.equal((await runPreflight({ ...base, wantBrowser: true })).some((check) => check.id === 'browser'), true);
});
