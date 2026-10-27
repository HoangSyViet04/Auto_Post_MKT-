import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import type { AppEnv } from '#config';
import { BusinessError, type ApiError, type HealthResponse, type IntegrationMode } from '#domain';
import { createMediaStore, type Database, readWorkerStatus } from '#storage';
import { createLogger } from '#logging';
import { installLocalAccess, type LocalAccessOptions } from './local-access.ts';
import { installAccountsApi } from './accounts-api.ts';
import { installDataApi } from './data-api.ts';
import { installGroupsApi } from './groups-api.ts';
import { installJobsApi } from './jobs-api.ts';

export interface AppDeps {
  db: Database;
  env: AppEnv;
  integrations: IntegrationMode;
  /** false trong test để không in log. */
  logger?: boolean | FastifyBaseLogger;
  /** Explicit loopback ports; tests can use an isolated ephemeral listener. */
  security?: LocalAccessOptions;
  mediaStore?: ReturnType<typeof createMediaStore>;
  uploadLimitBytes?: number;
  /** Ngưỡng job hẹn trễ không tự chạy (hiển thị "quá hạn"); mặc định 15 phút, khớp cấu hình worker. */
  overdueAfterMs?: number;
}

/** Tạo Fastify app (chưa listen) để server và test dùng chung. */
export function buildApp({ db, env, integrations, logger = true, security, mediaStore, uploadLimitBytes, overdueAfterMs = 15 * 60_000 }: AppDeps): FastifyInstance {
  const app = Fastify({
    ajv: { customOptions: { removeAdditional: false } },
    ...(logger === false ? { logger: false } : {
      loggerInstance: logger === true ? createLogger({ env, name: 'server' }) : logger,
    }),
  });
  installLocalAccess(app, env, security);
  installDataApi(app, db, mediaStore ?? createMediaStore(db), uploadLimitBytes);
  installAccountsApi(app, db);
  installGroupsApi(app, db);
  installJobsApi(app, db, integrations, overdueAfterMs);
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof BusinessError) {
      const status = error.code === 'not_found' ? 404 : error.code === 'invalid_input' ? 400
        : error.code === 'media_too_large' ? 413 : error.code === 'media_invalid' ? 422
        : error.code === 'media_io' || error.code === 'secret_unavailable' || error.code === 'worker_unavailable' ? 503 : 409;
      return reply.code(status).send({ error: error.code, message: error.message });
    }
    const details = (typeof error === 'object' && error !== null ? error : {}) as { statusCode?: number; validation?: unknown };
    if (details.statusCode === 413) return reply.code(413).send({ error: 'payload_too_large', message: 'Dữ liệu vượt giới hạn cho phép.' });
    if (details.validation || details.statusCode === 400) {
      return reply.code(400).send({ error: 'invalid_input', message: new BusinessError('invalid_input').message });
    }
    request.log.error({ code: 'internal_error' }, 'API xử lý không thành công');
    return reply.code(500).send({ error: 'internal_error', message: 'Không thể xử lý yêu cầu.' });
  });
  const startedAt = new Date().toISOString();
  const schemaVersion = db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations');

  app.get('/api/health', async (): Promise<HealthResponse> => ({
    status: 'ok',
    env,
    schemaVersion: Number(schemaVersion.get()?.v),
    integrations,
    worker: readWorkerStatus(db),
    startedAt,
  }));

  app.setNotFoundHandler((_request, reply) => {
    const body: ApiError = { error: 'not_found', message: 'Không có API được yêu cầu.' };
    reply.code(404).send(body);
  });

  return app;
}
