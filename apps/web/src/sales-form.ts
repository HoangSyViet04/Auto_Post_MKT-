import type { Channel, SalesEventItem, SalesKind } from '#domain';
import { parseVnLocal } from './job-view.ts';
import { toVnLocal } from './post-plan.ts';
import { parsePrice } from './product-form.ts';

export interface SalesDraft {
  kind: SalesKind;
  productId: string;
  /** Bài đã đăng mang khách đến; trống = không rõ nguồn. */
  jobId: string;
  /** Giờ nhập theo giờ Việt Nam, dạng "2026-10-27T14:30". */
  occurredLocal: string;
  customerLabel: string;
  note: string;
  amount: string;
}

export const emptySalesDraft = (now: number): SalesDraft => ({ kind: 'inquiry', productId: '', jobId: '', occurredLocal: toVnLocal(now), customerLabel: '', note: '', amount: '' });

export const KIND_LABEL: Record<SalesKind, string> = { inquiry: 'Khách hỏi', order: 'Đơn hàng' };
const CHANNEL_LABEL: Record<Channel, string> = { profile: 'Trang cá nhân', group: 'Nhóm', page: 'Fanpage' };

export const sourceLabel = (source: SalesEventItem['source']): string =>
  source ? `${CHANNEL_LABEL[source.channel]} · ${source.name ?? source.externalId ?? 'chưa đặt tên'}` : 'Không rõ nguồn';

export interface SalesBody {
  kind: SalesKind;
  productId: string;
  jobId: string | null;
  occurredAt: number;
  customerLabel: string | null;
  note: string | null;
  amountVnd: number | null;
}

/** Kiểm tra form trước khi gửi: trả nội dung gửi đi hoặc danh sách lỗi (tiếng Việt). Giá trị đơn chỉ áp dụng cho đơn hàng. */
export function salesBody(draft: SalesDraft, now: number): { ok: true; body: SalesBody } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!draft.productId) errors.push('Chọn máy.');
  const occurredAt = parseVnLocal(draft.occurredLocal);
  if (occurredAt === null) errors.push('Giờ không hợp lệ (nhập theo giờ Việt Nam).');
  else if (occurredAt > now + 5 * 60_000) errors.push('Giờ ở tương lai; chỉ ghi nhận việc đã xảy ra.');
  let amountVnd: number | null = null;
  if (draft.kind === 'order' && draft.amount.trim() !== '') {
    const parsed = parsePrice(draft.amount);
    if (parsed === 'invalid' || parsed === null) errors.push('Giá trị đơn không hợp lệ (nhập số tiền VND, ví dụ 9.500.000).');
    else amountVnd = parsed;
  }
  if (draft.customerLabel.trim().length > 200) errors.push('Tên/ghi chú khách tối đa 200 ký tự.');
  if (draft.note.trim().length > 2000) errors.push('Ghi chú tối đa 2000 ký tự.');
  if (errors.length > 0 || occurredAt === null) return { ok: false, errors };
  return { ok: true, body: { kind: draft.kind, productId: draft.productId, jobId: draft.jobId || null, occurredAt,
    customerLabel: draft.customerLabel.trim() || null, note: draft.note.trim() || null, amountVnd } };
}

/** Bài chỉ làm nguồn được khi đã gửi đi (kể cả chưa rõ kết quả hoặc chờ duyệt). */
export const SOURCE_JOB_STATUSES = new Set(['published', 'pending_approval', 'unknown']);
