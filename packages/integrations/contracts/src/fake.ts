/** Adapter giả: chạy hoàn toàn trong bộ nhớ, không gọi mạng/Facebook/LLM. */
import type { Channel } from '#domain';
import { assertApprovedPublishRequest, type IntegrationEvidence, type PrepareResult, type Publisher,
  type PublishRequest, type SubmitResult, type VerifyResult } from './publisher.ts';

export interface FakePublisherOptions {
  /** Kịch bản kết quả gửi; mặc định published với remoteId giả. */
  submit?: (request: PublishRequest) => SubmitResult;
  prepare?: (request: PublishRequest) => PrepareResult;
}

export interface FakePublisher extends Publisher {
  /** Các job đã submit, theo thứ tự, để test kiểm tra. */
  readonly submitted: readonly PublishRequest[];
}

export function createFakePublisher(channel: Channel, options: FakePublisherOptions = {}): FakePublisher {
  const decide = options.submit ?? ((request) => ({ status: 'published', remoteId: `fake-${channel}-${request.jobId}` }));
  const submitted: PublishRequest[] = [];
  const results = new Map<string, { request: PublishRequest; result: SubmitResult }>();
  let stopped = false;

  function snapshot(request: PublishRequest): PublishRequest {
    if (request.context) assertApprovedPublishRequest(request);
    const context = request.context ? Object.freeze({ ...request.context,
      expectedIdentity: Object.freeze({ ...request.context.expectedIdentity }),
      destination: Object.freeze({ ...request.context.destination }),
    }) : undefined;
    return Object.freeze({ jobId: request.jobId, destinationId: request.destinationId, caption: request.caption,
      mediaPaths: Object.freeze([...request.mediaPaths]), ...(context ? { context } : {}) });
  }

  function fingerprint(request: PublishRequest): string {
    const c = request.context;
    return JSON.stringify([request.jobId, request.destinationId, request.caption, request.mediaPaths,
      c ? [c.requestId, c.approvalId, c.contentVersionId, c.expectedIdentity.kind, c.expectedIdentity.localId,
        c.expectedIdentity.remoteId, c.destination.channel, c.destination.remoteId] : null]);
  }

  function evidence(request?: PublishRequest): IntegrationEvidence {
    return Object.freeze({ source: 'simulated', observedAt: new Date().toISOString(),
      ...(request?.context ? {
        identityRemoteId: request.context.expectedIdentity.remoteId,
        destinationRemoteId: request.context.destination.remoteId,
      } : {}),
    });
  }

  function prepare(request: PublishRequest): PrepareResult {
    if (stopped) return { ok: false, reasonCode: 'stopped', reason: 'Đã dừng' };
    if (request.context) {
      try { assertApprovedPublishRequest(request); }
      catch { return { ok: false, reasonCode: 'invalid_request', reason: 'Context đã duyệt không hợp lệ' }; }
      if (request.context.destination.channel !== channel) {
        return { ok: false, reasonCode: 'destination_not_allowed', reason: 'Kênh đích không khớp adapter' };
      }
    }
    return options.prepare?.(request) ?? { ok: true };
  }

  return {
    capabilities: Object.freeze({ channel, level: 'automatic', simulated: true }),
    get submitted() { return Object.freeze([...submitted]); },

    async prepare(request) { return prepare(request); },

    async submit(request) {
      const prepared = prepare(request);
      if (!prepared.ok) return { status: 'failed', reason: prepared.reason,
        reasonCode: prepared.reasonCode, evidence: evidence() };
      const saved = snapshot(request);
      submitted.push(saved);
      let decided: SubmitResult;
      try { decided = decide(saved); }
      catch { decided = { status: 'unknown', reasonCode: 'unknown', reason: 'Fixture gửi không có kết quả xác định' }; }
      const result = Object.freeze({ ...decided, evidence: evidence(saved) });
      results.set(saved.jobId, { request: saved, result });
      return result;
    },

    async verify(request): Promise<VerifyResult> {
      const saved = results.get(request.jobId);
      if (!saved) return { status: 'not_found', evidence: evidence() };
      let matches = false;
      try { matches = fingerprint(saved.request) === fingerprint(request); } catch { /* malformed context is a mismatch */ }
      if (!matches) {
        return { status: 'unknown', reasonCode: 'request_mismatch', evidence: evidence() };
      }
      return { status: saved.result.status === 'failed' ? 'not_found' : saved.result.status,
        evidence: evidence(saved.request), ...(saved.result.reasonCode ? { reasonCode: saved.result.reasonCode } : {}) };
    },

    async stop() {
      stopped = true;
      return Object.freeze({ requested: true, futureSubmissionsBlocked: true, inFlight: 'none', remoteRecall: false });
    },
  };
}
