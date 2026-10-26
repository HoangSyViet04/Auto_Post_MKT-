/**
 * Giao ước publisher theo plan.md mục 4.3. Bản phác thảo cho P00.6; P02.6 hoàn thiện cùng schema job.
 */
import type { Channel } from '#domain';

export type AutomationLevel = 'automatic' | 'semi_automatic' | 'unsupported';

export interface PublisherCapabilities {
  channel: Channel;
  level: AutomationLevel;
  /** true: adapter giả, không gửi gì ra ngoài. UI phải hiển thị chế độ mô phỏng. */
  simulated: boolean;
}

/** Một job = một đích, đúng phiên bản nội dung đã duyệt. */
export interface PublishRequest {
  jobId: string;
  destinationId: string;
  caption: string;
  mediaPaths: readonly string[];
}

export type PrepareResult = { ok: true } | { ok: false; reason: string };

/** unknown: có thể đã gửi — phải verify trước khi thử lại, không phát lại tự động. */
export type SubmitResult =
  | { status: 'published'; remoteId: string }
  | { status: 'pending_approval'; remoteId?: string }
  | { status: 'unknown'; reason: string }
  | { status: 'failed'; reason: string };

export type VerifyResult = { status: 'published' | 'pending_approval' | 'not_found' | 'unknown' };

export interface Publisher {
  readonly capabilities: PublisherCapabilities;
  /** Kiểm tra danh tính, quyền, đích, media; chưa xuất bản. */
  prepare(request: PublishRequest): Promise<PrepareResult>;
  submit(request: PublishRequest): Promise<SubmitResult>;
  /** Chỉ đọc, không tạo thêm bài. */
  verify(request: PublishRequest): Promise<VerifyResult>;
  /** Ngăn phần chưa làm; không ngụ ý thu hồi bài đã gửi. */
  stop(): Promise<void>;
}
