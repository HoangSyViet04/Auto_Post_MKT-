import { createHash, randomUUID } from 'node:crypto';
import { BusinessError, type BusinessErrorCode, type IntegrationMode, parsePostingInterval, type PostingInterval } from '#domain';
import { createAccountRepository } from './account-repository.ts';
import { createContentRepository } from './content-repository.ts';
import type { Database } from './db.ts';
import { createJobRepository } from './job-repository.ts';
import { atomic, identifier, objectInput, one, type RepositoryOptions, text, timestamp } from './repository-common.ts';

export interface PostBatchInput {
  postingInterval?: PostingInterval;
  /** Mã yêu cầu do giao diện tạo cho MỖI lần bấm gửi; cùng mã + cùng nội dung → trả lại kết quả cũ, không tạo job mới. */
  requestKey: string;
  accountId: string;
  productId: string;
  /** Giờ bắt đầu (epoch ms UTC). Các job của cùng tài khoản vẫn được worker giãn cách theo chính sách. */
  scheduledAt: number;
  items: ReadonlyArray<{ destinationId: string; caption: string; source?: 'template' | 'manual' }>;
}

export interface PagePostInput {
  /** Mã yêu cầu cho MỖI lần bấm gửi (chống bấm hai lần). */
  requestKey: string;
  /** Kết nối Page (không phải tài khoản trình duyệt). */
  pageConnectionId: string;
  productId: string;
  scheduledAt: number;
  caption: string;
  source?: 'template' | 'manual';
}

export type PostBatchResult =
  | { ok: true; requestId: string; replayed: boolean; jobs: Array<{ jobId: string; destinationId: string }> }
  | { ok: false; failures: Array<{ destinationId: string; code: BusinessErrorCode }> };

const MAX_ITEMS = 100;

/**
 * Tạo bản caption theo từng đích, duyệt và xếp job trong một lần gọi. Tất cả hoặc không gì: nếu một đích không đủ điều kiện thì KHÔNG
 * xếp job nào và trả danh sách đích bị chặn (bản caption/duyệt đã tạo chỉ là nháp, không chạy). Chống bấm hai lần theo \`requestKey\`.
 */
export function createPostBatchService(db: Database, deps: { mode: IntegrationMode } & RepositoryOptions) {
  const clockOptions = deps.clock ? { clock: deps.clock } : {};
  const clock = () => timestamp((deps.clock ?? Date.now)());
  const content = createContentRepository(db, clockOptions);
  const accounts = createAccountRepository(db, clockOptions);
  const jobs = createJobRepository(db, clockOptions);

  /** Gửi lại cùng mã yêu cầu: trả kết quả cũ (kể cả khi lần trước mất phản hồi); nội dung khác thì từ chối. */
  function replay(requestKey: string, fingerprint: string): PostBatchResult | undefined {
    const previous = one<{ payload_fingerprint: string }>(db, "SELECT payload_fingerprint FROM command_requests WHERE scope='post_batch' AND request_key=?", requestKey);
    if (!previous) return undefined;
    if (previous.payload_fingerprint !== fingerprint) throw new BusinessError('idempotency_conflict');
    const request = one<{ id: string }>(db, "SELECT id FROM command_requests WHERE scope='publish' AND request_key=?", requestKey);
    if (!request) throw new BusinessError('conflict');
    const rows = db.prepare(`SELECT j.id AS job_id,a.destination_id FROM publish_jobs j JOIN approvals a ON a.id=j.approval_id
      WHERE j.request_id=? ORDER BY a.destination_id`).all(request.id) as Array<{ job_id: string; destination_id: string }>;
    return { ok: true, requestId: request.id, replayed: true, jobs: rows.map((row) => ({ jobId: row.job_id, destinationId: row.destination_id })) };
  }

  return {
    /**
     * Một bài lên MỘT fanpage (P09.5): bản caption riêng cho đích Page, duyệt theo kết nối Page (không cần tài khoản trình duyệt) và xếp một job.
     * Cùng quy tắc chống bấm hai lần và "tất cả hoặc không gì" như đăng nhóm. Kết nối chưa đủ quyền/token mất thì bị chặn lúc duyệt.
     */
    submitPage(input: PagePostInput): PostBatchResult {
      objectInput(input);
      text(input.requestKey, 200);
      identifier(input.pageConnectionId);
      identifier(input.productId);
      timestamp(input.scheduledAt);
      text(input.caption);
      if (input.source !== undefined && input.source !== 'template' && input.source !== 'manual') throw new BusinessError('invalid_input');
      const source = input.source ?? 'manual';
      const fingerprint = createHash('sha256').update(JSON.stringify({ mode: deps.mode, pageConnectionId: input.pageConnectionId, productId: input.productId,
        scheduledAt: input.scheduledAt, caption: input.caption })).digest('hex');
      const replayed = replay(input.requestKey, fingerprint);
      if (replayed) return replayed;

      const product = content.getProduct(input.productId);
      if (one<{ status: string }>(db, 'SELECT status FROM products WHERE id=?', input.productId)?.status !== 'selling') throw new BusinessError('not_ready');
      const connection = one<{ destination_id: string }>(db, 'SELECT destination_id FROM page_connections WHERE id=? AND archived_at IS NULL', input.pageConnectionId);
      if (!connection) throw new BusinessError('not_found');

      let approvalId: string;
      try {
        const versionId = content.createVersion({ productRevisionId: product.revisionId, destinationId: connection.destination_id, caption: input.caption, mediaIds: product.mediaIds, source });
        approvalId = content.approve({ contentVersionId: versionId, mode: deps.mode, pageConnectionId: input.pageConnectionId });
      } catch (error) {
        if (!(error instanceof BusinessError)) throw error;
        return { ok: false, failures: [{ destinationId: connection.destination_id, code: error.code }] };
      }
      const queued = jobs.enqueue({ requestKey: input.requestKey, mode: deps.mode, jobs: [{ approvalId, scheduledAt: input.scheduledAt }] });
      atomic(db, () => {
        db.prepare("INSERT INTO command_requests(id,scope,request_key,payload_fingerprint,created_at) VALUES(?,'post_batch',?,?,?)")
          .run(randomUUID(), input.requestKey, fingerprint, clock());
      });
      return { ok: true as const, requestId: queued.requestId, replayed: false, jobs: queued.jobs.map((job) => ({ jobId: job.id, destinationId: connection.destination_id })) };
    },

    submit(input: PostBatchInput): PostBatchResult {
      objectInput(input);
      const postingInterval = input.postingInterval === undefined ? undefined : parsePostingInterval(input.postingInterval);
      text(input.requestKey, 200);
      identifier(input.accountId);
      identifier(input.productId);
      timestamp(input.scheduledAt);
      if (!Array.isArray(input.items) || input.items.length === 0 || input.items.length > MAX_ITEMS) throw new BusinessError('invalid_input');
      const items = input.items.map((item) => {
        objectInput(item);
        identifier(item.destinationId);
        text(item.caption);
        if (item.source !== undefined && item.source !== 'template' && item.source !== 'manual') throw new BusinessError('invalid_input');
        return { destinationId: item.destinationId, caption: item.caption, source: item.source ?? 'manual' };
      });
      if (new Set(items.map((item) => item.destinationId)).size !== items.length) throw new BusinessError('invalid_input');
      const fingerprint = createHash('sha256').update(JSON.stringify({ mode: deps.mode, accountId: input.accountId, productId: input.productId,
        scheduledAt: input.scheduledAt, ...(postingInterval ? { postingInterval } : {}), items: [...items].sort((a, b) => a.destinationId.localeCompare(b.destinationId))
          .map(({ destinationId, caption }) => ({ destinationId, caption })) })).digest('hex');

      const replayed = replay(input.requestKey, fingerprint);
      if (replayed) return replayed;

      const product = content.getProduct(input.productId);
      if (one<{ status: string }>(db, 'SELECT status FROM products WHERE id=?', input.productId)?.status !== 'selling') throw new BusinessError('not_ready'); // máy đã bán/ngừng bán không tạo bài mới
      const identityId = accounts.identityId(input.accountId);
      if (!identityId) throw new BusinessError('not_ready'); // chưa đăng nhập/xác nhận danh tính

      const failures: Array<{ destinationId: string; code: BusinessErrorCode }> = [];
      const approved: Array<{ approvalId: string; destinationId: string }> = [];
      for (const item of items) {
        try {
          const versionId = content.createVersion({ productRevisionId: product.revisionId, destinationId: item.destinationId,
            caption: item.caption, mediaIds: product.mediaIds, source: item.source });
          const approvalId = content.approve({ contentVersionId: versionId, mode: deps.mode, accountId: input.accountId, accountIdentityId: identityId });
          approved.push({ approvalId, destinationId: item.destinationId });
        } catch (error) {
          if (!(error instanceof BusinessError)) throw error;
          failures.push({ destinationId: item.destinationId, code: error.code });
        }
      }
      if (failures.length > 0) return { ok: false, failures }; // không xếp job nào khi còn đích bị chặn

      // enqueue tự có giao dịch nên không lồng được. Nếu tiến trình chết giữa hai bước, lần gửi lại cùng mã sẽ bị báo xung đột
      // (idempotency_conflict) chứ không tạo job trùng.
      const queued = jobs.enqueue({ requestKey: input.requestKey, mode: deps.mode, ...(postingInterval ? { postingInterval } : {}), jobs: approved.map((entry) => ({ approvalId: entry.approvalId, scheduledAt: input.scheduledAt })) });
      atomic(db, () => {
        db.prepare("INSERT INTO command_requests(id,scope,request_key,payload_fingerprint,created_at) VALUES(?,'post_batch',?,?,?)")
          .run(randomUUID(), input.requestKey, fingerprint, clock());
      });
      const destinationByApproval = new Map(approved.map((entry) => [entry.approvalId, entry.destinationId]));
      return { ok: true as const, requestId: queued.requestId, replayed: false,
        jobs: queued.jobs.map((job) => ({ jobId: job.id, destinationId: destinationByApproval.get(job.approval_id) ?? '' })) };
    },
  };
}
