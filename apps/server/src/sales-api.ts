import type { FastifyInstance } from 'fastify';
import { createSalesRepository, type Database, type SalesEventInput, type SalesFilter } from '#storage';

const UUID = '^[a-fA-F0-9]{8}-(?:[a-fA-F0-9]{4}-){3}[a-fA-F0-9]{12}$';
const uuid = { type: 'string', pattern: UUID } as const;
const idParams = { type: 'object', additionalProperties: false, required: ['id'], properties: { id: uuid } } as const;
const epochMs = { type: 'integer', minimum: 0, maximum: 8_640_000_000_000_000 } as const;
const kind = { type: 'string', enum: ['inquiry', 'order'] } as const;
const nullableText = (max: number) => ({ anyOf: [{ type: 'string', maxLength: max }, { type: 'null' }] }) as const;

/**
 * Nhật ký khách hỏi và đơn hàng (P11.9). Toàn bộ do người dùng NHẬP TAY; không có route nào đọc tin nhắn, bình luận hay tương tác từ
 * Facebook, và không route nào gửi gì ra ngoài. Dòng nhập nhầm được đánh dấu hủy, không xóa.
 */
export function installSalesApi(app: FastifyInstance, db: Database): void {
  const sales = createSalesRepository(db);

  app.get<{ Querystring: SalesFilter }>('/api/sales-events', {
    schema: { querystring: { type: 'object', additionalProperties: false, properties: {
      kind, productId: uuid, jobId: uuid, from: epochMs, to: epochMs, includeVoided: { type: 'boolean' },
      page: { type: 'integer', minimum: 1, maximum: 1_000_000 }, pageSize: { type: 'integer', minimum: 1, maximum: 100 } } } },
  }, async (request) => sales.list(request.query));

  app.get<{ Querystring: { from?: number; to?: number } }>('/api/sales-events/summary', {
    schema: { querystring: { type: 'object', additionalProperties: false, properties: { from: epochMs, to: epochMs } } },
  }, async (request) => sales.summary(request.query));

  app.post<{ Body: SalesEventInput }>('/api/sales-events', {
    schema: { body: { type: 'object', additionalProperties: false, required: ['kind', 'productId', 'occurredAt'], properties: {
      kind, productId: uuid, jobId: { anyOf: [uuid, { type: 'null' }] }, occurredAt: epochMs,
      customerLabel: nullableText(200), note: nullableText(2000), amountVnd: { anyOf: [{ type: 'integer', minimum: 1, maximum: 100_000_000_000 }, { type: 'null' }] } } } },
  }, async (request, reply) => reply.code(201).send(sales.add(request.body)));

  // POST (không phải DELETE): client luôn gửi JSON cho thao tác ghi. Đây là đánh dấu hủy, không xóa dòng.
  app.post<{ Params: { id: string } }>('/api/sales-events/:id/void', {
    schema: { params: idParams, body: { type: 'object', additionalProperties: false, properties: {} } },
  }, async (request, reply) => {
    sales.voidEvent(request.params.id);
    return reply.code(204).send();
  });
}
