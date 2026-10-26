/** Adapter giả: chạy hoàn toàn trong bộ nhớ, không gọi mạng/Facebook/LLM. */
import type { Channel } from '#domain';
import type { Publisher, PublishRequest, SubmitResult, VerifyResult } from './publisher.ts';

export interface FakePublisherOptions {
  /** Kịch bản kết quả gửi; mặc định published với remoteId giả. */
  submit?: (request: PublishRequest) => SubmitResult;
}

export interface FakePublisher extends Publisher {
  /** Các job đã submit, theo thứ tự, để test kiểm tra. */
  readonly submitted: readonly PublishRequest[];
}

export function createFakePublisher(channel: Channel, options: FakePublisherOptions = {}): FakePublisher {
  const decide = options.submit ?? ((request) => ({ status: 'published', remoteId: `fake-${channel}-${request.jobId}` }));
  const submitted: PublishRequest[] = [];
  const results = new Map<string, SubmitResult>();
  let stopped = false;

  return {
    capabilities: { channel, level: 'automatic', simulated: true },
    submitted,

    async prepare() {
      return stopped ? { ok: false, reason: 'Đã dừng' } : { ok: true };
    },

    async submit(request) {
      if (stopped) return { status: 'failed', reason: 'Đã dừng trước khi gửi' };
      submitted.push(request);
      const result = decide(request);
      results.set(request.jobId, result);
      return result;
    },

    async verify(request): Promise<VerifyResult> {
      const result = results.get(request.jobId);
      if (!result || result.status === 'failed') return { status: 'not_found' };
      return { status: result.status };
    },

    async stop() {
      stopped = true;
    },
  };
}
