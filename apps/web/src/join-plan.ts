import type { GroupJoinQuota, GroupSearchResultItem } from '#domain';

/** Nhóm có thể xếp yêu cầu: Facebook cho phép tham gia và chưa có yêu cầu đang chờ/đã gửi/chưa rõ kết quả từ tài khoản này. */
export function joinable(item: Pick<GroupSearchResultItem, 'joinState' | 'request'>): boolean {
  return item.joinState === 'can_join' && (item.request === null || ['skipped', 'failed', 'cancelled'].includes(item.request.status));
}

/** Số yêu cầu còn xếp thêm được (hạn mức 24 giờ trừ yêu cầu đã xếp mà chưa gửi). */
export const availableToJoin = (quota: GroupJoinQuota | null): number => (quota ? Math.max(0, quota.remaining - quota.pending) : 0);

/** Chọn tự động tối đa `count` nhóm đầu danh sách mà xếp được; không bù bằng nhóm không đủ điều kiện. */
export function pickJoinable(items: readonly GroupSearchResultItem[], count: number): string[] {
  if (!Number.isInteger(count) || count < 1) return [];
  return items.filter(joinable).slice(0, count).map((item) => item.id);
}

/** Lý do chưa gửi được (rỗng = sẵn sàng). `maxCount` là số nhóm người dùng nhập; số đã tick không được vượt. */
export function joinProblems(input: { selected: number; maxCount: number; quota: GroupJoinQuota | null; confirmed: boolean }): string[] {
  const problems: string[] = [];
  if (!Number.isInteger(input.maxCount) || input.maxCount < 1) problems.push('Nhập số nhóm muốn gửi yêu cầu (từ 1 trở lên).');
  if (input.selected === 0) problems.push('Tick ít nhất một nhóm.');
  else if (Number.isInteger(input.maxCount) && input.selected > input.maxCount) problems.push(`Đã tick ${input.selected} nhóm, nhiều hơn số bạn nhập (${input.maxCount}). Bỏ bớt hoặc tăng số.`);
  const room = availableToJoin(input.quota);
  if (input.quota && input.selected > room) problems.push(`Chỉ còn xếp thêm được ${room} yêu cầu trong 24 giờ (hạn mức ${input.quota.cap}). Bỏ bớt nhóm hoặc đợi.`);
  if (!input.confirmed) problems.push('Tick ô xác nhận gửi yêu cầu thật.');
  return problems;
}

export function formatCount(value: number | null): string {
  if (value === null) return 'chưa rõ';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace('.0', '')} Tr`;
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace('.0', '')} N`;
  return String(value);
}
