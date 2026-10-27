/** Nhóm được chọn ở trang Quét nhóm để chuyển sang Đăng bài viết nhóm. Chỉ giữ trong bộ nhớ của tab, không lưu đĩa. */
export interface GroupHandoff {
  accountId: string;
  accountLabel: string;
  groups: Array<{ id: string; name: string }>;
}

let current: GroupHandoff | null = null;

export const setHandoff = (handoff: GroupHandoff): void => {
  current = handoff;
};
export const getHandoff = (): GroupHandoff | null => current;
export const clearHandoff = (): void => {
  current = null;
};
