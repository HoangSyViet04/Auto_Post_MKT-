/**
 * Server cục bộ (Fastify, chỉ 127.0.0.1): API dữ liệu, file và lệnh nghiệp vụ.
 * Không điều khiển Playwright — gửi lệnh cho worker qua DB.
 */
import { JOB_STATUSES } from '#domain';
import { getAppEnv, getDataDir } from '#config';

console.log(`[server] env=${getAppEnv()} dataDir=${getDataDir()} jobStatuses=${JOB_STATUSES.length}`);
