/** In báo cáo chẩn đoán (JSON, đã lọc bí mật) của môi trường hiện tại để gửi khi cần hỗ trợ: npm run diagnostics */
import { getDataDir, getDatabasePath } from '#config';
import { buildDiagnostics, migrate, openDatabase } from '#storage';

const db = openDatabase(getDatabasePath());
try {
  migrate(db);
  process.stdout.write(`${JSON.stringify(buildDiagnostics(db, { dataDir: getDataDir() }), null, 2)}\n`);
} finally {
  db.close();
}
