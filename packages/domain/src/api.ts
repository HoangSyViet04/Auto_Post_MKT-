/** Kiểu request/response của API cục bộ, dùng chung giữa server và web. */
import type { IntegrationMode } from './channels.ts';

export type AppEnvName = 'development' | 'test' | 'production';

export interface HealthResponse {
  status: 'ok';
  env: AppEnvName;
  schemaVersion: number;
  /** fake: mô phỏng, UI phải hiển thị rõ. */
  integrations: IntegrationMode;
  startedAt: string;
}

export interface ApiError {
  error: string;
  message: string;
}
