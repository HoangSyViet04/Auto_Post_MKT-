/**
 * Server cục bộ (Fastify, chỉ 127.0.0.1): API dữ liệu, file và lệnh nghiệp vụ.
 * Không điều khiển Playwright — gửi lệnh cho worker qua DB.
 */
import { fileURLToPath } from 'node:url';
import { getAppEnv, getDatabasePath, getIntegrationMode, getOverdueAfterMs, getServerPort, getServeWeb } from '#config';
import { migrate, openDatabase } from '#storage';
import { createLogger } from '#logging';
import { watchParent } from '#ops';
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
    // Giao diện đã build nằm cạnh mã nguồn (không đường dẫn cứng): <gốc dự án>/apps/web/dist.
    const webDistDir = getServeWeb() ? fileURLToPath(new URL('../../web/dist', import.meta.url)) : undefined;
    const app = buildApp({ db, env, integrations, overdueAfterMs: getOverdueAfterMs(), logger: log, security: { serverPort: port }, ...(webDistDir ? { webDistDir } : {}) });

    const shutdown = async (signal: string) => {
      app.log.info(`Nhận ${signal}, đang dừng server`);
      await app.close();
      db.close();
      process.exit(0);
    };
    process.once('SIGINT', () => void shutdown('SIGINT'));
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
    watchParent(process.env, () => void shutdown('mất launcher')); // launcher chết đột ngột thì server tự dừng

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
