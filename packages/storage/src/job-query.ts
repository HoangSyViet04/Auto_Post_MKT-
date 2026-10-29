import { BusinessError, JOB_STATUSES, type JobDetail, type JobListItem, type JobListResponse, type JobStatus, type ProductImpact } from '#domain';
import type { Database } from './db.ts';
import { atomic, identifier, type RepositoryOptions, timestamp } from './repository-common.ts';

/** Mặc định: job hẹn đã trễ hơn 15 phút không được tự chạy (cần người dùng quyết định). */
export const DEFAULT_OVERDUE_AFTER_MS = 15 * 60_000;

export interface JobFilter {
  jobId?: string;
  status?: JobStatus;
  accountId?: string;
  destinationId?: string;
  productId?: string;
  /** Khoảng giờ hẹn (epoch ms UTC), gồm hai đầu. */
  from?: number;
  to?: number;
  page?: number;
  pageSize?: number;
  overdueAfterMs?: number;
}

/** Đọc trạng thái job từ dữ liệu bền (không phụ thuộc bộ nhớ của worker). Chỉ đọc. */
export function createJobQueries(db: Database, options: RepositoryOptions = {}) {
  const clock = () => timestamp((options.clock ?? Date.now)());

  function list(filter: JobFilter = {}): JobListResponse {
    const page = filter.page ?? 1;
    const pageSize = filter.pageSize ?? 20;
    const overdueAfterMs = filter.overdueAfterMs ?? DEFAULT_OVERDUE_AFTER_MS;
    if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100
      || !Number.isSafeInteger(overdueAfterMs) || overdueAfterMs < 0) throw new BusinessError('invalid_input');
    if (filter.status !== undefined && !(JOB_STATUSES as readonly string[]).includes(filter.status)) throw new BusinessError('invalid_input');
    for (const id of [filter.jobId, filter.accountId, filter.destinationId, filter.productId]) if (id !== undefined) identifier(id);
    for (const bound of [filter.from, filter.to]) if (bound !== undefined) timestamp(bound);
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (filter.status) { where.push('j.status=?'); params.push(filter.status); }
    if (filter.jobId) { where.push('j.id=?'); params.push(filter.jobId); }
    if (filter.accountId) { where.push('a.account_id=?'); params.push(filter.accountId); }
    if (filter.destinationId) { where.push('a.destination_id=?'); params.push(filter.destinationId); }
    if (filter.productId) { where.push('r.product_id=?'); params.push(filter.productId); }
    if (filter.from !== undefined) { where.push('j.scheduled_at>=?'); params.push(filter.from); }
    if (filter.to !== undefined) { where.push('j.scheduled_at<=?'); params.push(filter.to); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const joins = `FROM publish_jobs j JOIN approvals a ON a.id=j.approval_id JOIN destinations d ON d.id=a.destination_id
      LEFT JOIN accounts ac ON ac.id=a.account_id JOIN content_versions c ON c.id=a.content_version_id
      JOIN product_revisions r ON r.id=c.product_revision_id JOIN products p ON p.id=r.product_id
      LEFT JOIN job_posting_intervals ji ON ji.job_id=j.id`;
    const latest = (column: string) => `(SELECT o.${column} FROM publish_observations o JOIN publish_attempts t ON t.id=o.attempt_id
      WHERE t.job_id=j.id ORDER BY o.observed_at DESC,o.rowid DESC LIMIT 1)`;
    return atomic(db, () => {
      const now = clock();
      const total = Number(db.prepare(`SELECT count(*) AS n ${joins} ${clause}`).get(...params)?.n ?? 0);
      const rows = db.prepare(`SELECT j.id,j.status,j.scheduled_at,j.created_at,j.stop_requested_at,a.channel,a.mode,a.destination_id,
        d.name AS destination_name,d.external_id AS destination_external_id,a.account_id,ac.label AS account_label,r.name AS product_name,
        r.product_id,r.revision_no AS approved_revision_no,p.status AS product_status,ji.min_seconds,ji.max_seconds,
        (SELECT MAX(i.rest_until) FROM job_posting_intervals i JOIN publish_jobs pj ON pj.id=i.job_id
          JOIN approvals pa ON pa.id=pj.approval_id WHERE pa.account_id=a.account_id) AS rest_until,
        (SELECT cr.revision_no FROM product_revisions cr WHERE cr.id=p.current_revision_id) AS current_revision_no,
        (SELECT count(*) FROM publish_attempts t WHERE t.job_id=j.id) AS attempts,
        EXISTS(SELECT 1 FROM publish_attempts t WHERE t.job_id=j.id AND t.send_started_at IS NOT NULL) AS send_started,
        ${latest('outcome')} AS obs_outcome,${latest('reason_code')} AS obs_reason,${latest('remote_id')} AS obs_remote,${latest('observed_at')} AS obs_at
        ${joins} ${clause} ORDER BY j.scheduled_at DESC,j.id LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize) as Array<Record<string, unknown>>;
      const items: JobListItem[] = rows.map((row) => ({
        id: String(row.id), status: row.status as JobStatus, scheduledAt: Number(row.scheduled_at), createdAt: Number(row.created_at),
        channel: row.channel as JobListItem['channel'], mode: row.mode as JobListItem['mode'],
        destination: { id: String(row.destination_id), name: row.destination_name === null ? null : String(row.destination_name),
          externalId: row.destination_external_id === null ? null : String(row.destination_external_id) },
        account: row.account_id === null ? null : { id: String(row.account_id), label: String(row.account_label) },
        productName: String(row.product_name), productId: String(row.product_id), approvedRevisionNo: Number(row.approved_revision_no),
        currentRevisionNo: Number(row.current_revision_no), productStatus: row.product_status as JobListItem['productStatus'],
        attempts: Number(row.attempts), sendStarted: Number(row.send_started) === 1, stopRequested: row.stop_requested_at !== null,
        ...(row.min_seconds === null ? {} : { postingInterval: { minSeconds: Number(row.min_seconds), maxSeconds: Number(row.max_seconds) } }),
        ...(row.rest_until === null ? {} : { restUntil: Number(row.rest_until) }),
        overdue: row.status === 'queued' && Number(row.scheduled_at) < now - overdueAfterMs,
        lastObservation: row.obs_outcome === null ? null : { outcome: String(row.obs_outcome),
          reasonCode: row.obs_reason === null ? null : String(row.obs_reason), remoteId: row.obs_remote === null ? null : String(row.obs_remote),
          observedAt: Number(row.obs_at) },
      }));
      return { items, total, page, pageSize, overdueAfterMs };
    });
  }

  /** Chi tiết một job: phiên bản đã duyệt (caption, ảnh theo thứ tự), từng lần thử kèm quan sát có nguồn, nhật ký hoạt động. Chỉ đọc. */
  function detail(jobId: string, overdueAfterMs: number = DEFAULT_OVERDUE_AFTER_MS): JobDetail {
    identifier(jobId);
    {
      const base = list({ jobId, pageSize: 1, overdueAfterMs }).items[0];
      if (!base) throw new BusinessError('not_found');
      const approved = db.prepare(`SELECT c.id AS content_id,c.caption FROM publish_jobs j JOIN approvals a ON a.id=j.approval_id
        JOIN content_versions c ON c.id=a.content_version_id WHERE j.id=?`).get(jobId) as { content_id: string; caption: string } | undefined;
      if (!approved) throw new BusinessError('not_found');
      const mediaIds = db.prepare('SELECT media_id FROM content_version_media WHERE content_version_id=? ORDER BY position').all(approved.content_id)
        .map((row) => String(row.media_id));
      const attempts = db.prepare('SELECT id,attempt_no,started_at,send_started_at,finished_at FROM publish_attempts WHERE job_id=? ORDER BY attempt_no')
        .all(jobId) as Array<Record<string, unknown>>;
      const observations = db.prepare('SELECT outcome,source,remote_id,remote_url,reason_code,observed_at FROM publish_observations WHERE attempt_id=? ORDER BY observed_at,rowid');
      const activity = db.prepare('SELECT severity,action_code,reason_code,occurred_at FROM activity_log WHERE job_id=? ORDER BY occurred_at,rowid')
        .all(jobId) as Array<Record<string, unknown>>;
      return {
        ...base, caption: approved.caption, mediaIds,
        attemptsDetail: attempts.map((attempt) => ({
          attemptNo: Number(attempt.attempt_no), startedAt: Number(attempt.started_at),
          sendStartedAt: attempt.send_started_at === null ? null : Number(attempt.send_started_at),
          finishedAt: attempt.finished_at === null ? null : Number(attempt.finished_at),
          observations: (observations.all(attempt.id as string) as Array<Record<string, unknown>>).map((row) => ({
            outcome: String(row.outcome), source: String(row.source), remoteId: row.remote_id === null ? null : String(row.remote_id),
            remoteUrl: row.remote_url === null ? null : String(row.remote_url), reasonCode: row.reason_code === null ? null : String(row.reason_code),
            observedAt: Number(row.observed_at),
          })),
        })),
        activity: activity.map((row) => ({
          severity: row.severity as 'info' | 'warn' | 'error', actionCode: String(row.action_code),
          reasonCode: row.reason_code === null ? null : String(row.reason_code), occurredAt: Number(row.occurred_at),
        })),
      };
    }
  }

  /**
   * Xem trước tác động lên job đã xếp trước khi sửa/bán máy. Chỉ đọc. Khớp `invalidateProduct`: job chưa gửi bị đổi trạng thái,
   * job đang chạy chỉ bị yêu cầu dừng, job đã có kết quả giữ nguyên.
   */
  function productImpact(productId: string): ProductImpact {
    identifier(productId);
    if (!db.prepare('SELECT 1 FROM products WHERE id=?').get(productId)) throw new BusinessError('not_found');
    const rows = db.prepare(`SELECT j.status AS status,count(*) AS n FROM publish_jobs j JOIN approvals a ON a.id=j.approval_id
      JOIN content_versions c ON c.id=a.content_version_id JOIN product_revisions r ON r.id=c.product_revision_id
      WHERE r.product_id=? GROUP BY j.status`).all(productId) as Array<{ status: string; n: number }>;
    const byStatus: Record<string, number> = {};
    let pendingJobs = 0;
    let runningJobs = 0;
    let settledJobs = 0;
    for (const row of rows) {
      const n = Number(row.n);
      byStatus[row.status] = n;
      if (['queued', 'paused', 'blocked', 'needs_review'].includes(row.status)) pendingJobs += n;
      else if (row.status === 'running') runningJobs += n;
      else settledJobs += n;
    }
    return { productId, pendingJobs, runningJobs, settledJobs, byStatus };
  }

  return { list, detail, productImpact };
}
