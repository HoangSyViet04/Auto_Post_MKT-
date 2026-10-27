import type { FastifyInstance } from 'fastify';
import { BusinessError, type BrowserCommandKind } from '#domain';
import { createAccountRepository, createBrowserCommandRepository, type Database, MAX_ACTIVE_ACCOUNTS, readWorkerStatus } from '#storage';

const UUID = '^[a-fA-F0-9]{8}-(?:[a-fA-F0-9]{4}-){3}[a-fA-F0-9]{12}$';
const idParams = { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string', pattern: UUID } } } as const;
const labelBody = { type: 'object', additionalProperties: false, required: ['label'],
  properties: { label: { type: 'string', minLength: 1, maxLength: 100 } } } as const;
const pausedBody = { type: 'object', additionalProperties: false, required: ['paused'], properties: { paused: { type: 'boolean' } } } as const;
const emptyBody = { type: 'object', additionalProperties: false, properties: {} } as const;

/** Quản lý tài khoản (P03.1–P03.2, P03.6). Chưa mở trình duyệt hay đăng nhập: chỉ dữ liệu cục bộ. */
export function installAccountsApi(app: FastifyInstance, db: Database): void {
  const accounts = createAccountRepository(db);
  const browserCommands = createBrowserCommandRepository(db);

  app.get('/api/accounts', async () => ({ items: accounts.list(), limit: MAX_ACTIVE_ACCOUNTS }));

  app.post<{ Body: { label: string } }>('/api/accounts', { schema: { body: labelBody } },
    async (request, reply) => reply.code(201).send(accounts.create(request.body)));

  app.put<{ Params: { id: string }; Body: { label: string } }>('/api/accounts/:id', { schema: { params: idParams, body: labelBody } },
    async (request) => accounts.rename(request.params.id, request.body.label));

  app.post<{ Params: { id: string }; Body: { paused: boolean } }>('/api/accounts/:id/pause', { schema: { params: idParams, body: pausedBody } },
    async (request) => accounts.setPaused(request.params.id, request.body.paused));

  app.post<{ Body: { paused: boolean } }>('/api/accounts/pause-all', { schema: { body: pausedBody } },
    async (request) => ({ items: accounts.setAllPaused(request.body.paused), limit: MAX_ACTIVE_ACCOUNTS }));

  // Đăng nhập tay / kiểm tra phiên: server chỉ ghi lệnh, worker mở trình duyệt. Từ chối rõ ràng nếu worker không chạy
  // hoặc chưa bật APM_BROWSER=real, để lệnh không nằm chờ vô hạn.
  app.post<{ Params: { id: string }; Body: { kind: BrowserCommandKind } }>('/api/accounts/:id/browser', {
    schema: { params: idParams, body: { type: 'object', additionalProperties: false, required: ['kind'], properties: { kind: { type: 'string', enum: ['login', 'verify'] } } } },
  }, async (request, reply) => {
    const worker = readWorkerStatus(db);
    if (!worker.alive || worker.browser !== 'real') throw new BusinessError('worker_unavailable');
    accounts.get(request.params.id); // 404 nếu không có/đã gỡ
    return reply.code(202).send(browserCommands.enqueue(request.params.id, request.body.kind));
  });

  app.post<{ Params: { id: string } }>('/api/browser-commands/:id/cancel', { schema: { params: idParams, body: emptyBody } },
    async (request) => ({ state: browserCommands.requestCancel(request.params.id) }));

  app.post<{ Params: { id: string } }>('/api/accounts/:id/remove', { schema: { params: idParams, body: emptyBody } },
    async (request, reply) => {
      accounts.remove(request.params.id);
      return reply.code(204).send();
    });
}
