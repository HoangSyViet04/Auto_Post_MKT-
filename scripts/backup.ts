/**
 * Sao lưu dữ liệu vận hành: DB (nhất quán) + ảnh + manifest mã băm. Không chứa cookie, hồ sơ trình duyệt, khóa hay log.
 * Dùng: npm run backup [-- --out <thư mục>]. Mặc định ghi vào <dữ liệu>\backups\<thời điểm> (Git bỏ qua data/).
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getAppEnv, getDataDir, getDatabasePath, isRuntimeDataDirAllowed } from '#config';
import { createLogger } from '#logging';
import { createBackup, openDatabase, verifyBackup } from '#storage';

let log = createLogger({ env: 'production', name: 'backup' });
try {
  log = createLogger({ env: getAppEnv(), name: 'backup' });
  const dataDir = getDataDir();
  const flag = process.argv.indexOf('--out');
  const stamp = new Date().toISOString().replace(/\D/gu, '').slice(0, 14);
  const outDir = resolve(flag >= 0 ? (process.argv[flag + 1] ?? '') : join(dataDir, 'backups', stamp));
  if (flag >= 0 && !process.argv[flag + 1]) throw new Error('Thiếu giá trị cho --out');
  if (!isRuntimeDataDirAllowed(outDir)) throw new Error('Bản sao lưu trong dự án phải nằm trong data/ để không vào Git.');

  // Sao lưu chụp dữ liệu NGUYÊN TRẠNG: tuyệt đối không migrate ở đây (migration thuộc bước cập nhật, sau khi đã sao lưu).
  if (!existsSync(getDatabasePath())) throw new Error('Chưa có cơ sở dữ liệu để sao lưu (ứng dụng chưa từng chạy với thư mục dữ liệu này).');
  const db = openDatabase(getDatabasePath());
  try {
    const manifest = await createBackup(db, { dataDir, outDir });
    const check = verifyBackup(outDir);
    if (!check.ok) throw new Error(`Bản sao lưu vừa tạo không qua kiểm tra: ${check.problems.join(' | ')}`);
    log.info(`Đã sao lưu: ${outDir}`);
    log.info(`DB ${manifest.db.bytes} byte, ${manifest.media.length} ảnh, schema v${manifest.schemaVersion}; đã kiểm tra mã băm.`);
    if (manifest.missingMedia.length) log.warn(`${manifest.missingMedia.length} ảnh có trong DB nhưng thiếu file trong kho; bản sao lưu KHÔNG có các ảnh này.`);
    log.info('Bản sao lưu không có hồ sơ trình duyệt và khóa của máy: sau khi phục hồi cần đăng nhập lại các tài khoản.');
  } finally {
    db.close();
  }
} catch (error) {
  log.error(error);
  process.exitCode = 1;
}
