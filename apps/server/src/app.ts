import Fastify, { type FastifyInstance } from 'fastify';
import type { AppEnv } from '#config';
import type { ApiError, HealthResponse } from '#domain';
import type { Database } from '#storage';

export interface AppDeps {
  db: Database;
  env: AppEnv;
  /** false trong test để không in log. */
  logger?: boolean;
}

/** Tạo Fastify app (chưa listen) để server và test dùng chung. */
export function buildApp({ db, env, logger = true }: AppDeps): FastifyInstance {
  const app = Fastify({
    logger: logger && {
      level: env === 'production' ? 'info' : 'debug',
      // Không để header nhạy cảm lọt vào log
      redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-apm-token"]'],
    },
  });
  const startedAt = new Date().toISOString();
  const schemaVersion = db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations');

  app.get('/api/health', async (): Promise<HealthResponse> => ({
    status: 'ok',
    env,
    schemaVersion: Number(schemaVersion.get()?.v),
    startedAt,
  }));

  app.setNotFoundHandler((request, reply) => {
    const body: ApiError = { error: 'not_found', message: `Không có API ${request.method} ${request.url}` };
    reply.code(404).send(body);
  });

  return app;
}
