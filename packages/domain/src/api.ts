/** Kiểu request/response của API cục bộ, dùng chung giữa server và web. */
import type { IntegrationMode } from './channels.ts';

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
