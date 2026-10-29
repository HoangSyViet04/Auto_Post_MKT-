export interface JoinedScanSummary {
  id: string;
  accountId: string;
  status: 'queued' | 'running' | 'completed' | 'partial' | 'stopped' | 'blocked' | 'failed';
  limit: number;
  observedCount: number;
  withoutIdCount: number;
  reasonCode: string | null;
  createdAt: number;
  finishedAt: number | null;
  cancelRequested: boolean;
}

export const JOINED_SCAN_ACTIVE = ['queued', 'running'] as const;
export const JOINED_SCAN_REASON: Record<string, string> = {
  result_limit: 'Đã đạt giới hạn quét',
  no_more_results_seen: 'Không thấy nhóm mới sau nhiều lượt cuộn',
  no_results: 'Không thấy nhóm nào cho từ khóa này',
  round_cap: 'Đã đạt giới hạn lượt cuộn',
  cancelled: 'Đã dừng theo yêu cầu',
  worker_lost: 'Worker bị gián đoạn; có thể quét lại',
  session_expired: 'Cần đăng nhập lại',
  checkpoint: 'Facebook yêu cầu xác minh',
  identity_mismatch: 'Danh tính không khớp tài khoản đã chọn',
  network_error: 'Lỗi kết nối mạng',
  ui_changed: 'Không đọc được danh sách nhóm trên giao diện này',
  profile_in_use: 'Hồ sơ trình duyệt đang được dùng',
  account_changed: 'Tài khoản đã tạm dừng, gỡ hoặc đổi danh tính',
  scan_error: 'Quét gặp lỗi; giữ các nhóm đã lưu',
};
