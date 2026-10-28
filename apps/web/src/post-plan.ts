import { type ContentVersionItem, findSimilarCaptions } from '#domain';
import { parseVnLocal } from './job-view.ts';

export interface PostDraft {
  accountId: string;
  productId: string;
  /** Caption chung cho các đích (mặc định lấy từ caption mẫu của máy, người dùng sửa được). */
  caption: string;
  /** Sửa riêng từng đích; trống thì dùng caption chung. */
  overrides: Record<string, string>;
  /** Thứ tự chọn đích. */
  selected: string[];
  startMode: 'now' | 'later';
  /** Giờ hẹn nhập theo giờ Việt Nam, dạng "2026-10-27T14:30". */
  startLocal: string;
}

export const emptyDraft = (): PostDraft => ({ accountId: '', productId: '', caption: '', overrides: {}, selected: [], startMode: 'now', startLocal: '' });

export const captionFor = (draft: PostDraft, destinationId: string): string => {
  const own = draft.overrides[destinationId]?.trim();
  return own ? own : draft.caption.trim();
};

export interface PlanItem {
  destinationId: string;
  caption: string;
  source: 'template' | 'manual';
}

/** Các mục sẽ gửi, theo thứ tự chọn. `template` chỉ khi caption đúng bằng caption mẫu hiện tại. */
export function planItems(draft: PostDraft, template: string): PlanItem[] {
  return draft.selected.map((destinationId) => {
    const caption = captionFor(draft, destinationId);
    return { destinationId, caption, source: caption === template.trim() ? 'template' : 'manual' };
  });
}

/** Giờ bắt đầu (epoch ms UTC) hoặc null nếu giờ hẹn sai/đã trôi qua quá lâu (tránh vô tình tạo job quá hạn). */
export function resolveStart(draft: PostDraft, now: number, overdueAfterMs = 15 * 60_000): number | null {
  if (draft.startMode === 'now') return now;
  const at = parseVnLocal(draft.startLocal);
  return at !== null && at >= now - overdueAfterMs ? at : null;
}

export interface PlanContext {
  accountSession: string | null;
  productSelling: boolean;
  now: number;
}

/** Lý do chưa gửi được (rỗng = sẵn sàng). Chỉ chặn việc thật sự sai; thiếu thông tin tùy chọn không chặn. */
export function planProblems(draft: PostDraft, context: PlanContext): string[] {
  const problems: string[] = [];
  if (!draft.accountId) problems.push('Chọn tài khoản đăng.');
  else if (context.accountSession !== 'logged_in') problems.push('Tài khoản chưa ở trạng thái đã đăng nhập (dùng "Kiểm tra phiên" ở trang Quản lý tài khoản).');
  if (!draft.productId) problems.push('Chọn máy.');
  else if (!context.productSelling) problems.push('Máy này đã bán hoặc ngừng bán nên không tạo bài mới.');
  if (draft.selected.length === 0) problems.push('Chọn ít nhất một nhóm.');
  const empty = draft.selected.filter((id) => !captionFor(draft, id)).length;
  if (empty > 0) problems.push(`${empty} nhóm chưa có caption.`);
  if (resolveStart(draft, context.now) === null) problems.push('Giờ hẹn không hợp lệ hoặc đã qua quá lâu (nhập theo giờ Việt Nam).');
  return problems;
}

/** Cùng một caption cho nhiều đích dễ bị coi là spam: cảnh báo (không chặn). */
export function duplicateWarning(items: readonly PlanItem[]): string | null {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.caption, (counts.get(item.caption) ?? 0) + 1);
  const worst = Math.max(0, ...counts.values());
  return worst >= 2 ? `${worst} nhóm dùng cùng một caption. Nên sửa riêng từng nhóm để tránh lặp nội dung.` : null;
}

/** Đích mà caption giống (≥80%) một bản đã lưu của chính máy này cho cùng đích. Chỉ cảnh báo. */
export function similarToHistory(items: readonly PlanItem[], versions: readonly ContentVersionItem[]): Array<{ destinationId: string; score: number }> {
  const found: Array<{ destinationId: string; score: number }> = [];
  for (const item of items) {
    const same = versions.filter((version) => version.destinationId === item.destinationId);
    const best = findSimilarCaptions(item.caption, same)[0];
    if (best) found.push({ destinationId: item.destinationId, score: best.score });
  }
  return found;
}

/** Chữ ký nội dung gửi: đổi nội dung thì phải dùng mã yêu cầu mới; không đổi thì giữ mã cũ để bấm lại không tạo job trùng. */
export function planSignature(accountId: string, productId: string, start: number | 'now', items: readonly PlanItem[]): string {
  return JSON.stringify([accountId, productId, start, items.map(({ destinationId, caption }) => [destinationId, caption])]);
}
