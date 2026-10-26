/** Cấu hình runtime cho server/worker: thư mục dữ liệu, môi trường. */
import { join } from 'node:path';

export type AppEnv = 'development' | 'test' | 'production';

export function getAppEnv(): AppEnv {
  const value = process.env.APM_ENV ?? 'development';
  if (value === 'development' || value === 'test' || value === 'production') return value;
  throw new Error(`APM_ENV không hợp lệ: ${value}`);
}

/** Dữ liệu vận hành (DB, media, log, browser profiles) nằm ngoài repo/OneDrive. */
export function getDataDir(): string {
  if (process.env.APM_DATA_DIR) return process.env.APM_DATA_DIR;
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) throw new Error('Không xác định được LOCALAPPDATA; đặt APM_DATA_DIR.');
  return join(localAppData, 'AutoPostMKT');
}

/** Mỗi môi trường một file DB để dữ liệu dev/test không lẫn với vận hành. */
export function getDatabasePath(): string {
  return join(getDataDir(), 'db', `${getAppEnv()}.sqlite`);
}
