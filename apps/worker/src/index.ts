/**
 * Worker: scheduler, nhận job, quét nhóm, thực hiện đăng.
 * Tiến trình DUY NHẤT được điều khiển Playwright/browser profiles.
 * Chưa có scheduler (P07): khởi động worker không tạo hay gửi bài nào.
 */
import { getAppEnv, getIntegrationMode } from '#config';
import { createLogger } from '#logging';
import { createPublishers } from './publishers.ts';

// Even startup/config errors pass through the safe logger.
let log = createLogger({ env: 'production', name: 'worker' });
try {
  const env = getAppEnv();
  log = createLogger({ env, name: 'worker' });
  const mode = getIntegrationMode();
  const publishers = createPublishers(mode);
  const simulated = Object.values(publishers).every((p) => p.capabilities.simulated);
  log.info(
    `[worker] env=${env} integrations=${mode}${simulated ? ' (mô phỏng, không gọi Facebook)' : ''} channels=${Object.keys(publishers).join(',')}`,
  );
  log.info('[worker] Chưa có scheduler (P07): không tự đăng bài.');
} catch (error) {
  log.error(error);
  process.exitCode = 1;
}
