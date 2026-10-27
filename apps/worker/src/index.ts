/**
 * Worker: nhận lệnh trình duyệt, (sau này) scheduler, quét nhóm, thực hiện đăng.
 * Tiến trình DUY NHẤT được điều khiển Playwright/browser profiles.
 * Điều khiển trình duyệt mặc định TẮT (APM_BROWSER=off); chỉ chạy lệnh đăng nhập/kiểm tra phiên do người dùng bấm khi APM_BROWSER=real.
 * Chưa có scheduler (P07): khởi động worker không tạo hay gửi bài nào. `--once`: khởi động, ghi nhịp sống, thoát (dùng cho test).
 */
import { createPlaywrightDriver } from '#browser';
import { getAppEnv, getBrowserMode, getDatabasePath, getDataDir, getIntegrationMode } from '#config';
import { createLogger } from '#logging';
import { migrate, openDatabase, writeWorkerHeartbeat } from '#storage';
import { createBrowserCommandRunner } from './browser-commands.ts';
import { createPublishers } from './publishers.ts';

const HEARTBEAT_MS = 5_000;
const POLL_MS = 2_000;

// Even startup/config errors pass through the safe logger.
let log = createLogger({ env: 'production', name: 'worker' });
try {
  const env = getAppEnv();
  log = createLogger({ env, name: 'worker' });
  const mode = getIntegrationMode();
  const browser = getBrowserMode();
  const publishers = createPublishers(mode);
  const simulated = Object.values(publishers).every((p) => p.capabilities.simulated);
  log.info(
    `[worker] env=${env} integrations=${mode}${simulated ? ' (mô phỏng, không gọi Facebook)' : ''} browser=${browser} channels=${Object.keys(publishers).join(',')}`,
  );
  log.info('[worker] Chưa có scheduler (P07): không tự đăng bài.');

  const db = openDatabase(getDatabasePath());
  migrate(db);
  writeWorkerHeartbeat(db, browser);

  if (process.argv.includes('--once')) {
    db.close();
  } else {
    const workerId = `worker-${process.pid}`;
    const runner = browser === 'real'
      ? createBrowserCommandRunner({ db, driver: createPlaywrightDriver(), workerId, dataDir: getDataDir(), log })
      : undefined;
    if (!runner) log.info('[worker] APM_BROWSER=off: không mở trình duyệt; lệnh đăng nhập/kiểm tra phiên sẽ chờ cho tới khi bật APM_BROWSER=real.');
    const beat = setInterval(() => {
      try { writeWorkerHeartbeat(db, browser); } catch (error) { log.error({ errorName: error instanceof Error ? error.name : 'unknown' }, 'Không ghi được nhịp sống'); }
    }, HEARTBEAT_MS);
    let busy = false;
    const poll = setInterval(() => {
      if (!runner || busy) return;
      busy = true;
      (async () => { while ((await runner.processNext()) === 'processed') { /* xử lý hết lệnh đang chờ */ } })()
        .catch((error) => log.error({ errorName: error instanceof Error ? error.name : 'unknown' }, 'Vòng xử lý lệnh trình duyệt lỗi'))
        .finally(() => { busy = false; });
    }, POLL_MS);
    const shutdown = (signal: string) => {
      log.info(`[worker] Nhận ${signal}, đang dừng`);
      clearInterval(beat);
      clearInterval(poll);
      db.close();
      process.exit(0);
    };
    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));
  }
} catch (error) {
  log.error(error);
  process.exitCode = 1;
}
