import { randomUUID } from 'node:crypto';
import { BusinessError, type Channel, type SalesEventItem, type SalesEventListResponse, type SalesKind, type SalesSummary, type SalesSummaryRow } from '#domain';
import type { Database } from './db.ts';
import { atomic, identifier, objectInput, one, type RepositoryOptions, timestamp } from './repository-common.ts';

export interface SalesEventInput {
  kind: SalesKind;
  productId: string;
  /** Bài đã đăng mang khách đến (tùy chọn). Phải thuộc đúng máy này và đã gửi đi. */
  jobId?: string | null;
  /** Thời điểm khách hỏi/chốt đơn (epoch ms UTC), không ở tương lai. */
  occurredAt: number;
  customerLabel?: string | null;
  note?: string | null;
  /** Giá trị đơn (VND), chỉ cho đơn hàng. */
  amountVnd?: number | null;
}

export interface SalesFilter {
  kind?: SalesKind;
  productId?: string;
  jobId?: string;
  from?: number;
  to?: number;
  includeVoided?: boolean;
  page?: number;
  pageSize?: number;
}

/** Bài chỉ được coi là nguồn khi đã thật sự gửi đi (kể cả chưa rõ kết quả). */
const SOURCE_STATUSES = ['published', 'pending_approval', 'unknown'];
/** Cho phép lệch đồng hồ nhỏ khi người dùng nhập "bây giờ". */
const FUTURE_SLACK_MS = 5 * 60_000;

function optionalText(value: unknown, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new BusinessError('invalid_input');
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.length > max) throw new BusinessError('invalid_input');
  return trimmed;
}

const emptyRow = (): SalesSummaryRow => ({ inquiries: 0, orders: 0, orderAmountVnd: 0 });
const addTo = (row: SalesSummaryRow, kind: string, count: number, amount: number): void => {
  if (kind === 'inquiry') row.inquiries += count;
  else { row.orders += count; row.orderAmountVnd += amount; }
};

/**
 * Nhật ký khách hỏi/đơn hàng do người dùng NHẬP TAY (P11.9). Không có hàm nào đọc từ Facebook. Dòng nhập nhầm được đánh dấu hủy,
 * không xóa; số liệu tổng hợp bỏ qua dòng đã hủy.
 */
export function createSalesRepository(db: Database, options: RepositoryOptions = {}) {
  const now = () => timestamp((options.clock ?? Date.now)());

  const FROM = `FROM sales_events s JOIN products p ON p.id=s.product_id
    JOIN product_revisions pr ON pr.id=p.current_revision_id
    LEFT JOIN publish_jobs j ON j.id=s.job_id LEFT JOIN approvals a ON a.id=j.approval_id LEFT JOIN destinations d ON d.id=a.destination_id`;

  function where(filter: SalesFilter): { clause: string; params: Array<string | number> } {
    const parts: string[] = [];
    const params: Array<string | number> = [];
    if (filter.kind !== undefined) {
      if (filter.kind !== 'inquiry' && filter.kind !== 'order') throw new BusinessError('invalid_input');
      parts.push('s.kind=?'); params.push(filter.kind);
    }
    for (const [column, value] of [['s.product_id', filter.productId], ['s.job_id', filter.jobId]] as const) {
      if (value !== undefined) { identifier(value); parts.push(`${column}=?`); params.push(value); }
    }
    if (filter.from !== undefined) { parts.push('s.occurred_at>=?'); params.push(timestamp(filter.from)); }
    if (filter.to !== undefined) { parts.push('s.occurred_at<=?'); params.push(timestamp(filter.to)); }
    if (filter.includeVoided !== true) parts.push('s.voided_at IS NULL');
    return { clause: parts.length ? `WHERE ${parts.join(' AND ')}` : '', params };
  }

  function get(id: string): SalesEventItem {
    identifier(id);
    const row = db.prepare(`SELECT s.*,pr.name AS product_name,d.id AS dest_id,d.channel AS dest_channel,d.name AS dest_name,d.external_id AS dest_external ${FROM} WHERE s.id=?`).get(id);
    if (!row) throw new BusinessError('not_found');
    return item(row);
  }

  return {
    add(input: SalesEventInput): SalesEventItem {
      objectInput(input);
      if (input.kind !== 'inquiry' && input.kind !== 'order') throw new BusinessError('invalid_input');
      identifier(input.productId);
      const occurredAt = timestamp(input.occurredAt);
      if (occurredAt > now() + FUTURE_SLACK_MS) throw new BusinessError('invalid_input');
      const customerLabel = optionalText(input.customerLabel, 200);
      const note = optionalText(input.note, 2000);
      const amount = input.amountVnd ?? null;
      if (amount !== null && (input.kind !== 'order' || !Number.isSafeInteger(amount) || amount <= 0)) throw new BusinessError('invalid_input');
      const jobId = input.jobId ?? null;
      if (jobId !== null) identifier(jobId);
      return atomic(db, () => {
        if (!one(db, 'SELECT id FROM products WHERE id=?', input.productId)) throw new BusinessError('not_found');
        if (jobId !== null) {
          const job = one<{ status: string; product_id: string }>(db, `SELECT j.status,r.product_id FROM publish_jobs j JOIN approvals a ON a.id=j.approval_id
            JOIN content_versions c ON c.id=a.content_version_id JOIN product_revisions r ON r.id=c.product_revision_id WHERE j.id=?`, jobId);
          if (!job) throw new BusinessError('not_found');
          if (job.product_id !== input.productId) throw new BusinessError('invalid_input'); // bài của máy khác
          if (!SOURCE_STATUSES.includes(job.status)) throw new BusinessError('not_ready'); // bài chưa gửi đi thì chưa thể mang khách đến
        }
        const id = randomUUID();
        db.prepare('INSERT INTO sales_events(id,kind,product_id,job_id,occurred_at,customer_label,note,amount_vnd,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
          .run(id, input.kind, input.productId, jobId, occurredAt, customerLabel, note, amount, now());
        return get(id);
      });
    },

    get,

    list(filter: SalesFilter = {}): SalesEventListResponse {
      const page = filter.page ?? 1;
      const pageSize = filter.pageSize ?? 20;
      if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new BusinessError('invalid_input');
      const { clause, params } = where(filter);
      return atomic(db, () => ({
        items: (db.prepare(`SELECT s.*,pr.name AS product_name,d.id AS dest_id,d.channel AS dest_channel,d.name AS dest_name,d.external_id AS dest_external ${FROM}
          ${clause} ORDER BY s.occurred_at DESC,s.rowid DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize) as Array<Record<string, unknown>>).map(item),
        total: Number(db.prepare(`SELECT count(*) AS n ${FROM} ${clause}`).get(...params)?.n),
        page,
        pageSize,
      }));
    },

    /** Đánh dấu hủy (nhập nhầm). Đã hủy rồi thì báo xung đột; không bao giờ xóa dòng. */
    voidEvent(id: string): void {
      identifier(id);
      atomic(db, () => {
        const row = one<{ voided_at: number | null }>(db, 'SELECT voided_at FROM sales_events WHERE id=?', id);
        if (!row) throw new BusinessError('not_found');
        if (row.voided_at !== null) throw new BusinessError('conflict');
        db.prepare('UPDATE sales_events SET voided_at=? WHERE id=?').run(now(), id);
      });
    },

    /** Tổng hợp theo máy và theo nơi đăng (bỏ qua dòng đã hủy). Chỉ là số đếm do người dùng nhập, không phải số liệu từ Facebook. */
    summary(filter: Pick<SalesFilter, 'from' | 'to'> = {}): SalesSummary {
      const { clause, params } = where({ ...filter });
      const rows = db.prepare(`SELECT s.kind AS kind,s.product_id AS product_id,pr.name AS product_name,d.id AS dest_id,d.channel AS dest_channel,d.name AS dest_name,
        d.external_id AS dest_external,count(*) AS n,COALESCE(sum(s.amount_vnd),0) AS amount ${FROM} ${clause} GROUP BY s.kind,s.product_id,d.id`).all(...params) as Array<Record<string, unknown>>;
      const total = emptyRow();
      const products = new Map<string, SalesSummaryRow & { productId: string; productName: string }>();
      const sources = new Map<string, SalesSummary['bySource'][number]>();
      for (const row of rows) {
        const kind = String(row.kind);
        const n = Number(row.n);
        const amount = Number(row.amount);
        addTo(total, kind, n, amount);
        const productId = String(row.product_id);
        const product = products.get(productId) ?? { ...emptyRow(), productId, productName: String(row.product_name) };
        addTo(product, kind, n, amount);
        products.set(productId, product);
        const destId = row.dest_id === null ? '' : String(row.dest_id);
        const source = sources.get(destId) ?? { ...emptyRow(), destination: row.dest_id === null ? null
          : { id: destId, channel: row.dest_channel as Channel, name: row.dest_name === null ? null : String(row.dest_name), externalId: row.dest_external === null ? null : String(row.dest_external) } };
        addTo(source, kind, n, amount);
        sources.set(destId, source);
      }
      const byTotal = (a: SalesSummaryRow, b: SalesSummaryRow) => (b.orders + b.inquiries) - (a.orders + a.inquiries);
      return { total, byProduct: [...products.values()].sort(byTotal), bySource: [...sources.values()].sort(byTotal) };
    },
  };

  function item(row: Record<string, unknown>): SalesEventItem {
    return {
      id: String(row.id), kind: row.kind as SalesKind, productId: String(row.product_id), productName: String(row.product_name),
      jobId: row.job_id === null ? null : String(row.job_id),
      source: row.dest_id === null ? null : { channel: row.dest_channel as Channel, destinationId: String(row.dest_id),
        name: row.dest_name === null ? null : String(row.dest_name), externalId: row.dest_external === null ? null : String(row.dest_external) },
      occurredAt: Number(row.occurred_at), customerLabel: row.customer_label === null ? null : String(row.customer_label),
      note: row.note === null ? null : String(row.note), amountVnd: row.amount_vnd === null ? null : Number(row.amount_vnd),
      createdAt: Number(row.created_at), voided: row.voided_at !== null,
    };
  }
}
