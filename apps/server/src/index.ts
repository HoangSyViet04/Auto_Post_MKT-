/**
 * Server cục bộ (Fastify, chỉ 127.0.0.1): API dữ liệu, file và lệnh nghiệp vụ.
 * Không điều khiển Playwright — gửi lệnh cho worker qua DB.
 */
import { getAppEnv, getDatabasePath, getIntegrationMode, getServerPort } from '#config';
import { migrate, openDatabase } from '#storage';
import { createLogger } from '#logging';
import { buildApp } from './app.ts';

let log = createLogger({ env: 'production', name: 'server' });
async function main() {
  const env = getAppEnv();
  log = createLogger({ env, name: 'server' });
  const integrations = getIntegrationMode();
  const db = openDatabase(getDatabasePath());
  try {
    migrate(db);
    const port = getServerPort();
    const app = buildApp({ db, env, integrations, logger: log, security: { serverPort: port } });

    const shutdown = async (signal: string) => {
      app.log.info(`Nhận ${signal}, đang dừng server`);
      await app.close();
      db.close();
      process.exit(0);
    };
    process.once('SIGINT', () => void shutdown('SIGINT'));
    process.once('SIGTERM', () => void shutdown('SIGTERM'));

    // Chỉ loopback: không mở truy cập từ máy khác trong mạng
    await app.listen({ host: '127.0.0.1', port });
  } catch (error) {
    db.close();
    throw error;
  }
}

try {
  await main();
} catch (error) {
  log.error(error);
  process.exitCode = 1;
}
