/**
 * Worker: nhận lệnh trình duyệt, (sau này) scheduler, quét nhóm, thực hiện đăng.
 * Tiến trình DUY NHẤT được điều khiển Playwright/browser profiles.
 * Điều khiển trình duyệt mặc định TẮT (APM_BROWSER=off); chỉ chạy lệnh đăng nhập/kiểm tra phiên do người dùng bấm khi APM_BROWSER=real.
 * Chạy job đến hạn bằng adapter đã chọn (APM_INTEGRATIONS=fake: mô phỏng, không gọi Facebook). Khởi động worker không tự tạo job. `--once`: khởi động, ghi nhịp sống, thoát (dùng cho test).
 */
import { createPlaywrightDriver } from '#browser';
import { getAppEnv, getBrowserMode, getDatabasePath, getDataDir, getIntegrationMode, getMinGapMs, getOverdueAfterMs, getProfileAudience } from '#config';
import { join } from 'node:path';
import { createLogger } from '#logging';
import { createAccountRepository, createMediaStore, migrate, openDatabase, writeWorkerHeartbeat } from '#storage';
import { createBrowserCommandRunner } from './browser-commands.ts';
import { createJobRunner } from './job-runner.ts';
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
  if (mode === 'live' && browser !== 'real') throw new Error('APM_INTEGRATIONS=live cần APM_BROWSER=real');
  const dataDir = getDataDir();
  const db = openDatabase(getDatabasePath());
  migrate(db);
  const accountRepo = createAccountRepository(db);
  const profileAudience = getProfileAudience();
  const publishers = createPublishers(mode, mode === 'live'
    ? { profileDirFor: (accountId) => join(dataDir, 'profiles', accountRepo.profileKey(accountId)), ...(profileAudience ? { profileAudience } : {}) }
    : undefined);
  const simulated = Object.values(publishers).every((p) => p.capabilities.simulated);
  log.info(
    `[worker] env=${env} integrations=${mode}${simulated ? ' (mô phỏng, không gọi Facebook)' : ''} browser=${browser} channels=${Object.keys(publishers).join(',')}`,
  );
  log.info('[worker] Chỉ chạy job do người dùng đã duyệt và xếp lịch; không tự tạo bài.');

  writeWorkerHeartbeat(db, browser);

  if (process.argv.includes('--once')) {
    db.close();
  } else {
    const workerId = `worker-${process.pid}`;
    const runner = browser === 'real'
      ? createBrowserCommandRunner({ db, driver: createPlaywrightDriver(), workerId, dataDir, log })
      : undefined;
    const jobRunner = createJobRunner({ db, workerId, mode, publishers, media: createMediaStore(db), minGapMs: getMinGapMs(), overdueAfterMs: getOverdueAfterMs(), log });
    if (!runner) log.info('[worker] APM_BROWSER=off: không mở trình duyệt; lệnh đăng nhập/kiểm tra phiên sẽ chờ cho tới khi bật APM_BROWSER=real.');
    const beat = setInterval(() => {
      try { writeWorkerHeartbeat(db, browser); } catch (error) { log.error({ errorName: error instanceof Error ? error.name : 'unknown' }, 'Không ghi được nhịp sống'); }
    }, HEARTBEAT_MS);
    let busy = false;
    let jobsBusy = false;
    const poll = setInterval(() => {
      if (runner && !busy) {
        busy = true;
        (async () => { while ((await runner.processNext()) === 'processed') { /* xử lý hết lệnh đang chờ */ } })()
          .catch((error) => log.error({ errorName: error instanceof Error ? error.name : 'unknown' }, 'Vòng xử lý lệnh trình duyệt lỗi'))
          .finally(() => { busy = false; });
      }
      if (!jobsBusy) {
        jobsBusy = true;
        (async () => { while ((await jobRunner.processNext()) === 'processed') { /* xử lý hết job đến hạn */ } })()
          .catch((error) => log.error({ errorName: error instanceof Error ? error.name : 'unknown' }, 'Vòng xử lý job lỗi'))
          .finally(() => { jobsBusy = false; });
      }
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
