import type { AutomationLevel, OperationReasonCode, StopResult } from './publisher.ts';

interface ScanRequestBase {
  readonly runId: string;
  readonly accountId: string;
  readonly expectedIdentityRemoteId: string;
  /** Bounded local scope, never a claim to enumerate all Facebook groups. */
  readonly resultLimit: number;
}

export type ScanRequest = ScanRequestBase & (
  { readonly mode: 'joined' } | { readonly mode: 'keyword'; readonly keyword: string }
);

export interface ScanObservation {
  readonly groupId?: string;
  readonly url: string;
  readonly name?: string;
  readonly description?: string;
  readonly visibility: 'public' | 'private' | 'unknown';
  readonly memberCount?: number;
  readonly observedAt: string;
  readonly accountId: string;
  readonly source: 'simulated' | 'joined_ui' | 'keyword_ui';
  readonly membership: 'joined' | 'not_joined' | 'unknown';
  readonly postingPermission: 'allowed' | 'denied' | 'unknown';
  readonly approvalRequired: 'yes' | 'no' | 'unknown';
}

export type ScanReasonCode = OperationReasonCode | 'result_limit' | 'fixture_partial';

export interface ScanResult {
  readonly runId: string;
  readonly accountId: string;
  readonly status: 'completed' | 'partial' | 'stopped' | 'blocked' | 'failed';
  readonly results: readonly ScanObservation[];
  /** True only for this requested scope, not for all groups on Facebook. */
  readonly scopeComplete: boolean;
  readonly observedCount: number;
  readonly reasonCode?: ScanReasonCode;
}

export interface Scanner {
  readonly capabilities: {
    readonly modes: readonly ['joined', 'keyword'];
    readonly level: AutomationLevel;
    readonly simulated: boolean;
  };
  scan(request: ScanRequest): Promise<ScanResult>;
  stop(): Promise<StopResult>;
}

export const MAX_SCAN_RESULTS = 1_000;

export function assertScanRequest(value: unknown): asserts value is ScanRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Scan request không hợp lệ.');
  const request = value as Record<string, unknown>;
  const text = (input: unknown) => typeof input === 'string' && input.trim().length > 0;
  if (!text(request.runId) || !text(request.accountId) || !text(request.expectedIdentityRemoteId)
    || typeof request.resultLimit !== 'number' || !Number.isInteger(request.resultLimit)
    || request.resultLimit < 1 || request.resultLimit > MAX_SCAN_RESULTS
    || (request.mode !== 'joined' && request.mode !== 'keyword')
    || (request.mode === 'keyword' && !text(request.keyword))) throw new Error('Scan request không hợp lệ.');
}
