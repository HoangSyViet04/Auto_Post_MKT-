import { type ContentVersionItem, findSimilarCaptions, type GroupItem, type PresetItem } from '#domain';
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
  if (draft.selected.length > 100) problems.push('Mỗi lượt xếp tối đa 100 nhóm. Bỏ bớt nhóm trước khi duyệt.');
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

const VN_OFFSET_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;

/** Lần kế tiếp (epoch ms UTC) của giờ "HH:MM" theo giờ Việt Nam; đúng giờ hiện tại thì tính sang ngày mai. */
export function nextDailyStart(timeOfDay: string, now: number): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/u.exec(timeOfDay);
  if (!match) return null;
  const vnNow = now + VN_OFFSET_MS;
  const dayStart = vnNow - (((vnNow % DAY_MS) + DAY_MS) % DAY_MS);
  const today = dayStart + (Number(match[1]) * 60 + Number(match[2])) * 60_000 - VN_OFFSET_MS;
  return today > now ? today : today + DAY_MS;
}

/** Epoch ms UTC → "2026-10-27T14:30" theo giờ Việt Nam (giá trị của ô nhập giờ hẹn). */
export const toVnLocal = (ms: number): string => new Date(ms + VN_OFFSET_MS).toISOString().slice(0, 16);

export interface PresetSelection {
  selected: string[];
  skipped: Array<{ destinationId: string; name: string; reason: 'not_loaded' | 'not_eligible' }>;
}

/**
 * Nhóm được chọn khi áp dụng cấu hình cho một tài khoản: chỉ các đích đã lưu cho ĐÚNG tài khoản này và hiện vẫn đủ điều kiện đăng.
 * Đích không còn (bị lưu trữ/mất quan hệ) hoặc không còn đủ điều kiện bị bỏ qua và được báo rõ, không tự thay bằng đích khác.
 */
export function presetSelection(preset: Pick<PresetItem, 'targets'>, accountId: string, groups: readonly GroupItem[]): PresetSelection {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const result: PresetSelection = { selected: [], skipped: [] };
  for (const target of preset.targets) {
    if (target.accountId !== accountId || target.channel !== 'group') continue;
    const group = byId.get(target.destinationId);
    const name = target.name ?? target.externalId ?? target.destinationId;
    if (!group) result.skipped.push({ destinationId: target.destinationId, name, reason: 'not_loaded' });
    else if (group.accounts.find((relation) => relation.accountId === accountId)?.eligible !== true) result.skipped.push({ destinationId: target.destinationId, name, reason: 'not_eligible' });
    else result.selected.push(target.destinationId);
  }
  return result;
}
