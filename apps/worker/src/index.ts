/**
 * Worker: scheduler, nhận job, quét nhóm, thực hiện đăng.
 * Tiến trình DUY NHẤT được điều khiển Playwright/browser profiles.
 */
import { JOB_STATUSES } from '#domain';
import { getAppEnv } from '#config';

console.log(`[worker] env=${getAppEnv()} jobStatuses=${JOB_STATUSES.length}`);
