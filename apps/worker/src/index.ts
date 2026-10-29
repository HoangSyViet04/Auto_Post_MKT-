/**
 * Worker: nhận lệnh trình duyệt, (sau này) scheduler, quét nhóm, thực hiện đăng.
 * Tiến trình DUY NHẤT được điều khiển Playwright/browser profiles.
 * Điều khiển trình duyệt mặc định TẮT (APM_BROWSER=off); chỉ chạy lệnh đăng nhập/kiểm tra phiên do người dùng bấm khi APM_BROWSER=real.
 * Chạy job đến hạn bằng adapter đã chọn (APM_INTEGRATIONS=fake: mô phỏng, không gọi Facebook). Khởi động worker không tự tạo job. `--once`: khởi động, ghi nhịp sống, thoát (dùng cho test).
 */
import { acquireProfileLock, createDiagnosticCapture, createGroupJoiner, createGroupSearchScanner, createJoinedGroupScanner, createPlaywrightDriver } from '#browser';
import { getAppEnv, getBrowserMode, getDatabasePath, getDataDir, getDiagnosticCapture, getIntegrationMode, getMinGapMs, getOverdueAfterMs, getProfileAudience } from '#config';
import { join } from 'node:path';
import { createLogger } from '#logging';
import { watchParent } from '#ops';
import { createGraphClient, createPagePublisher } from '#fb-page';
import { createAccountRepository, createMediaStore, createPageRepository, createSecretStore, migrate, openDatabase, writeWorkerHeartbeat } from '#storage';
import { createBrowserCommandRunner } from './browser-commands.ts';
import { createJobRunner } from './job-runner.ts';
import { createPublishers } from './publishers.ts';
import { createJoinedScanRunner } from './joined-scans.ts';
import { createGroupJoinRunner, createGroupSearchRunner } from './group-discovery.ts';

const HEARTBEAT_MS = 5_000;
const POLL_MS = 2_000;
const PURGE_MS = 10 * 60_000;

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
  // Ảnh chụp chẩn đoán: TẮT mặc định (có thể chứa thông tin cá nhân). Ảnh quá hạn luôn bị dọn, kể cả khi đã tắt thu.
  const diagnostic = getDiagnosticCapture();
  const captures = createDiagnosticCapture({ dir: join(dataDir, 'diagnostics'), retentionMs: diagnostic.retentionMs });
  const purgedAtStart = captures.purgeExpired();
  if (purgedAtStart > 0) log.info(`[worker] Đã xóa ${purgedAtStart} ảnh chụp chẩn đoán quá hạn`);
  if (diagnostic.enabled) {
    log.warn(`[worker] Thu ảnh chụp chẩn đoán: BẬT (APM_DIAG_CAPTURE=on). Khi một lần đăng dừng vì lỗi sẽ lưu ảnh màn hình trình duyệt vào thư mục "diagnostics" trong dữ liệu vận hành, giữ ${Math.round(diagnostic.retentionMs / 3_600_000)} giờ rồi tự xóa. Ảnh có thể chứa thông tin cá nhân; không chia sẻ.`);
    if (mode !== 'live') log.info('[worker] Chế độ mô phỏng không mở trình duyệt đăng bài nên sẽ không có ảnh chụp.');
  }
  /** Fanpage qua Graph API: token Page lấy từ kho bí mật chỉ khi cần đăng; Meta từ chối token/quyền thì kết nối bị đánh dấu để job sau bị chặn. */
  function livePagePublisher() {
    const pages = createPageRepository(db, { secrets: createSecretStore(db) });
    return createPagePublisher({
      graph: createGraphClient(),
      tokenFor: (connectionId) => pages.revealToken(connectionId),
      onConnectionProblem: (connectionId, status) => {
        try { pages.markChecked(connectionId, status); } catch (error) { log.error({ errorName: error instanceof Error ? error.name : 'unknown' }, 'Không ghi được trạng thái kết nối Page'); }
      },
    });
  }
  const publishers = createPublishers(mode, mode === 'live'
    ? { profileDirFor: (accountId) => join(dataDir, 'profiles', accountRepo.profileKey(accountId)), ...(profileAudience ? { profileAudience } : {}),
      ...(diagnostic.enabled ? { diagnostics: captures.capture } : {}), page: livePagePublisher() }
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
    // Chỉ một worker mỗi thư mục dữ liệu: hai worker sẽ tranh hàng chờ và hồ sơ trình duyệt. Khóa của tiến trình đã chết được dọn tự động.
    let instanceLock: ReturnType<typeof acquireProfileLock>;
    try {
      instanceLock = acquireProfileLock(join(dataDir, 'worker.lock'));
    } catch {
      log.error({ code: 'worker_already_running' }, '[worker] Đã có một worker khác đang chạy với thư mục dữ liệu này. Dừng, không khởi động bản thứ hai.');
      db.close();
      process.exit(1);
    }
    const workerId = `worker-${process.pid}`;
    const runner = browser === 'real'
      ? createBrowserCommandRunner({ db, driver: createPlaywrightDriver(), workerId, dataDir, log })
      : undefined;
    const jobRunner = createJobRunner({ db, workerId, mode, publishers, media: createMediaStore(db), minGapMs: getMinGapMs(), overdueAfterMs: getOverdueAfterMs(), log });
    const scanRunner = mode === 'live' && browser === 'real'
      ? createJoinedScanRunner({ db, workerId, dataDir, scan: createJoinedGroupScanner() }) : undefined;
    const searchRunner = mode === 'live' && browser === 'real'
      ? createGroupSearchRunner({ db, workerId, dataDir, scan: createGroupSearchScanner() }) : undefined;
    const joinRunner = mode === 'live' && browser === 'real'
      ? createGroupJoinRunner({ db, workerId, dataDir, join: createGroupJoiner() }) : undefined;
    if (!runner) log.info('[worker] APM_BROWSER=off: không mở trình duyệt; lệnh đăng nhập/kiểm tra phiên sẽ chờ cho tới khi bật APM_BROWSER=real.');
    const beat = setInterval(() => {
      try { writeWorkerHeartbeat(db, browser); } catch (error) { log.error({ errorName: error instanceof Error ? error.name : 'unknown' }, 'Không ghi được nhịp sống'); }
    }, HEARTBEAT_MS);
    const purgeTimer = setInterval(() => {
      try { captures.purgeExpired(); } catch (error) { log.error({ errorName: error instanceof Error ? error.name : 'unknown' }, 'Không dọn được ảnh chụp chẩn đoán'); }
    }, PURGE_MS);
    let busy = false;
    let jobsBusy = false;
    let scansBusy = false;
    let searchBusy = false;
    let joinBusy = false;
    const poll = setInterval(() => {
      if (scanRunner && !scansBusy) {
        scansBusy = true;
        scanRunner.processNext().catch(() => log.error({ code: 'scan_error' }, 'Vòng quét nhóm lỗi')).finally(() => { scansBusy = false; });
      }
      if (searchRunner && !searchBusy) {
        searchBusy = true;
        searchRunner.processNext().catch(() => log.error({ code: 'search_error' }, 'Vòng tìm nhóm lỗi')).finally(() => { searchBusy = false; });
      }
      if (joinRunner && !joinBusy) {
        joinBusy = true;
        joinRunner.processNext().catch(() => log.error({ code: 'join_error' }, 'Vòng gửi yêu cầu tham gia nhóm lỗi')).finally(() => { joinBusy = false; });
      }
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
      clearInterval(purgeTimer);
      instanceLock.release();
      db.close();
      process.exit(0);
    };
    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));
    watchParent(process.env, () => shutdown('mất launcher')); // launcher chết đột ngột thì worker tự dừng, không nhận việc ngầm
  }
} catch (error) {
  log.error(error);
  process.exitCode = 1;
}
