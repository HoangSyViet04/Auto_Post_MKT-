/**
 * Publisher/scanner contracts. Live implementations must require an approved
 * context at runtime; legacy requests below exist only for offline fake fixtures.
 */
import type { Channel } from '#domain';

export type AutomationLevel = 'automatic' | 'semi_automatic' | 'unsupported';

export interface PublisherCapabilities {
  readonly channel: Channel;
  readonly level: AutomationLevel;
  /** true: adapter giả, không gửi gì ra ngoài. UI phải hiển thị chế độ mô phỏng. */
  readonly simulated: boolean;
}

export type OperationReasonCode = 'stopped' | 'invalid_request' | 'session_expired' | 'checkpoint'
  | 'identity_mismatch' | 'destination_not_allowed' | 'media_invalid' | 'unsupported'
  | 'request_mismatch' | 'network_error' | 'ui_changed' | 'unknown';

export interface IntegrationEvidence {
  readonly source: 'simulated' | 'browser_observation' | 'graph_api';
  readonly observedAt: string;
  readonly identityRemoteId?: string;
  readonly destinationRemoteId?: string;
  readonly remoteUrl?: string;
}

export interface PublishContext {
  readonly requestId: string;
  readonly approvalId: string;
  readonly contentVersionId: string;
  readonly expectedIdentity: {
    readonly kind: 'account' | 'page';
    readonly localId: string;
    readonly remoteId: string;
  };
  readonly destination: { readonly channel: Channel; readonly remoteId: string };
}

/** One job = one destination. Context-less requests may only reach fake adapters. */
export interface PublishRequest {
  readonly jobId: string;
  readonly destinationId: string;
  readonly caption: string;
  readonly mediaPaths: readonly string[];
  readonly context?: PublishContext;
}

/** Mandatory boundary for future scheduler/live consumers, not inferred from jobId. */
export interface ApprovedPublishRequest extends PublishRequest {
  readonly context: PublishContext;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Validate untrusted DB/API input without echoing caption, paths or identifiers. */
export function assertApprovedPublishRequest(value: unknown): asserts value is ApprovedPublishRequest {
  if (!record(value) || !text(value.jobId) || !text(value.destinationId) || !text(value.caption)
    || !Array.isArray(value.mediaPaths) || value.mediaPaths.length === 0 || ![...value.mediaPaths].every(text)) {
    throw new Error('Approved publish request không hợp lệ.');
  }
  const context = value.context;
  if (!record(context) || !text(context.requestId) || !text(context.approvalId) || !text(context.contentVersionId)) {
    throw new Error('Approved publish context không hợp lệ.');
  }
  const identity = context.expectedIdentity;
  const destination = context.destination;
  if (!record(identity) || (identity.kind !== 'account' && identity.kind !== 'page')
    || !text(identity.localId) || !text(identity.remoteId) || !record(destination)
    || typeof destination.channel !== 'string' || !['profile', 'group', 'page'].includes(destination.channel) || !text(destination.remoteId)
    || (destination.channel === 'page') !== (identity.kind === 'page')
    || (destination.channel !== 'group' && destination.remoteId !== identity.remoteId)) {
    throw new Error('Approved publish identity/destination không hợp lệ.');
  }
}

export type PrepareResult = { readonly ok: true }
  | { readonly ok: false; readonly reasonCode: OperationReasonCode; readonly reason: string };

/** unknown: có thể đã gửi — phải verify trước khi thử lại, không phát lại tự động. */
export type SubmitResult = (
  | { status: 'published'; remoteId: string }
  | { status: 'pending_approval'; remoteId?: string }
  | { status: 'unknown'; reason: string }
  | { status: 'failed'; reason: string }
) & { readonly evidence?: IntegrationEvidence; readonly reasonCode?: OperationReasonCode };

/** not_found is a read result, never an authorization to submit again. */
export interface VerifyResult {
  readonly status: 'published' | 'pending_approval' | 'not_found' | 'unknown';
  readonly evidence?: IntegrationEvidence;
  readonly reasonCode?: OperationReasonCode;
}

export interface StopResult {
  readonly requested: true;
  readonly futureSubmissionsBlocked: true;
  readonly inFlight: 'none' | 'unknown';
  readonly remoteRecall: false;
}

export interface Publisher {
  readonly capabilities: PublisherCapabilities;
  /** Kiểm tra danh tính, quyền, đích, media; chưa xuất bản. */
  prepare(request: PublishRequest): Promise<PrepareResult>;
  submit(request: PublishRequest): Promise<SubmitResult>;
  /** Chỉ đọc, không tạo thêm bài. */
  verify(request: PublishRequest): Promise<VerifyResult>;
  /** Ngăn phần chưa làm; không ngụ ý thu hồi bài đã gửi. */
  stop(): Promise<StopResult>;
}
