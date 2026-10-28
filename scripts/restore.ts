/**
 * Phục hồi từ bản sao lưu: npm run restore -- <thư mục sao lưu> [--verify-only] [--replace]
 *  --verify-only  chỉ kiểm tra bản sao lưu, không đụng dữ liệu.
 *  --replace      thay dữ liệu hiện có; bản cũ được ĐỔI TÊN (<dữ liệu>.before-restore-...), không xóa.
 * Đóng server và worker trước. Job đang chờ chuyển sang tạm dừng, tài khoản phải đăng nhập lại.
 */
import { join } from 'node:path';
import { acquireProfileLock } from '#browser';
import { getAppEnv, getDataDir } from '#config';
import { createLogger } from '#logging';
import { restoreBackup, verifyBackup } from '#storage';

let log = createLogger({ env: 'production', name: 'restore' });
try {
  log = createLogger({ env: getAppEnv(), name: 'restore' });
  const args = process.argv.slice(2);
  const backupDir = args.find((arg) => !arg.startsWith('--'));
  if (!backupDir) throw new Error('Cách dùng: npm run restore -- <thư mục sao lưu> [--verify-only] [--replace]');

  const check = verifyBackup(backupDir);
  if (!check.ok) {
    for (const problem of check.problems) log.error(problem);
    throw new Error('Bản sao lưu không hợp lệ; không thay đổi gì.');
  }
  log.info(`Bản sao lưu hợp lệ (tạo lúc ${check.manifest?.createdAt}, schema v${check.manifest?.schemaVersion}, ${check.manifest?.media.length} ảnh).`);
  if (args.includes('--verify-only')) {
    log.info('--verify-only: không phục hồi.');
  } else {
    const dataDir = getDataDir();
    // Worker đang chạy giữ khóa này: không phục hồi đè lên dữ liệu đang dùng.
    try { acquireProfileLock(join(dataDir, 'worker.lock')).release(); } catch { throw new Error('Worker đang chạy với thư mục dữ liệu này. Tắt server và worker rồi chạy lại.'); }
    const result = restoreBackup({ backupDir, targetDataDir: dataDir, dbFileName: `${getAppEnv()}.sqlite`, replace: args.includes('--replace') });
    log.info(`Đã phục hồi vào ${result.targetDataDir}`);
    if (result.previousKeptAt) log.info(`Dữ liệu cũ giữ nguyên tại ${result.previousKeptAt} (xóa tay khi chắc chắn không cần).`);
    log.info(`${result.mediaRestored} ảnh; ${result.pausedJobs} job đang chờ đã chuyển sang TẠM DỪNG (không tự chạy); ${result.accountsNeedLogin} tài khoản cần đăng nhập lại.`);
    if (result.missingMedia) log.warn(`${result.missingMedia} ảnh thiếu trong bản sao lưu.`);
    if (result.keptLocalState) log.info('Đã giữ hồ sơ trình duyệt và khóa của máy này.');
  }
} catch (error) {
  log.error(error);
  process.exitCode = 1;
}
