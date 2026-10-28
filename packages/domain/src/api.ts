/** Kiểu request/response của API cục bộ, dùng chung giữa server và web. */
import type { Channel, IntegrationMode } from './channels.ts';
import type { JobStatus } from './job-status.ts';

export type AppEnvName = 'development' | 'test' | 'production';

export interface HealthResponse {
  status: 'ok';
  env: AppEnvName;
  schemaVersion: number;
  /** fake: mô phỏng, UI phải hiển thị rõ. */
  integrations: IntegrationMode;
  /** Worker có đang chạy không và có được phép mở trình duyệt không. */
  worker: { alive: boolean; browser: 'off' | 'real' | 'unknown' };
  startedAt: string;
}

export interface ApiError {
  error: string;
  message: string;
}

/** Dữ kiện nhập cho một phiên bản máy; trường tùy chọn thiếu là null, không phải 0. */
export interface ProductFacts {
  name: string;
  condition: string;
  mediaIds: string[];
  priceVnd: number | null;
  capacityText: string | null;
  batteryText: string | null;
  warrantyText: string | null;
  locationText: string | null;
}

export type ProductStatus = 'selling' | 'sold' | 'archived';

export interface ProductListItem {
  id: string;
  code: string;
  status: ProductStatus;
  name: string;
  condition: string;
  priceVnd: number | null;
  mediaCount: number;
  firstMediaId: string | null;
}

export interface ProductListResponse {
  items: ProductListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export type SessionStatus = 'unknown' | 'logged_in' | 'login_required' | 'verification_required' | 'network_error';

export type BrowserCommandKind = 'login' | 'verify';
export type BrowserCommandStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface BrowserCommandSummary {
  id: string;
  kind: BrowserCommandKind;
  status: BrowserCommandStatus;
  /** Mã kết quả cố định (ví dụ identity_saved, match, login_required, verification_required, network_error, identity_mismatch). */
  resultCode: string | null;
  requestedAt: number;
  finishedAt: number | null;
  cancelRequestedAt: number | null;
}

export interface AccountSummary {
  id: string;
  label: string;
  slot: 1 | 2;
  sessionStatus: SessionStatus;
  paused: boolean;
  createdAt: number;
  /** null: chưa xác nhận được danh tính Facebook (xác nhận thuộc P03.3/P03.4). */
  identity: { remoteId: string; displayName: string | null; confirmedAt: number } | null;
  proxy: { id: string; label: string } | null;
  /** Đếm từ các tác vụ đã lưu, không ước lượng. */
  queuedJobs: number;
  runningJobs: number;
  /** Lệnh trình duyệt gần nhất (đăng nhập/kiểm tra phiên); null nếu chưa có. */
  browser: BrowserCommandSummary | null;
}

export type GroupMembership = 'unknown' | 'joined' | 'not_joined';
export type GroupPermission = 'unknown' | 'allowed' | 'denied';
export type GroupApproval = 'unknown' | 'required' | 'not_required';
export type GroupCuration = 'normal' | 'preferred' | 'unsuitable';
/** Lý do một cặp tài khoản–nhóm chưa được đưa sang đăng. */
export type GroupBlocker = 'no_external_id' | 'not_joined' | 'no_permission' | 'unsuitable' | 'archived' | 'account_paused';

export interface GroupAccountRelation {
  accountId: string;
  accountLabel: string;
  membership: GroupMembership;
  permission: GroupPermission;
  /** manual: người dùng tự khai báo, chưa được kiểm chứng. */
  source: 'manual' | 'joined_scan' | 'keyword_scan' | 'verified_ui' | 'fixture';
  checkedAt: number | null;
  eligible: boolean;
  blockedBy: GroupBlocker[];
}

export interface GroupItem {
  id: string;
  /** null: mới biết tên rút gọn trong link, chưa có ID số nên chưa đăng được. */
  externalId: string | null;
  canonicalUrl: string | null;
  name: string | null;
  region: string | null;
  topic: string | null;
  rulesNote: string | null;
  approvalRequired: GroupApproval;
  curation: GroupCuration;
  userNote: string | null;
  archived: boolean;
  createdAt: number;
  accounts: GroupAccountRelation[];
}

export interface GroupListResponse {
  items: GroupItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface JobListItem {
  id: string;
  status: JobStatus;
  /** Giờ hẹn (UTC, mili giây). Hiển thị/lập lịch theo múi giờ Asia/Ho_Chi_Minh ở giao diện. */
  scheduledAt: number;
  createdAt: number;
  channel: Channel;
  mode: IntegrationMode;
  destination: { id: string; name: string | null; externalId: string | null };
  /** null với kênh Page (đăng qua kết nối Page, không qua tài khoản trình duyệt). */
  account: { id: string; label: string } | null;
  productName: string;
  productId: string;
  /** Phiên bản máy đã được duyệt cho job này và phiên bản hiện tại của máy; khác nhau nghĩa là máy đã sửa sau khi duyệt. */
  approvedRevisionNo: number;
  currentRevisionNo: number;
  productStatus: 'selling' | 'sold' | 'archived';
  attempts: number;
  /** true nếu đã có mốc bắt đầu gửi: job có thể đã tới Facebook, không được tự gửi lại. */
  sendStarted: boolean;
  stopRequested: boolean;
  /** Quá hạn: còn chờ nhưng giờ hẹn đã qua lâu hơn ngưỡng cho phép tự chạy; cần người dùng chọn tiếp tục hoặc bỏ. */
  overdue: boolean;
  lastObservation: { outcome: string; reasonCode: string | null; remoteId: string | null; observedAt: number } | null;
}

export interface JobAttemptDetail {
  attemptNo: number;
  startedAt: number;
  sendStartedAt: number | null;
  finishedAt: number | null;
  observations: Array<{ outcome: string; source: string; remoteId: string | null; remoteUrl: string | null; reasonCode: string | null; observedAt: number }>;
}

export interface JobDetail extends JobListItem {
  /** Caption và ảnh của phiên bản ĐÃ DUYỆT (không đổi khi máy được sửa sau đó). */
  caption: string;
  mediaIds: string[];
  attemptsDetail: JobAttemptDetail[];
  activity: Array<{ severity: 'info' | 'warn' | 'error'; actionCode: string; reasonCode: string | null; occurredAt: number }>;
}

export interface JobListResponse {
  items: JobListItem[];
  total: number;
  page: number;
  pageSize: number;
  /** Ngưỡng quá hạn đang áp dụng (ms). */
  overdueAfterMs: number;
}

export interface ContentVersionItem {
  id: string;
  revisionId: string;
  revisionNo: number;
  caption: string;
  source: 'template' | 'manual' | 'llm';
  destinationId: string | null;
  createdAt: number;
  mediaIds: string[];
}

export interface ProductDetail extends ProductFacts {
  id: string;
  code: string;
  status: ProductStatus;
  revisionId: string;
  revisionNo: number;
}

/** Cấu hình đăng thường dùng: cặp tài khoản–đích do người dùng chọn rõ, mẫu caption và cách hẹn giờ. */
export interface PresetSchedule {
  /** `now`: bắt đầu ngay khi duyệt. `daily`: lần kế tiếp của giờ `timeOfDay` (giờ Việt Nam, dạng "HH:MM"). */
  startMode: 'now' | 'daily';
  timeOfDay?: string;
}

export interface PresetTarget {
  accountId: string;
  destinationId: string;
  channel: 'profile' | 'group';
  name: string | null;
  externalId: string | null;
}

export interface PresetItem {
  id: string;
  label: string;
  /** Mẫu caption có chỗ trống như {ten}, {gia}; null = dùng caption mẫu mặc định của máy. */
  captionTemplate: string | null;
  schedule: PresetSchedule;
  targets: PresetTarget[];
  createdAt: number;
}

export interface PresetListResponse {
  items: PresetItem[];
}

/** Tác động của việc sửa hoặc đổi trạng thái máy lên các job đã xếp (xem trước khi lưu). */
export interface ProductImpact {
  productId: string;
  /** Job chưa gửi (chờ/tạm dừng/bị chặn/cần xem lại): khi sửa máy → "cần xem lại"; khi bán hoặc ngừng bán → bị hủy. */
  pendingJobs: number;
  /** Job đang chạy: chỉ bị yêu cầu dừng, kết quả thực tế vẫn được ghi. */
  runningJobs: number;
  /** Job đã gửi hoặc đã có kết quả cuối: không đổi, giữ nguyên bản đã duyệt. */
  settledJobs: number;
  byStatus: Record<string, number>;
}

/** Ghi nhận thủ công: khách hỏi hoặc đơn hàng. Không có dữ liệu nào ở đây được đọc tự động từ Facebook. */
export type SalesKind = 'inquiry' | 'order';

export interface SalesEventItem {
  id: string;
  kind: SalesKind;
  productId: string;
  productName: string;
  /** Bài đăng đã mang khách đến; null khi không rõ nguồn. */
  jobId: string | null;
  source: { channel: Channel; destinationId: string; name: string | null; externalId: string | null } | null;
  occurredAt: number;
  customerLabel: string | null;
  note: string | null;
  amountVnd: number | null;
  createdAt: number;
  voided: boolean;
}

export interface SalesEventListResponse {
  items: SalesEventItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SalesSummaryRow {
  inquiries: number;
  orders: number;
  orderAmountVnd: number;
}

export interface SalesSummary {
  total: SalesSummaryRow;
  byProduct: Array<SalesSummaryRow & { productId: string; productName: string }>;
  /** Theo nơi đăng; destination null = không rõ nguồn. */
  bySource: Array<SalesSummaryRow & { destination: { id: string; channel: Channel; name: string | null; externalId: string | null } | null }>;
}
