/** Kiểu request/response của API cục bộ, dùng chung giữa server và web. */

export type AppEnvName = 'development' | 'test' | 'production';

export interface HealthResponse {
  status: 'ok';
  env: AppEnvName;
  schemaVersion: number;
  startedAt: string;
}

export interface ApiError {
  error: string;
  message: string;
}
