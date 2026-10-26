/**
 * Server cục bộ (Fastify, chỉ 127.0.0.1): API dữ liệu, file và lệnh nghiệp vụ.
 * Không điều khiển Playwright — gửi lệnh cho worker qua DB.
 */
import { getAppEnv, getDatabasePath, getIntegrationMode, getServerPort } from '#config';
import { migrate, openDatabase } from '#storage';
import { buildApp } from './app.ts';

const env = getAppEnv();
const integrations = getIntegrationMode();
const db = openDatabase(getDatabasePath());
migrate(db);

const app = buildApp({ db, env, integrations });

const shutdown = async (signal: string) => {
  app.log.info(`Nhận ${signal}, đang dừng server`);
  await app.close();
  db.close();
  process.exit(0);
};
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  // Chỉ loopback: không mở truy cập từ máy khác trong mạng
  await app.listen({ host: '127.0.0.1', port: getServerPort() });
} catch (error) {
  app.log.error(error);
  db.close();
  process.exit(1);
}
