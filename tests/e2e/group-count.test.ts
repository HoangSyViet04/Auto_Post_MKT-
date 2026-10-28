import assert from 'node:assert/strict';
import { once } from 'node:events';
import net from 'node:net';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright-core';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';
import sharp from 'sharp';
import { createAccountRepository, createContentRepository, createGroupRepository, createJoinedScanRepository, writeWorkerHeartbeat } from '#storage';
import { createTestWorkspace } from '#test-support';
import { buildApp } from '../../apps/server/src/app.ts';
import { createJoinedScanRunner } from '../../apps/worker/src/joined-scans.ts';

async function freePort() {
  const server = net.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  await new Promise<void>((done) => server.close(() => done())); return address.port;
}

test('UI offline: quét 40 nhóm → nhập 30 → preview → duyệt đúng 30 job, không gửi Facebook', { timeout: 60000 }, async () => {
  const ws = createTestWorkspace();
  const apiPort = await freePort(); const webPort = await freePort();
  const app = buildApp({ db: ws.db, env: 'development', integrations: 'live', logger: false, mediaStore: ws.media,
    security: { serverPort: apiPort, webPort } });
  const vite = await createServer({ configFile: false, root: resolve('apps/web'), logLevel: 'silent', plugins: [react()],
    cacheDir: join(ws.dataDir, 'vite-cache'), server: { host: '127.0.0.1', port: webPort, strictPort: true,
      proxy: { '/api': `http://127.0.0.1:${apiPort}` } } });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    const accounts = createAccountRepository(ws.db);
    const accountId = accounts.create({ label: 'Nick thử offline' }).id;
    accounts.recordIdentity(accountId, 'vanity:offline'); accounts.recordSession(accountId, 'logged_in');
    const media = await ws.media.importBytes(await sharp({ create: { width: 8, height: 8, channels: 3, background: '#00aa88' } }).png().toBuffer());
    const product = createContentRepository(ws.db).createProduct({ name: 'Máy thử chọn 30 nhóm', condition: 'Xước nhẹ', mediaIds: [media.id] });
    const runner = createJoinedScanRunner({ db: ws.db, workerId: 'offline-ui', dataDir: ws.dataDir, scan: async (input) => {
      input.onBatch(Array.from({ length: 40 }, (_, i) => ({ reference: String(123456780000 + i), name: `Nhóm thử ${String(i).padStart(2, '0')}` })));
      return { status: 'partial', reason: 'no_more_results_seen' };
    } });
    let running = false;
    timer = setInterval(() => {
      writeWorkerHeartbeat(ws.db, 'real');
      if (!running) { running = true; runner.processNext().finally(() => { running = false; }); }
    }, 200);
    writeWorkerHeartbeat(ws.db, 'real');
    await app.listen({ host: '127.0.0.1', port: apiPort }); await vite.listen();
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url());
      return url.hostname === '127.0.0.1' && url.port === String(webPort) ? route.continue() : route.abort();
    });
    await page.goto(`http://127.0.0.1:${webPort}/#/scan-joined`);
    await page.getByRole('combobox', { name: 'Tài khoản', exact: true }).selectOption(accountId);
    await page.getByRole('button', { name: 'Quét nhóm đã tham gia', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Đã lưu 40 nhóm' }).waitFor();
    assert.equal(createJoinedScanRepository(ws.db).latest(accountId)?.observedCount, 40);
    const groups = createGroupRepository(ws.db);
    assert.ok(groups.list({ accountId, pageSize: 100 }).items.every((item) => !item.accounts[0]?.eligible));
    // Permission remains a separate user declaration. Existing per-row UI performs the same API operation.
    for (const item of groups.list({ accountId, pageSize: 100 }).items) groups.setRelation(item.id, accountId, { permission: 'allowed' });
    await page.goto(`http://127.0.0.1:${webPort}/#/post-group`);
    await page.getByRole('combobox', { name: 'Tài khoản', exact: true }).selectOption(accountId);
    await page.getByRole('combobox', { name: 'Máy', exact: true }).selectOption(product.productId);
    await page.getByRole('checkbox', { name: 'Chọn Nhóm thử 00', exact: true }).waitFor();
    await page.getByRole('spinbutton', { name: 'Số nhóm muốn đăng', exact: true }).fill('30');
    await page.getByRole('button', { name: 'Chọn theo số lượng', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Đã chọn 30/30 nhóm' }).waitFor();
    assert.equal(await page.locator('.preview-card').count(), 30);
    assert.equal(ws.db.prepare('SELECT count(*) AS n FROM publish_jobs').get()?.n, 0);
    await page.getByRole('checkbox', { name: /Tôi xác nhận ĐĂNG THẬT 30 bài/ }).check();
    await page.getByRole('button', { name: 'Duyệt và xếp lịch (30 nhóm)', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Đã duyệt và xếp 30 job.' }).waitFor();
    assert.equal(ws.db.prepare('SELECT count(*) AS n FROM publish_jobs').get()?.n, 30);
    assert.equal(ws.db.prepare("SELECT count(*) AS n FROM publish_jobs WHERE status='queued'").get()?.n, 30);
    // No publishing worker is started: these are local DB records in the test workspace only.
    assert.deepEqual(pageErrors, []);
  } finally {
    if (timer) clearInterval(timer);
    await browser?.close(); await vite.close(); await app.close(); ws.dispose();
  }
});
