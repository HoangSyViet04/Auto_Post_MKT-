/** Áp dụng migration cho DB của môi trường hiện tại (APM_ENV, APM_DATA_DIR). */
import { getAppEnv, getDatabasePath } from '#config';
import { createLogger } from '#logging';
import { migrate, openDatabase } from '#storage';

let log = createLogger({ env: 'production', name: 'db-migrate' });
try {
  const path = getDatabasePath();
  log = createLogger({ env: getAppEnv(), name: 'db-migrate' });
  const db = openDatabase(path);
  try {
    const { applied, currentVersion } = migrate(db);
    log.info(`DB: ${path}`);
    log.info(applied.length ? `Đã áp dụng: ${applied.join(', ')}` : 'Không có migration mới');
    log.info(`Phiên bản hiện tại: ${currentVersion}`);
  } finally {
    db.close();
  }
} catch (error) {
  log.error(error);
  process.exitCode = 1;
}
