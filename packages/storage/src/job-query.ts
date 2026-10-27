import { BusinessError, JOB_STATUSES, type JobListItem, type JobListResponse, type JobStatus } from '#domain';
import type { Database } from './db.ts';
import { atomic, identifier, type RepositoryOptions, timestamp } from './repository-common.ts';

/** Mặc định: job hẹn đã trễ hơn 15 phút không được tự chạy (cần người dùng quyết định). */
export const DEFAULT_OVERDUE_AFTER_MS = 15 * 60_000;

export interface JobFilter {
  status?: JobStatus;
  accountId?: string;
  page?: number;
  pageSize?: number;
  overdueAfterMs?: number;
}

/** Đọc trạng thái job từ dữ liệu bền (không phụ thuộc bộ nhớ của worker). Chỉ đọc. */
export function createJobQueries(db: Database, options: RepositoryOptions = {}) {
  const clock = () => timestamp((options.clock ?? Date.now)());

  return {
    list(filter: JobFilter = {}): JobListResponse {
      const page = filter.page ?? 1;
      const pageSize = filter.pageSize ?? 20;
      const overdueAfterMs = filter.overdueAfterMs ?? DEFAULT_OVERDUE_AFTER_MS;
      if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100
        || !Number.isSafeInteger(overdueAfterMs) || overdueAfterMs < 0) throw new BusinessError('invalid_input');
      if (filter.status !== undefined && !(JOB_STATUSES as readonly string[]).includes(filter.status)) throw new BusinessError('invalid_input');
      if (filter.accountId !== undefined) identifier(filter.accountId);
      const where: string[] = [];
      const params: Array<string | number> = [];
      if (filter.status) { where.push('j.status=?'); params.push(filter.status); }
      if (filter.accountId) { where.push('a.account_id=?'); params.push(filter.accountId); }
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
      return atomic(db, () => {
        const now = clock();
        const total = Number(db.prepare(`SELECT count(*) AS n FROM publish_jobs j JOIN approvals a ON a.id=j.approval_id ${clause}`).get(...params)?.n ?? 0);
        const rows = db.prepare(`SELECT j.id,j.status,j.scheduled_at,j.created_at,j.stop_requested_at,a.channel,a.mode,a.destination_id,
          d.name AS destination_name,d.external_id AS destination_external_id,a.account_id,ac.label AS account_label,r.name AS product_name,
          (SELECT count(*) FROM publish_attempts t WHERE t.job_id=j.id) AS attempts,
          EXISTS(SELECT 1 FROM publish_attempts t WHERE t.job_id=j.id AND t.send_started_at IS NOT NULL) AS send_started,
          (SELECT o.outcome FROM publish_observations o JOIN publish_attempts t ON t.id=o.attempt_id WHERE t.job_id=j.id ORDER BY o.observed_at DESC,o.rowid DESC LIMIT 1) AS obs_outcome,
          (SELECT o.reason_code FROM publish_observations o JOIN publish_attempts t ON t.id=o.attempt_id WHERE t.job_id=j.id ORDER BY o.observed_at DESC,o.rowid DESC LIMIT 1) AS obs_reason,
          (SELECT o.remote_id FROM publish_observations o JOIN publish_attempts t ON t.id=o.attempt_id WHERE t.job_id=j.id ORDER BY o.observed_at DESC,o.rowid DESC LIMIT 1) AS obs_remote,
          (SELECT o.observed_at FROM publish_observations o JOIN publish_attempts t ON t.id=o.attempt_id WHERE t.job_id=j.id ORDER BY o.observed_at DESC,o.rowid DESC LIMIT 1) AS obs_at
          FROM publish_jobs j JOIN approvals a ON a.id=j.approval_id JOIN destinations d ON d.id=a.destination_id
          LEFT JOIN accounts ac ON ac.id=a.account_id JOIN content_versions c ON c.id=a.content_version_id
          JOIN product_revisions r ON r.id=c.product_revision_id ${clause}
          ORDER BY j.scheduled_at DESC,j.id LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize) as Array<Record<string, unknown>>;
        const items: JobListItem[] = rows.map((row) => ({
          id: String(row.id), status: row.status as JobStatus, scheduledAt: Number(row.scheduled_at), createdAt: Number(row.created_at),
          channel: row.channel as JobListItem['channel'], mode: row.mode as JobListItem['mode'],
          destination: { id: String(row.destination_id), name: row.destination_name === null ? null : String(row.destination_name),
            externalId: row.destination_external_id === null ? null : String(row.destination_external_id) },
          account: row.account_id === null ? null : { id: String(row.account_id), label: String(row.account_label) },
          productName: String(row.product_name), attempts: Number(row.attempts), sendStarted: Number(row.send_started) === 1,
          stopRequested: row.stop_requested_at !== null,
          overdue: row.status === 'queued' && Number(row.scheduled_at) < now - overdueAfterMs,
          lastObservation: row.obs_outcome === null ? null : { outcome: String(row.obs_outcome),
            reasonCode: row.obs_reason === null ? null : String(row.obs_reason), remoteId: row.obs_remote === null ? null : String(row.obs_remote),
            observedAt: Number(row.obs_at) },
        }));
        return { items, total, page, pageSize, overdueAfterMs };
      });
    },
  };
}
