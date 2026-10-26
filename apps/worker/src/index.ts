/**
 * Worker: scheduler, nhận job, quét nhóm, thực hiện đăng.
 * Tiến trình DUY NHẤT được điều khiển Playwright/browser profiles.
 * Chưa có scheduler (P07): khởi động worker không tạo hay gửi bài nào.
 */
import { getAppEnv, getIntegrationMode } from '#config';
import { createPublishers } from './publishers.ts';

const mode = getIntegrationMode();
const publishers = createPublishers(mode);
const simulated = Object.values(publishers).every((p) => p.capabilities.simulated);

console.log(
  `[worker] env=${getAppEnv()} integrations=${mode}${simulated ? ' (mô phỏng, không gọi Facebook)' : ''} channels=${Object.keys(publishers).join(',')}`,
);
console.log('[worker] Chưa có scheduler (P07): không tự đăng bài.');
