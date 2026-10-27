import type { ScanObservation, ScanReasonCode, ScanRequest, ScanResult, Scanner } from './scanner.ts';
import { assertScanRequest } from './scanner.ts';

export type FakeScanObservation = Pick<ScanObservation, 'accountId' | 'url'>
  & Partial<Omit<ScanObservation, 'accountId' | 'url' | 'source'>>;

export interface FakeScannerOptions {
  readonly observations?: readonly FakeScanObservation[];
  readonly status?: ScanResult['status'];
  readonly reasonCode?: ScanReasonCode;
}

function observation(input: FakeScanObservation): ScanObservation {
  if (typeof input.accountId !== 'string' || !input.accountId.trim() || typeof input.url !== 'string') {
    throw new Error('Fixture observation thiếu tài khoản/link.');
  }
  let url: URL;
  try { url = new URL(input.url); } catch { throw new Error('Fixture observation link không hợp lệ.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Fixture observation link không hợp lệ.');
  }
  if (input.groupId !== undefined && (typeof input.groupId !== 'string' || !input.groupId.trim())) {
    throw new Error('Fixture observation groupId không hợp lệ.');
  }
  if ((input.name !== undefined && typeof input.name !== 'string')
    || (input.description !== undefined && typeof input.description !== 'string')) {
    throw new Error('Fixture observation tên/mô tả không hợp lệ.');
  }
  if (input.memberCount !== undefined && (!Number.isSafeInteger(input.memberCount) || input.memberCount < 0)) {
    throw new Error('Fixture observation memberCount không hợp lệ.');
  }
  const observedAt = input.observedAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(observedAt))) throw new Error('Fixture observation observedAt không hợp lệ.');
  const visibility = input.visibility ?? 'unknown';
  const membership = input.membership ?? 'unknown';
  const postingPermission = input.postingPermission ?? 'unknown';
  const approvalRequired = input.approvalRequired ?? 'unknown';
  if (!['public', 'private', 'unknown'].includes(visibility)
    || !['joined', 'not_joined', 'unknown'].includes(membership)
    || !['allowed', 'denied', 'unknown'].includes(postingPermission)
    || !['yes', 'no', 'unknown'].includes(approvalRequired)) throw new Error('Fixture observation trạng thái không hợp lệ.');
  return Object.freeze({ accountId: input.accountId, url: url.href, source: 'simulated', observedAt,
    visibility, membership, postingPermission, approvalRequired,
    ...(input.groupId !== undefined ? { groupId: input.groupId } : {}),
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.memberCount !== undefined ? { memberCount: input.memberCount } : {}),
  });
}

/** Fixture-only scanner: no browser, network, inference, or DB side effects. */
export function createFakeScanner(options: FakeScannerOptions = {}): Scanner {
  const observations = Object.freeze((options.observations ?? []).map(observation));
  const fixtureStatus = options.status ?? 'completed';
  const fixtureReason = options.reasonCode;
  if (!['completed', 'partial', 'stopped', 'blocked', 'failed'].includes(fixtureStatus)) {
    throw new Error('Fixture scanner status không hợp lệ.');
  }
  if (fixtureReason !== undefined && !['stopped', 'invalid_request', 'session_expired', 'checkpoint',
    'identity_mismatch', 'destination_not_allowed', 'media_invalid', 'unsupported', 'request_mismatch',
    'network_error', 'ui_changed', 'unknown', 'result_limit', 'fixture_partial'].includes(fixtureReason)) {
    throw new Error('Fixture scanner reasonCode không hợp lệ.');
  }
  let stopped = false;

  return {
    capabilities: Object.freeze({ modes: Object.freeze(['joined', 'keyword'] as const), level: 'automatic', simulated: true }),
    async scan(request: ScanRequest): Promise<ScanResult> {
      assertScanRequest(request);
      if (observations.some((item) => item.accountId !== request.accountId)) {
        throw new Error('Fixture observation tài khoản không khớp scan request.');
      }
      const limited = observations.length > request.resultLimit;
      const status = stopped ? 'stopped' : fixtureStatus === 'completed' && limited ? 'partial' : fixtureStatus;
      const results = Object.freeze(stopped ? [] : observations.slice(0, request.resultLimit));
      const reasonCode = stopped ? 'stopped' : fixtureReason ?? (limited ? 'result_limit'
        : status === 'partial' ? 'fixture_partial' : status === 'stopped' ? 'stopped'
        : status === 'blocked' || status === 'failed' ? 'unknown' : undefined);
      return Object.freeze({ runId: request.runId, accountId: request.accountId, status, results,
        scopeComplete: status === 'completed', observedCount: results.length, ...(reasonCode ? { reasonCode } : {}),
      });
    },
    async stop() {
      stopped = true;
      return Object.freeze({ requested: true, futureSubmissionsBlocked: true, inFlight: 'none', remoteRecall: false });
    },
  };
}
