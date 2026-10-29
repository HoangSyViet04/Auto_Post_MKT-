import type { FastifyInstance } from 'fastify';
import { BusinessError, type GroupJoinSettings, type IntegrationMode, JOIN_BATCH_MAX, JOIN_DAILY_CAP_MAX, SEARCH_KEYWORD_MAX, SEARCH_LIMIT_MAX } from '#domain';
import { createGroupJoinRepository, createGroupSearchRepository, type Database, readWorkerStatus } from '#storage';

const UUID = '^[a-fA-F0-9]{8}-(?:[a-fA-F0-9]{4}-){3}[a-fA-F0-9]{12}$';
const uuid = { type: 'string', pattern: UUID } as const;
const idParams = { type: 'object', additionalProperties: false, required: ['id'], properties: { id: uuid } } as const;
const accountParams = { type: 'object', additionalProperties: false, required: ['accountId'], properties: { accountId: uuid } } as const;

/**
 * Tìm nhóm theo từ khóa và gửi yêu cầu tham gia (P06.3). Server chỉ ghi yêu cầu vào DB; worker giữ khóa hồ sơ và điều khiển Facebook.
 * Tìm là chỉ đọc. Gửi yêu cầu tham gia là hành động thật trên Facebook nên cần chế độ THẬT, worker có trình duyệt và xác nhận rõ trong yêu cầu;
 * mọi yêu cầu bị giới hạn số lượng theo tài khoản trong 24 giờ.
 */
export function installGroupDiscoveryApi(app: FastifyInstance, db: Database, mode: IntegrationMode = 'fake'): void {
  const searches = createGroupSearchRepository(db);
  const joins = createGroupJoinRepository(db);
  function requireBrowser(): void {
    if (mode !== 'live') throw new BusinessError('mode_mismatch');
    const worker = readWorkerStatus(db);
    if (!worker.alive || worker.browser !== 'real') throw new BusinessError('worker_unavailable');
  }

  app.get<{ Params: { accountId: string } }>('/api/accounts/:accountId/group-search', { schema: { params: accountParams } },
    async (request) => ({ scan: searches.latest(request.params.accountId), results: searches.results(request.params.accountId) }));
  app.post<{ Params: { accountId: string }; Body: { keyword: string; limit: number } }>('/api/accounts/:accountId/group-search', {
    schema: { params: accountParams, body: { type: 'object', additionalProperties: false, required: ['keyword', 'limit'], properties: {
      keyword: { type: 'string', minLength: 2, maxLength: SEARCH_KEYWORD_MAX }, limit: { type: 'integer', minimum: 1, maximum: SEARCH_LIMIT_MAX },
    } } },
  }, async (request, reply) => {
    requireBrowser();
    return reply.code(202).send(searches.enqueue(request.params.accountId, request.body.keyword, request.body.limit));
  });
  app.post<{ Params: { id: string } }>('/api/group-searches/:id/cancel', {
    schema: { params: idParams, body: { type: 'object', additionalProperties: false, properties: {} } },
  }, async (request, reply) => { searches.cancel(request.params.id); return reply.code(204).send(); });

  app.get('/api/group-join-settings', async () => ({ settings: joins.settings() }));
  app.put<{ Body: GroupJoinSettings }>('/api/group-join-settings', {
    schema: { body: { type: 'object', additionalProperties: false, required: ['dailyCap', 'minGapSeconds', 'maxGapSeconds'], properties: {
      dailyCap: { type: 'integer', minimum: 1, maximum: JOIN_DAILY_CAP_MAX }, minGapSeconds: { type: 'integer', minimum: 60, maximum: 3600 },
      maxGapSeconds: { type: 'integer', minimum: 60, maximum: 7200 },
    } } },
  }, async (request) => ({ settings: joins.saveSettings(request.body) }));

  app.get<{ Params: { accountId: string } }>('/api/accounts/:accountId/group-joins', { schema: { params: accountParams } },
    async (request) => ({ requests: joins.list(request.params.accountId), quota: joins.quota(request.params.accountId), settings: joins.settings() }));
  app.post<{ Params: { accountId: string }; Body: { searchResultIds: string[]; maxCount: number; confirmReal: boolean } }>('/api/accounts/:accountId/group-joins', {
    schema: { params: accountParams, body: { type: 'object', additionalProperties: false, required: ['searchResultIds', 'maxCount', 'confirmReal'], properties: {
      searchResultIds: { type: 'array', minItems: 1, maxItems: JOIN_BATCH_MAX, items: uuid },
      maxCount: { type: 'integer', minimum: 1, maximum: JOIN_BATCH_MAX },
      confirmReal: { type: 'boolean' },
    } } },
  }, async (request, reply) => {
    if (request.body.confirmReal !== true) throw new BusinessError('invalid_input'); // phải xác nhận rõ đây là thao tác thật
    requireBrowser();
    return reply.code(202).send(joins.enqueue({ accountId: request.params.accountId, searchResultIds: request.body.searchResultIds, maxCount: request.body.maxCount }));
  });
  app.post<{ Params: { id: string } }>('/api/group-joins/:id/cancel', {
    schema: { params: idParams, body: { type: 'object', additionalProperties: false, properties: {} } },
  }, async (request, reply) => { joins.cancel(request.params.id); return reply.code(204).send(); });
  app.post<{ Params: { accountId: string } }>('/api/accounts/:accountId/group-joins/cancel-queued', {
    schema: { params: accountParams, body: { type: 'object', additionalProperties: false, properties: {} } },
  }, async (request) => ({ cancelled: joins.cancelQueued(request.params.accountId) }));
}
