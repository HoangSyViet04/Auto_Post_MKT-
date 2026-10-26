/** Áp dụng migration cho DB của môi trường hiện tại (APM_ENV, APM_DATA_DIR). */
import { getDatabasePath } from '#config';
import { migrate, openDatabase } from '#storage';

const path = getDatabasePath();
const db = openDatabase(path);
try {
  const { applied, currentVersion } = migrate(db);
  console.log(`DB: ${path}`);
  console.log(applied.length ? `Đã áp dụng: ${applied.join(', ')}` : 'Không có migration mới');
  console.log(`Phiên bản hiện tại: ${currentVersion}`);
} finally {
  db.close();
}
