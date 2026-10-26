/** Cấu hình runtime cho server/worker: thư mục dữ liệu, môi trường, chế độ tích hợp. */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IntegrationMode } from '#domain';

export type AppEnv = 'development' | 'test' | 'production';

export function getAppEnv(): AppEnv {
  const value = process.env.APM_ENV || 'development';
  if (value === 'development' || value === 'test' || value === 'production') return value;
  throw new Error(`APM_ENV không hợp lệ: ${value}`);
}

/**
 * Dữ liệu vận hành (DB, media, log, browser profiles) nằm ngoài repo.
 * APM_ENV=test không có APM_DATA_DIR thì dùng thư mục tạm để không đụng dữ liệu thật.
 */
export function getDataDir(): string {
  if (process.env.APM_DATA_DIR) return process.env.APM_DATA_DIR;
  if (getAppEnv() === 'test') return join(tmpdir(), 'AutoPostMKT-test');
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) throw new Error('Không xác định được LOCALAPPDATA; đặt APM_DATA_DIR.');
  return join(localAppData, 'AutoPostMKT');
}

export const DEFAULT_SERVER_PORT = 4317;

/** Cổng server cục bộ (APM_SERVER_PORT); web dev proxy dùng cùng giá trị. */
export function getServerPort(): number {
  const raw = process.env.APM_SERVER_PORT;
  if (!raw) return DEFAULT_SERVER_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`APM_SERVER_PORT không hợp lệ: ${raw}`);
  return port;
}

/** Mỗi môi trường một file DB để dữ liệu dev/test không lẫn với vận hành. */
export function getDatabasePath(): string {
  return join(getDataDir(), 'db', `${getAppEnv()}.sqlite`);
}

/**
 * Chế độ adapter (APM_INTEGRATIONS). Mặc định fake ở mọi môi trường: mở app không bao giờ tự gọi Facebook.
 * live phải bật rõ ràng và bị cấm trong test.
 */
export function getIntegrationMode(): IntegrationMode {
  const value = process.env.APM_INTEGRATIONS || 'fake';
  if (value !== 'fake' && value !== 'live') throw new Error(`APM_INTEGRATIONS không hợp lệ: ${value}`);
  if (value === 'live' && getAppEnv() === 'test') throw new Error('APM_INTEGRATIONS=live bị cấm khi APM_ENV=test');
  return value;
}
