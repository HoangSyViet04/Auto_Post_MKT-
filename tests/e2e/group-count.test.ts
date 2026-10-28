import assert from 'node:assert/strict';
import { once } from 'node:events';
import net from 'node:net';
import { join, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { test } from 'node:test';
import { chromium } from 'playwright-core';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';
import sharp from 'sharp';
import { createAccountRepository, createContentRepository, createGroupRepository, createJoinedScanRepository, writeWorkerHeartbeat } from '#storage';
import { createTestWorkspace } from '#test-support';
import { buildApp } from '../../apps/server/src/app.ts';
import { createJoinedScanRunner } from '../../apps/worker/src/joined-scans.ts';
import { toVnLocal } from '../../apps/web/src/post-plan.ts';

async function freePort() {
  const server = net.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  await new Promise<void>((done) => server.close(() => done())); return address.port;
}

test('UI offline: quét 40 nhóm → nhập 30 → preview → duyệt đúng 30 job, không gửi Facebook', { timeout: 90000 }, async () => {
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
    const bluePhone = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="400"><rect width="320" height="400" fill="#edf1f6"/><rect x="66" y="32" width="188" height="336" rx="29" fill="#7197b5" stroke="#50748d" stroke-width="4"/><rect x="79" y="47" width="83" height="86" rx="20" fill="#85a7bf"/><circle cx="103" cy="73" r="18" fill="#253c53" stroke="#c4d6e3" stroke-width="4"/><circle cx="138" cy="109" r="18" fill="#253c53" stroke="#c4d6e3" stroke-width="4"/><circle cx="139" cy="66" r="6" fill="#eee7d7"/><circle cx="158" cy="229" r="18" fill="#d3e0e9"/></svg>';
    const frontPhone = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="400"><defs><linearGradient id="screen" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#22a5e0"/><stop offset=".5" stop-color="#1559b8"/><stop offset="1" stop-color="#18284d"/></linearGradient></defs><rect width="320" height="400" fill="#edf1f6"/><rect x="66" y="32" width="188" height="336" rx="29" fill="#15202d"/><rect x="74" y="40" width="172" height="320" rx="24" fill="url(#screen)"/><path d="M113 40h94v12a12 12 0 0 1-12 12h-70a12 12 0 0 1-12-12Z" fill="#15202d"/><path d="M74 310 246 140v220H74Z" fill="#ca9ee1" opacity=".5"/></svg>';
    const media = await ws.media.importBytes(await sharp(Buffer.from(bluePhone)).png().toBuffer());
    const front = await ws.media.importBytes(await sharp(Buffer.from(frontPhone)).png().toBuffer());
    const product = createContentRepository(ws.db).createProduct({ name: 'iPhone 13 · 128GB', condition: 'Xước nhẹ viền', mediaIds: [media.id, front.id] });
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
    await page.getByText('Chọn tài khoản để xem nhóm', { exact: true }).waitFor();
    const screenshotDir = process.env.APM_UI_SCREENSHOTS;
    if (screenshotDir) { mkdirSync(screenshotDir, { recursive: true }); await page.screenshot({ path: join(screenshotDir, 'ui-implemented-empty.png'), fullPage: true }); }
    await page.getByRole('combobox', { name: 'Tài khoản', exact: true }).selectOption(accountId);
    await page.getByRole('combobox', { name: 'Máy', exact: true }).selectOption(product.productId);
    await page.getByRole('checkbox', { name: 'Chọn Nhóm thử 00', exact: true }).waitFor();
    await page.getByRole('spinbutton', { name: 'Số nhóm muốn đăng', exact: true }).fill('30');
    await page.getByRole('button', { name: 'Chọn theo số lượng', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Đã chọn 30/30 nhóm' }).waitFor();
    assert.equal(await page.getByRole('combobox', { name: 'Nhóm xem trước', exact: true }).locator('option').count(), 30);
    await page.getByRole('button', { name: 'Mở bảng quét nhóm', exact: true }).click();
    await page.getByRole('button', { name: 'Quét nhóm đã tham gia', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Đã lưu 40 nhóm' }).waitFor();
    await page.getByRole('button', { name: 'Mở bảng quét nhóm', exact: true }).click();
    assert.equal(ws.db.prepare('SELECT count(*) AS n FROM publish_jobs').get()?.n, 0);
    await page.getByRole('checkbox', { name: /Tôi xác nhận ĐĂNG THẬT 30 bài/ }).check();
    assert.equal(await page.getByRole('button', { name: 'Duyệt và xếp lịch (30 nhóm)', exact: true }).isEnabled(), true);
    const previewGroup = await page.getByRole('combobox', { name: 'Nhóm xem trước', exact: true }).inputValue();
    const previewName = await page.getByRole('combobox', { name: 'Nhóm xem trước', exact: true }).locator('option:checked').textContent();
    await page.getByRole('button', { name: 'Chỉnh sửa nội dung', exact: true }).click();
    const ownCaption = 'iPhone 13 128GB\nTình trạng: Xước nhẹ viền.\nNhắn tin để biết thêm thông tin.';
    await page.getByRole('textbox', { name: `Caption cho ${previewName}`, exact: true }).fill(ownCaption);
    assert.equal(await page.getByRole('checkbox', { name: /Tôi xác nhận ĐĂNG THẬT 30 bài/ }).isChecked(), false, 'sửa nội dung phải xác nhận lại');
    assert.equal(await page.getByRole('button', { name: 'Duyệt và xếp lịch (30 nhóm)', exact: true }).isEnabled(), false);
    await page.getByRole('button', { name: 'Xong chỉnh sửa', exact: true }).click();
    assert.equal(await page.locator('.preview-caption').textContent(), ownCaption);
    await page.getByRole('radio', { name: 'Hẹn giờ', exact: true }).check();
    await page.getByRole('textbox', { name: 'Giờ hẹn', exact: true }).fill(toVnLocal(Date.now() + 3600000));
    await page.getByRole('radio', { name: 'Bắt đầu ngay', exact: true }).check();
    await page.getByRole('button', { name: 'Lưu cấu hình', exact: true }).click();
    await page.getByRole('textbox', { name: 'Tên cấu hình', exact: true }).fill('Mẫu 30 nhóm');
    await page.getByRole('button', { name: 'Lưu thành cấu hình mới (30 nhóm)', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Đã lưu cấu hình mới.' }).waitFor();
    await page.locator('#posting-presets > summary').click();
    assert.equal(ws.db.prepare('SELECT count(*) AS n FROM posting_presets').get()?.n, 1);
    await page.evaluate('window.scrollTo(0, 0)');
    if (screenshotDir) await page.screenshot({ path: join(screenshotDir, 'ui-implemented-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, 'không tràn ngang trên mobile');
    await page.getByRole('button', { name: 'Mở hoặc đóng menu', exact: true }).click();
    await page.getByRole('link', { name: 'Quản lý tài khoản', exact: true }).click();
    await page.getByRole('heading', { name: 'Quản lý tài khoản', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Mở hoặc đóng menu', exact: true }).click();
    await page.getByRole('link', { name: 'Đăng nhóm', exact: true }).click();
    await page.getByRole('combobox', { name: 'Nhóm xem trước', exact: true }).waitFor();
    await page.getByRole('combobox', { name: 'Nhóm xem trước', exact: true }).selectOption(previewGroup);
    assert.equal(await page.locator('.preview-caption').textContent(), ownCaption, 'đổi trang giữ bản nháp và caption từng nhóm');
    await page.evaluate('window.scrollTo(0, 0)');
    if (screenshotDir) await page.screenshot({ path: join(screenshotDir, 'ui-implemented-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('checkbox', { name: /Tôi xác nhận ĐĂNG THẬT 30 bài/ }).check();
    await page.getByRole('button', { name: 'Duyệt và xếp lịch (30 nhóm)', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Đã duyệt và xếp 30 job.' }).waitFor();
    assert.equal(ws.db.prepare('SELECT count(*) AS n FROM publish_jobs').get()?.n, 30);
    assert.equal(ws.db.prepare("SELECT count(*) AS n FROM publish_jobs WHERE status='queued'").get()?.n, 30);
    assert.equal(ws.db.prepare('SELECT c.caption FROM publish_jobs j JOIN approvals a ON a.id=j.approval_id JOIN content_versions c ON c.id=a.content_version_id WHERE a.destination_id=?').get(previewGroup)?.caption, ownCaption);
    for (const [route, heading] of [['products', 'Quản lý máy'], ['scan-joined', 'Nhóm đã tham gia'], ['post-profile', 'Đăng bài viết cá nhân'], ['post-page', 'Đăng bài fanpage'], ['queue', 'Hàng chờ và lịch sử đăng'], ['sales', 'Khách hỏi và đơn hàng']]) {
      await page.goto(`http://127.0.0.1:${webPort}/#/${route}`);
      await page.getByRole('heading', { name: heading, exact: true }).waitFor();
      assert.equal(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, `${route} không tràn khung`);
    }
    // No publishing worker is started: these are local DB records in the test workspace only.
    assert.deepEqual(pageErrors, []);
  } finally {
    if (timer) clearInterval(timer);
    await browser?.close(); await vite.close(); await app.close(); ws.dispose();
  }
});
