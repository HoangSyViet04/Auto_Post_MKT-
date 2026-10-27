import type { FastifyInstance } from 'fastify';
import { createAccountRepository, type Database, MAX_ACTIVE_ACCOUNTS } from '#storage';

const UUID = '^[a-fA-F0-9]{8}-(?:[a-fA-F0-9]{4}-){3}[a-fA-F0-9]{12}$';
const idParams = { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string', pattern: UUID } } } as const;
const labelBody = { type: 'object', additionalProperties: false, required: ['label'],
  properties: { label: { type: 'string', minLength: 1, maxLength: 100 } } } as const;
const pausedBody = { type: 'object', additionalProperties: false, required: ['paused'], properties: { paused: { type: 'boolean' } } } as const;
const emptyBody = { type: 'object', additionalProperties: false, properties: {} } as const;

/** Quản lý tài khoản (P03.1–P03.2, P03.6). Chưa mở trình duyệt hay đăng nhập: chỉ dữ liệu cục bộ. */
export function installAccountsApi(app: FastifyInstance, db: Database): void {
  const accounts = createAccountRepository(db);

  app.get('/api/accounts', async () => ({ items: accounts.list(), limit: MAX_ACTIVE_ACCOUNTS }));

  app.post<{ Body: { label: string } }>('/api/accounts', { schema: { body: labelBody } },
    async (request, reply) => reply.code(201).send(accounts.create(request.body)));

  app.put<{ Params: { id: string }; Body: { label: string } }>('/api/accounts/:id', { schema: { params: idParams, body: labelBody } },
    async (request) => accounts.rename(request.params.id, request.body.label));

  app.post<{ Params: { id: string }; Body: { paused: boolean } }>('/api/accounts/:id/pause', { schema: { params: idParams, body: pausedBody } },
    async (request) => accounts.setPaused(request.params.id, request.body.paused));

  app.post<{ Body: { paused: boolean } }>('/api/accounts/pause-all', { schema: { body: pausedBody } },
    async (request) => ({ items: accounts.setAllPaused(request.body.paused), limit: MAX_ACTIVE_ACCOUNTS }));

  app.post<{ Params: { id: string } }>('/api/accounts/:id/remove', { schema: { params: idParams, body: emptyBody } },
    async (request, reply) => {
      accounts.remove(request.params.id);
      return reply.code(204).send();
    });
}
