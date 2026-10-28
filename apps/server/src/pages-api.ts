import type { FastifyInstance } from 'fastify';
import type { IntegrationMode } from '#domain';
import { createPageRepository, createPostBatchService, createSecretStore, type Database, type PagePostInput } from '#storage';

const UUID = '^[a-fA-F0-9]{8}-(?:[a-fA-F0-9]{4}-){3}[a-fA-F0-9]{12}$';
const uuid = { type: 'string', pattern: UUID } as const;
const idParams = { type: 'object', additionalProperties: false, required: ['id'], properties: { id: uuid } } as const;
const epochMs = { type: 'integer', minimum: 0, maximum: 8_640_000_000_000_000 } as const;

/**
 * Fanpage (P09). Chỉ metadata và trạng thái ra ngoài: KHÔNG có route nào trả token Page, App Secret hay nhận chúng qua HTTP. Kết nối Page
 * làm bằng lệnh `npm run page:connect` trên máy. Đăng bài chỉ xếp job vào hàng chờ; worker mới gọi Graph API.
 */
export function installPagesApi(app: FastifyInstance, db: Database, mode: IntegrationMode): void {
  const pages = createPageRepository(db, { secrets: createSecretStore(db) });
  const posts = createPostBatchService(db, { mode });

  app.get('/api/pages', async () => ({ items: pages.list() }));

  // Gỡ Page: thu hồi token và dừng các job phụ thuộc (POST vì client luôn gửi JSON cho thao tác ghi).
  app.post<{ Params: { id: string } }>('/api/pages/:id/disconnect', {
    schema: { params: idParams, body: { type: 'object', additionalProperties: false, properties: {} } },
  }, async (request) => pages.disconnect(request.params.id));

  // Một lần bấm "Bắt đầu" ở trang fanpage: bản caption cho đích Page, duyệt, xếp MỘT job. Chống bấm hai lần theo requestKey.
  app.post<{ Body: PagePostInput }>('/api/page-posts', {
    schema: { body: { type: 'object', additionalProperties: false, required: ['requestKey', 'pageConnectionId', 'productId', 'scheduledAt', 'caption'], properties: {
      requestKey: { type: 'string', minLength: 8, maxLength: 200 }, pageConnectionId: uuid, productId: uuid, scheduledAt: epochMs,
      caption: { type: 'string', minLength: 1, maxLength: 10_000 }, source: { type: 'string', enum: ['template', 'manual'] } } } },
  }, async (request, reply) => {
    const result = posts.submitPage(request.body);
    if (!result.ok) return reply.code(409).send({ error: 'items_not_ready', message: 'Page chưa đủ điều kiện nên chưa xếp job nào.', failures: result.failures });
    return reply.code(result.replayed ? 200 : 201).send({ requestId: result.requestId, replayed: result.replayed, jobs: result.jobs });
  });
}
