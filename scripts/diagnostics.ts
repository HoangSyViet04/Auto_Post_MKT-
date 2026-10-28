/**
 * In báo cáo chẩn đoán (JSON, đã lọc bí mật) của môi trường hiện tại để gửi khi cần hỗ trợ: npm run diagnostics
 * Với --purge-captures: xóa toàn bộ ảnh chụp màn hình chẩn đoán đang lưu (ảnh có thể chứa thông tin cá nhân) rồi thoát.
 */
import { join } from 'node:path';
import { createDiagnosticCapture } from '#browser';
import { getDataDir, getDatabasePath, getDiagnosticCapture } from '#config';
import { buildDiagnostics, migrate, openDatabase } from '#storage';

const dataDir = getDataDir();
if (process.argv.includes('--purge-captures')) {
  const removed = createDiagnosticCapture({ dir: join(dataDir, 'diagnostics'), retentionMs: getDiagnosticCapture().retentionMs }).purgeAll();
  process.stdout.write(`Đã xóa ${removed} ảnh chụp chẩn đoán.\n`);
} else {
  const db = openDatabase(getDatabasePath());
  try {
    migrate(db);
    process.stdout.write(`${JSON.stringify(buildDiagnostics(db, { dataDir }), null, 2)}\n`);
  } finally {
    db.close();
  }
}
