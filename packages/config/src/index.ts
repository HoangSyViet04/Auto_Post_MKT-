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

function nonNegativeInt(name: string, fallback: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > max) throw new Error(`${name} không hợp lệ: ${raw}`);
  return value;
}

/** Giãn cách tối thiểu giữa hai lần đăng của CÙNG một tài khoản (APM_MIN_GAP_SECONDS, mặc định 60). Chính sách vận hành, không phải ngưỡng chống khóa nick. */
export function getMinGapMs(): number {
  return nonNegativeInt('APM_MIN_GAP_SECONDS', 60, 86_400) * 1_000;
}

/** Job hẹn trễ quá ngưỡng này (APM_OVERDUE_MINUTES, mặc định 15) không tự chạy; người dùng chọn tiếp tục hoặc bỏ. */
export function getOverdueAfterMs(): number {
  return nonNegativeInt('APM_OVERDUE_MINUTES', 15, 10_080) * 60_000;
}

/** Đối tượng bắt buộc cho bài trên trang cá nhân (APM_PROFILE_AUDIENCE, ví dụ "Công khai"); không đặt thì chỉ ghi lại, không kiểm tra. */
export function getProfileAudience(): string | undefined {
  const value = process.env.APM_PROFILE_AUDIENCE?.trim();
  if (value && (value.length < 3 || value.length > 60)) throw new Error('APM_PROFILE_AUDIENCE không hợp lệ');
  return value || undefined;
}

/**
 * Điều khiển trình duyệt thật của worker (APM_BROWSER): off (mặc định) hoặc real. Khác APM_INTEGRATIONS: real chỉ cho phép worker
 * mở trình duyệt để người dùng đăng nhập/kiểm tra phiên khi họ bấm nút; không tự đăng bài. Bị cấm khi APM_ENV=test.
 */
export function getBrowserMode(): 'off' | 'real' {
  const value = process.env.APM_BROWSER || 'off';
  if (value !== 'off' && value !== 'real') throw new Error(`APM_BROWSER không hợp lệ: ${value}`);
  if (value === 'real' && getAppEnv() === 'test') throw new Error('APM_BROWSER=real bị cấm khi APM_ENV=test');
  return value;
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

export interface DiagnosticCaptureConfig {
  /** Chỉ true khi APM_DIAG_CAPTURE=on được đặt rõ ràng. */
  enabled: boolean;
  /** Ảnh chụp quá hạn này bị xóa tự động (APM_DIAG_RETENTION_HOURS, mặc định 24, tối đa 168). */
  retentionMs: number;
}

/**
 * Ảnh chụp màn hình chẩn đoán khi đăng bài lỗi. TẮT mặc định vì ảnh có thể chứa thông tin cá nhân (tên, tin nhắn, bài viết trên màn hình
 * Facebook). Phải bật rõ bằng APM_DIAG_CAPTURE=on; luôn có hạn lưu và tự xóa khi quá hạn. Không bao giờ ghi trace (trace chứa cả cookie/header).
 */
export function getDiagnosticCapture(): DiagnosticCaptureConfig {
  const value = (process.env.APM_DIAG_CAPTURE ?? '').trim().toLowerCase();
  if (value !== '' && value !== 'off' && value !== 'on') throw new Error(`APM_DIAG_CAPTURE không hợp lệ: ${value} (chỉ nhận "on" hoặc "off")`);
  const hours = nonNegativeInt('APM_DIAG_RETENTION_HOURS', 24, 168);
  if (hours < 1) throw new Error('APM_DIAG_RETENTION_HOURS phải từ 1 đến 168');
  return { enabled: value === 'on', retentionMs: hours * 3_600_000 };
}
