import type { ApprovedPublishRequest, Publisher, SubmitResult } from '#contracts';
import { BusinessError, type Channel, type IntegrationMode } from '#domain';
import {
  type Completion,
  createAccountRepository,
  createJobRepository,
  createLeaseRepository,
  type createMediaStore,
  type Database,
  type JobClaim,
  type LeaseHandle,
} from '#storage';

export type FailureReason = NonNullable<Completion['reasonCode']>;

export interface JobRunnerDeps {
  db: Database;
  workerId: string;
  mode: IntegrationMode;
  publishers: Record<Channel, Publisher>;
  media: ReturnType<typeof createMediaStore>;
  clock?: () => number;
  /** Chính sách vận hành (không phải ngưỡng chống khóa nick): tối thiểu bao lâu giữa hai lần đăng của CÙNG một tài khoản. */
  minGapMs?: number;
  /** Job hẹn trễ hơn ngưỡng này không tự chạy; người dùng chọn tiếp tục hoặc bỏ. */
  overdueAfterMs?: number;
  claimLeaseMs?: number;
  browserLeaseMs?: number;
  /**
   * Kiểm tra trước khi gửi (adapter thật): xác nhận phiên và danh tính. Trả null nếu ổn, ngược lại trả mã lý do để dừng
   * TRƯỚC mốc gửi. Chế độ giả không cần.
   */
  preflight?: (input: { accountId: string; expectedIdentity: string }) => Promise<FailureReason | null>;
  log?: { info(fields: Record<string, unknown>, message: string): void; error(fields: Record<string, unknown>, message: string): void };
}

const SESSION_AFTER: Partial<Record<FailureReason, 'login_required' | 'verification_required' | 'unknown' | 'network_error'>> = {
  session_expired: 'login_required',
  checkpoint: 'verification_required',
  identity_mismatch: 'unknown',
  network_error: 'network_error',
};

/**
 * Chạy job đến hạn: nhận có điều kiện → giữ khóa trình duyệt của tài khoản → kiểm tra trước gửi → ghi MỐC GỬI → gửi đúng một lần →
 * ghi kết quả. Sau mốc gửi không bao giờ tự gửi lại; không rõ kết quả thì `unknown`. Mỗi tài khoản chạy tuần tự.
 */
export function createJobRunner(deps: JobRunnerDeps) {
  const clockOptions = deps.clock ? { clock: deps.clock } : {};
  const now = deps.clock ?? Date.now;
  const jobs = createJobRepository(deps.db, clockOptions);
  const accounts = createAccountRepository(deps.db, clockOptions);
  const leases = createLeaseRepository(deps.db, clockOptions);
  const claimLeaseMs = deps.claimLeaseMs ?? 60_000;
  const browserLeaseMs = deps.browserLeaseMs ?? 180_000;
  const minGapMs = deps.minGapMs ?? 0;
  /** Nguồn bằng chứng: giả; fanpage qua API của Meta; nhóm/trang cá nhân qua quan sát trình duyệt. */
  const sourceFor = (channel: Channel): Completion['source'] => (deps.mode === 'fake' ? 'fake' : channel === 'page' ? 'api_response' : 'ui_observation');

  function toCompletion(result: SubmitResult, source: Completion['source']): Completion {
    switch (result.status) {
      case 'published': return { outcome: 'published', source, remoteId: result.remoteId, ...(result.evidence?.remoteUrl ? { remoteUrl: result.evidence.remoteUrl } : {}) };
      case 'pending_approval': return { outcome: 'pending_approval', source, ...(result.remoteId ? { remoteId: result.remoteId } : {}) };
      case 'failed': return { outcome: 'failed', source, reasonCode: (result.reasonCode as FailureReason | undefined) ?? 'unknown' };
      default: return { outcome: 'unknown', source, reasonCode: (result.reasonCode as FailureReason | undefined) ?? 'unknown' };
    }
  }

  async function run(claim: JobClaim): Promise<void> {
    let browserLease: LeaseHandle | undefined;
    const timer = setInterval(() => {
      try {
        jobs.renewClaim(claim, claimLeaseMs);
        if (browserLease) browserLease = leases.renew(browserLease, browserLeaseMs);
      } catch { /* mất quyền: lần ghi tiếp theo sẽ báo claim_lost và job được khôi phục theo mốc gửi */ }
    }, Math.max(1_000, Math.floor(claimLeaseMs / 3)));
    try {
      let snapshot: ReturnType<typeof jobs.getApprovedSnapshot>;
      try {
        snapshot = jobs.getApprovedSnapshot(claim);
      } catch (error) {
        // Điều kiện đã đổi từ lúc nhận (tài khoản tạm dừng, bản duyệt bị thu hồi...): trả về hàng chờ, lần nhận sau sẽ phân loại đúng trạng thái.
        if (error instanceof BusinessError) { jobs.abandon(claim); deps.log?.info({ code: error.code }, 'Job không còn đủ điều kiện, trả về hàng chờ'); return; }
        throw error;
      }
      const source = sourceFor(snapshot.context.destination.channel);
      const accountId = snapshot.context.expectedIdentity.kind === 'account' ? snapshot.context.expectedIdentity.localId : null;
      if (accountId) {
        try {
          browserLease = leases.acquireBrowser(accountId, deps.workerId, browserLeaseMs);
        } catch (error) {
          if (error instanceof BusinessError && error.code === 'conflict') { jobs.abandon(claim); return; } // hồ sơ đang bận (đăng nhập tay...)
          throw error;
        }
      }
      const fail = (reasonCode: FailureReason) => {
        jobs.finish(claim, { outcome: 'failed', source, reasonCode });
        jobs.logActivity(claim.jobId, 'warn', 'job_failed_before_send', reasonCode);
        const session = SESSION_AFTER[reasonCode];
        if (accountId && session) accounts.recordSession(accountId, session); // chặn các job tiếp theo của ĐÚNG tài khoản này
      };

      let mediaPaths: string[];
      try {
        mediaPaths = await deps.media.resolveForPublish(snapshot.media.map((item) => item.id));
      } catch {
        fail('media_invalid'); // ảnh mất/hỏng: không âm thầm đăng chỉ có chữ
        return;
      }
      const request: ApprovedPublishRequest = { jobId: snapshot.jobId, destinationId: snapshot.destinationId, caption: snapshot.caption,
        mediaPaths, context: snapshot.context };
      const publisher = deps.publishers[snapshot.context.destination.channel];

      if (deps.preflight && accountId) {
        const problem = await deps.preflight({ accountId, expectedIdentity: snapshot.context.expectedIdentity.remoteId });
        if (problem) { fail(problem); return; }
      }
      const prepared = await publisher.prepare(request);
      if (!prepared.ok) { fail(prepared.reasonCode === 'stopped' ? 'unknown' : (prepared.reasonCode as FailureReason)); return; }

      try {
        jobs.markSendStarted(claim); // ghi mốc TRƯỚC khi gửi; nếu điều kiện đổi hoặc có yêu cầu dừng thì job kết thúc ở đây, không gửi
      } catch (error) {
        if (error instanceof BusinessError) { deps.log?.info({ code: error.code }, 'Không gửi: điều kiện đổi hoặc có yêu cầu dừng'); return; }
        throw error;
      }
      jobs.logActivity(claim.jobId, 'info', 'send_started');
      let completion: Completion;
      try {
        completion = toCompletion(await publisher.submit(request), source); // đúng MỘT lần
      } catch {
        completion = { outcome: 'unknown', source, reasonCode: 'unknown' }; // có thể đã gửi: không thử lại, chờ đối chiếu
      }
      jobs.finish(claim, completion);
      jobs.logActivity(claim.jobId, completion.outcome === 'published' ? 'info' : 'warn', `job_${completion.outcome}`, completion.reasonCode);
      const session = completion.reasonCode ? SESSION_AFTER[completion.reasonCode] : undefined;
      if (accountId && session) accounts.recordSession(accountId, session);
      deps.log?.info({ outcome: completion.outcome, reason: completion.reasonCode ?? null }, 'Job kết thúc');
    } finally {
      clearInterval(timer);
      if (browserLease) {
        try { leases.release(browserLease); } catch { /* khóa đã hết hạn hoặc đổi chủ */ }
      }
    }
  }

  return {
    /** Khôi phục job chạy dở của worker đã chết, rồi xử lý tối đa một job đến hạn. */
    async processNext(): Promise<'idle' | 'processed'> {
      jobs.recoverExpired(deps.mode); // trước gửi → paused, sau gửi → unknown; không tự nhận lại
      const claim = jobs.claimNext(deps.workerId, deps.mode, claimLeaseMs, {
        ...(deps.overdueAfterMs === undefined ? {} : { overdueAfterMs: deps.overdueAfterMs }),
        eligible: ({ accountId }) => {
          if (!accountId) return true;
          if (leases.isBrowserBusy(accountId) || jobs.hasRunningJob(accountId)) return false; // tuần tự trong từng tài khoản
          const last = jobs.lastSendStartedAt(accountId);
          return last === null || now() - last >= minGapMs; // giãn cách giữa hai lần đăng cùng tài khoản
        },
      });
      if (!claim) return 'idle';
      try {
        await run(claim);
      } catch (error) {
        // Lỗi ngoài dự kiến: nếu chưa gửi thì job được khôi phục theo mốc (recoverExpired), không ghi đè kết quả.
        deps.log?.error({ errorName: error instanceof Error ? error.name : 'unknown' }, 'Lỗi khi chạy job');
      }
      return 'processed';
    },
  };
}
