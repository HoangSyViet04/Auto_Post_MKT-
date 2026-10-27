import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import type { AppEnv } from '#config';
import type { ApiError, HealthResponse, IntegrationMode } from '#domain';
import type { Database } from '#storage';
import { createLogger } from '#logging';
import { installLocalAccess, type LocalAccessOptions } from './local-access.ts';

export interface AppDeps {
  db: Database;
  env: AppEnv;
  integrations: IntegrationMode;
  /** false trong test để không in log. */
  logger?: boolean | FastifyBaseLogger;
  /** Explicit loopback ports; tests can use an isolated ephemeral listener. */
  security?: LocalAccessOptions;
}

/** Tạo Fastify app (chưa listen) để server và test dùng chung. */
export function buildApp({ db, env, integrations, logger = true, security }: AppDeps): FastifyInstance {
  const app = Fastify({
    ...(logger === false ? { logger: false } : {
      loggerInstance: logger === true ? createLogger({ env, name: 'server' }) : logger,
    }),
  });
  installLocalAccess(app, env, security);
  const startedAt = new Date().toISOString();
  const schemaVersion = db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations');

  app.get('/api/health', async (): Promise<HealthResponse> => ({
    status: 'ok',
    env,
    schemaVersion: Number(schemaVersion.get()?.v),
    integrations,
    startedAt,
  }));

  app.setNotFoundHandler((_request, reply) => {
    const body: ApiError = { error: 'not_found', message: 'Không có API được yêu cầu.' };
    reply.code(404).send(body);
  });

  return app;
}
