import type { FastifyInstance } from 'fastify';
import { postingIntervalSchema } from './posting-interval-schema.ts';
import { BusinessError, type IntegrationMode, JOB_STATUSES, type JobStatus } from '#domain';
import { createAccountRepository, createContentRepository, createJobQueries, createJobRepository, createPostBatchService, type Database, type PostBatchInput } from '#storage';

const UUID = '^[a-fA-F0-9]{8}-(?:[a-fA-F0-9]{4}-){3}[a-fA-F0-9]{12}$';
const uuid = { type: 'string', pattern: UUID } as const;
const idParams = { type: 'object', additionalProperties: false, required: ['id'], properties: { id: uuid } } as const;
const emptyBody = { type: 'object', additionalProperties: false, properties: {} } as const;
const epochMs = { type: 'integer', minimum: 0, maximum: 8_640_000_000_000_000 } as const;

/**
 * Bản duyệt và hàng chờ đăng (P07). Server chỉ ghi dữ liệu; worker mới nhận và chạy job. Chế độ (fake/live) lấy từ cấu hình server,
 * client không chọn được. Giờ hẹn là epoch mili giây UTC; giao diện hiển thị/lập lịch theo Asia/Ho_Chi_Minh.
 */
export function installJobsApi(app: FastifyInstance, db: Database, mode: IntegrationMode, overdueAfterMs: number): void {
  const accounts = createAccountRepository(db);
  const content = createContentRepository(db);
  const jobs = createJobRepository(db);
  const queries = createJobQueries(db);
  const posts = createPostBatchService(db, { mode });

  app.get<{ Querystring: { status?: JobStatus; accountId?: string; destinationId?: string; productId?: string; from?: number; to?: number; page?: number; pageSize?: number } }>('/api/jobs', {
    schema: { querystring: { type: 'object', additionalProperties: false, properties: {
      status: { type: 'string', enum: [...JOB_STATUSES] }, accountId: uuid, destinationId: uuid, productId: uuid, from: epochMs, to: epochMs,
      page: { type: 'integer', minimum: 1, maximum: 1_000_000 }, pageSize: { type: 'integer', minimum: 1, maximum: 100 },
    } } },
  }, async (request) => queries.list({ ...request.query, overdueAfterMs }));

  // Chi tiết một job: bản đã duyệt, từng lần thử và quan sát có nguồn, nhật ký.
  app.get<{ Params: { id: string } }>('/api/jobs/:id', { schema: { params: idParams } },
    async (request) => queries.detail(request.params.id, overdueAfterMs));

  // Xem trước tác động của việc sửa/bán máy lên các job đã xếp (chỉ đọc).
  app.get<{ Params: { id: string } }>('/api/products/:id/impact', { schema: { params: idParams } },
    async (request) => queries.productImpact(request.params.id));

  // Đối chiếu job unknown / pending_approval bằng xác nhận của người dùng (nguồn luôn là "manual"). Không có đường nào đưa job
  // về hàng chờ để gửi lại: muốn đăng lại phải tạo bài mới.
  app.post<{ Params: { id: string }; Body: { resolution: 'published' | 'pending_approval' | 'not_published'; remoteUrl?: string } }>('/api/jobs/:id/reconcile', {
    schema: { params: idParams, body: { type: 'object', additionalProperties: false, required: ['resolution'], properties: {
      resolution: { type: 'string', enum: ['published', 'pending_approval', 'not_published'] }, remoteUrl: { type: 'string', maxLength: 2000 } } } },
  }, async (request) => ({ status: jobs.reconcile(request.params.id, { resolution: request.body.resolution, source: 'manual',
    ...(request.body.remoteUrl ? { remoteUrl: request.body.remoteUrl } : {}) }).status }));

  // Duyệt đúng một bản caption (đã gắn đích) cho đúng một tài khoản; gắn với danh tính đã xác nhận của tài khoản đó.
  app.post<{ Body: { contentVersionId: string; accountId: string } }>('/api/approvals', {
    schema: { body: { type: 'object', additionalProperties: false, required: ['contentVersionId', 'accountId'],
      properties: { contentVersionId: uuid, accountId: uuid } } },
  }, async (request, reply) => {
    const identityId = accounts.identityId(request.body.accountId);
    if (!identityId) throw new BusinessError('not_ready'); // chưa đăng nhập/xác nhận danh tính
    const approvalId = content.approve({ contentVersionId: request.body.contentVersionId, mode, accountId: request.body.accountId, accountIdentityId: identityId });
    return reply.code(201).send({ approvalId });
  });

  // Mỗi mục = một đích = một job/kết quả riêng. requestKey chống bấm gửi hai lần: cùng khóa + cùng nội dung → trả lại kết quả cũ.
  app.post<{ Body: { requestKey: string; jobs: Array<{ approvalId: string; scheduledAt: number }> } }>('/api/jobs', {
    schema: { body: { type: 'object', additionalProperties: false, required: ['requestKey', 'jobs'], properties: {
      requestKey: { type: 'string', minLength: 8, maxLength: 200 },
      jobs: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object', additionalProperties: false, required: ['approvalId', 'scheduledAt'],
        properties: { approvalId: uuid, scheduledAt: epochMs } } },
    } } },
  }, async (request, reply) => {
    const result = jobs.enqueue({ requestKey: request.body.requestKey, mode, jobs: request.body.jobs });
    return reply.code(result.replayed ? 200 : 201).send({ requestId: result.requestId, replayed: result.replayed, jobIds: result.jobs.map((job) => job.id) });
  });

  // Một lần bấm "Bắt đầu" của trang đăng: tạo bản caption theo từng đích, duyệt và xếp job. Tất cả hoặc không gì; bị chặn thì
  // trả 409 kèm danh sách đích bị chặn để người dùng bỏ chọn. Chống bấm hai lần theo requestKey.
  app.post<{ Body: PostBatchInput }>('/api/posts', {
    schema: { body: { type: 'object', additionalProperties: false, required: ['requestKey', 'accountId', 'productId', 'scheduledAt', 'items'], properties: {
      requestKey: { type: 'string', minLength: 8, maxLength: 200 }, accountId: uuid, productId: uuid, scheduledAt: epochMs, postingInterval: postingIntervalSchema,
      items: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object', additionalProperties: false, required: ['destinationId', 'caption'], properties: {
        destinationId: uuid, caption: { type: 'string', minLength: 1, maxLength: 10_000 }, source: { type: 'string', enum: ['template', 'manual'] } } } },
    } } },
  }, async (request, reply) => {
    const result = posts.submit(request.body);
    if (!result.ok) {
      return reply.code(409).send({ error: 'items_not_ready', message: 'Một số đích chưa đủ điều kiện nên chưa xếp job nào.', failures: result.failures });
    }
    return reply.code(result.replayed ? 200 : 201).send({ requestId: result.requestId, replayed: result.replayed, jobs: result.jobs });
  });

  const state = (path: string, expected: JobStatus[], next: 'queued' | 'paused' | 'cancelled') =>
    app.post<{ Params: { id: string } }>(path, { schema: { params: idParams, body: emptyBody } }, async (request) => {
      const current = jobs.get(request.params.id);
      if (!expected.includes(current.status)) throw new BusinessError('invalid_transition');
      return { status: jobs.changeState(request.params.id, current.status, next).status };
    });
  state('/api/jobs/:id/pause', ['queued'], 'paused');
  state('/api/jobs/:id/resume', ['paused', 'blocked'], 'queued');
  state('/api/jobs/:id/cancel', ['queued', 'paused', 'blocked', 'needs_review'], 'cancelled'); // chỉ khi chưa gửi

  // Đang gửi: chỉ ghi yêu cầu dừng, kết quả thực tế vẫn được ghi (không giả như đã hủy nếu Facebook đã nhận).
  app.post<{ Params: { id: string } }>('/api/jobs/:id/stop', { schema: { params: idParams, body: emptyBody } }, async (request, reply) => {
    jobs.requestStop(request.params.id);
    return reply.code(202).send({ state: 'stop_requested' });
  });

  // "Chạy ngay" / "tiếp tục job quá hạn" / đổi giờ hẹn: chỉ job chưa gửi.
  app.post<{ Params: { id: string }; Body: { scheduledAt: number } }>('/api/jobs/:id/reschedule', {
    schema: { params: idParams, body: { type: 'object', additionalProperties: false, required: ['scheduledAt'], properties: { scheduledAt: epochMs } } },
  }, async (request) => ({ scheduledAt: jobs.reschedule(request.params.id, request.body.scheduledAt).scheduled_at }));
}
