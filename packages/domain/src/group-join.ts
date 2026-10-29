/** Tìm nhóm theo từ khóa và gửi yêu cầu tham gia (P06.3). Tìm thấy không có nghĩa đã tham gia hay được phép đăng. */

export const JOIN_DAILY_CAP_MAX = 30;
export const JOIN_BATCH_MAX = 30;
export const JOIN_WINDOW_MS = 24 * 3_600_000;
export const SEARCH_LIMIT_MAX = 200;
export const SEARCH_KEYWORD_MAX = 100;

export interface GroupJoinSettings {
  /** Số yêu cầu tham gia tối đa cho MỖI tài khoản trong 24 giờ gần nhất. */
  dailyCap: number;
  /** Khoảng cách ngẫu nhiên giữa hai lần gửi của cùng một tài khoản. */
  minGapSeconds: number;
  maxGapSeconds: number;
}

export const DEFAULT_JOIN_SETTINGS: GroupJoinSettings = { dailyCap: 5, minGapSeconds: 180, maxGapSeconds: 360 };

/** Rỗng nếu hợp lệ; ngược lại là lý do bằng tiếng Việt. */
export function joinSettingsProblem(value: GroupJoinSettings): string | null {
  const whole = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);
  if (!whole(value.dailyCap) || value.dailyCap < 1 || value.dailyCap > JOIN_DAILY_CAP_MAX) return `Số yêu cầu mỗi ngày phải từ 1 đến ${JOIN_DAILY_CAP_MAX}.`;
  if (!whole(value.minGapSeconds) || value.minGapSeconds < 60 || value.minGapSeconds > 3600) return 'Khoảng cách tối thiểu phải từ 60 đến 3600 giây.';
  if (!whole(value.maxGapSeconds) || value.maxGapSeconds < value.minGapSeconds || value.maxGapSeconds > 7200) return 'Khoảng cách tối đa phải từ mức tối thiểu đến 7200 giây.';
  return null;
}

export type GroupJoinState = 'can_join' | 'joined' | 'requested' | 'unknown';
export type GroupPrivacy = 'public' | 'private' | 'unknown';

export interface GroupSearchSummary {
  id: string;
  accountId: string;
  keyword: string;
  status: 'queued' | 'running' | 'completed' | 'partial' | 'stopped' | 'blocked' | 'failed';
  limit: number;
  observedCount: number;
  reasonCode: string | null;
  createdAt: number;
  finishedAt: number | null;
  cancelRequested: boolean;
}

export interface GroupSearchResultItem {
  id: string;
  externalId: string;
  canonicalUrl: string;
  name: string | null;
  privacy: GroupPrivacy;
  memberCount: number | null;
  joinState: GroupJoinState;
  observedAt: number;
  /** Yêu cầu tham gia gần nhất của chính tài khoản này cho nhóm đó (nếu có). */
  request: { status: GroupJoinStatus; reasonCode: string | null } | null;
}

export type GroupJoinStatus = 'queued' | 'running' | 'requested' | 'joined' | 'skipped' | 'failed' | 'unknown' | 'cancelled';
export const GROUP_JOIN_ACTIVE: readonly GroupJoinStatus[] = ['queued', 'running'];
/** Các trạng thái tính vào hạn mức mỗi ngày (đã gửi hoặc có thể đã gửi). */
export const GROUP_JOIN_COUNTED: readonly GroupJoinStatus[] = ['requested', 'joined', 'unknown'];

export interface GroupJoinRequestItem {
  id: string;
  batchId: string;
  externalId: string;
  canonicalUrl: string;
  name: string | null;
  status: GroupJoinStatus;
  reasonCode: string | null;
  notBefore: number;
  sentAt: number | null;
  finishedAt: number | null;
  createdAt: number;
}

/** `used`: đã gửi hoặc có thể đã gửi trong 24 giờ; `pending`: đã xếp nhưng chưa gửi; `remaining` = hạn mức − used (chưa trừ pending). */
export interface GroupJoinQuota { used: number; pending: number; cap: number; remaining: number; nextFreeAt: number | null }

export const GROUP_JOIN_STATUS_LABEL: Record<GroupJoinStatus, string> = {
  queued: 'Đang chờ đến lượt',
  running: 'Đang gửi',
  requested: 'Đã gửi yêu cầu, chờ quản trị viên duyệt',
  joined: 'Đã vào nhóm',
  skipped: 'Bỏ qua (không gửi)',
  failed: 'Lỗi, chưa gửi',
  unknown: 'Chưa rõ kết quả, hãy kiểm tra trên Facebook',
  cancelled: 'Đã hủy',
};

export const GROUP_JOIN_REASON: Record<string, string> = {
  needs_answers: 'Nhóm có câu hỏi hoặc điều khoản bắt buộc: cần tự làm tay',
  already_joined: 'Nick đã là thành viên',
  already_requested: 'Đã gửi yêu cầu từ trước',
  daily_cap: 'Đạt hạn mức yêu cầu trong 24 giờ',
  action_blocked: 'Facebook đang hạn chế việc tham gia nhóm; đã dừng các yêu cầu còn lại',
  batch_stopped: 'Dừng vì các yêu cầu trước gặp vấn đề',
  cancelled: 'Đã hủy theo yêu cầu',
  session_expired: 'Cần đăng nhập lại',
  checkpoint: 'Facebook yêu cầu xác minh',
  identity_mismatch: 'Danh tính không khớp tài khoản đã chọn',
  network_error: 'Lỗi kết nối mạng',
  ui_changed: 'Không nhận ra nút tham gia trên giao diện này',
  wrong_group: 'Trang mở ra không đúng nhóm đã chọn',
  profile_in_use: 'Hồ sơ trình duyệt đang được dùng',
  account_changed: 'Tài khoản đã tạm dừng, gỡ hoặc đổi danh tính',
  worker_lost: 'Worker bị gián đoạn',
  unconfirmed: 'Đã bấm tham gia nhưng chưa thấy xác nhận; kiểm tra trên Facebook, không gửi lại',
  join_error: 'Gặp lỗi khi gửi yêu cầu',
};

/** Các lý do làm dừng mọi yêu cầu còn chờ của cùng tài khoản (vấn đề ở phiên/tài khoản, không phải riêng một nhóm). */
export const GROUP_JOIN_STOP_REASONS: readonly string[] = ['action_blocked', 'session_expired', 'checkpoint', 'identity_mismatch', 'account_changed'];

/** "12K thành viên", "1,2 N thành viên", "3 Tr members", "850 members" → số; không đọc được → null. */
export function parseMemberCount(textValue: string): number | null {
  const match = /(\d[\d.,]*)\s*(k|n|nghìn|tr|triệu|m)?\s*(?:thành viên|members?)/iu.exec(textValue);
  if (!match?.[1]) return null;
  const unit = (match[2] ?? '').toLowerCase();
  const scale = unit === 'k' || unit === 'n' || unit === 'nghìn' ? 1_000 : unit === 'tr' || unit === 'triệu' || unit === 'm' ? 1_000_000 : 1;
  const raw = match[1];
  // Có đơn vị: dấu , hoặc . là dấu thập phân ("1,2 N"). Không có đơn vị: là dấu phân cách hàng nghìn ("12.345").
  const value = scale > 1 ? Number(raw.replace(',', '.')) : Number(raw.replace(/[.,]/gu, ''));
  return Number.isFinite(value) ? Math.round(value * scale) : null;
}
