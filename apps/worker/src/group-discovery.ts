import { join } from 'node:path';
import type { GroupJoiner, GroupSearchScanner } from '#browser';
import { BusinessError } from '#domain';
import { createAccountRepository, createGroupJoinRepository, createGroupSearchRepository, createLeaseRepository, type Database, type LeaseHandle } from '#storage';

const SESSION_REASONS = { session_expired: 'login_required', checkpoint: 'verification_required', identity_mismatch: 'unknown', network_error: 'network_error' } as const;

/** Chạy lần tìm nhóm theo từ khóa (chỉ đọc). Dùng chung khóa hồ sơ với đăng bài/đăng nhập/quét nhóm đã tham gia. */
export function createGroupSearchRunner(deps: { db: Database; workerId: string; dataDir: string; scan: GroupSearchScanner }) {
  const searches = createGroupSearchRepository(deps.db);
  const accounts = createAccountRepository(deps.db);
  const leases = createLeaseRepository(deps.db);
  return {
    async processNext(): Promise<'idle' | 'processed'> {
      const claim = searches.claimNext(deps.workerId);
      if (!claim) return 'idle';
      let lease: LeaseHandle | undefined;
      let timer: ReturnType<typeof setInterval> | undefined;
      let lost = false;
      const tick = () => {
        searches.heartbeat(claim.id, deps.workerId);
        if (lease) lease = leases.renew(lease, 180_000);
      };
      try {
        if (searches.shouldCancel(claim)) {
          searches.finish(claim.id, deps.workerId, 'stopped', 'account_changed');
          return 'processed';
        }
        lease = leases.acquireBrowser(claim.accountId, `search-${claim.id}`, 180_000);
        timer = setInterval(() => { try { tick(); } catch { lost = true; } }, 5000);
        const result = await deps.scan({ profileDir: join(deps.dataDir, 'profiles', accounts.profileKey(claim.accountId)),
          expectedIdentity: claim.expectedIdentity, keyword: claim.keyword, limit: claim.limit,
          shouldCancel: () => lost || searches.shouldCancel(claim), onTick: tick,
          onBatch: (items) => { tick(); searches.saveBatch(claim.id, deps.workerId, items); },
        });
        const cancelled = searches.shouldCancel(claim);
        searches.finish(claim.id, deps.workerId, cancelled ? 'stopped' : result.status, cancelled ? 'cancelled' : result.reason);
        const next = SESSION_REASONS[result.reason as keyof typeof SESSION_REASONS];
        if (next && !cancelled) accounts.recordSession(claim.accountId, next);
      } catch (error) {
        if (!(error instanceof BusinessError && error.code === 'claim_lost')) {
          try { searches.finish(claim.id, deps.workerId, 'failed', error instanceof BusinessError && error.code === 'conflict' ? 'profile_in_use' : 'scan_error'); } catch { /* already recovered */ }
        }
      } finally {
        if (timer) clearInterval(timer);
        if (lease) { try { leases.release(lease); } catch { /* lease changed */ } }
      }
      return 'processed';
    },
  };
}

/**
 * Gửi từng yêu cầu tham gia nhóm đã đến giờ. Mỗi yêu cầu mở hồ sơ riêng rồi đóng lại. Ghi mốc gửi (và kiểm tra hạn mức lần cuối)
 * ngay trước khi bấm; sau mốc, lỗi bất kỳ chỉ có thể là `unknown`, không bao giờ gửi lại.
 */
export function createGroupJoinRunner(deps: { db: Database; workerId: string; dataDir: string; join: GroupJoiner }) {
  const joins = createGroupJoinRepository(deps.db);
  const accounts = createAccountRepository(deps.db);
  const leases = createLeaseRepository(deps.db);
  return {
    async processNext(): Promise<'idle' | 'processed'> {
      const claim = joins.claimNext(deps.workerId);
      if (!claim) return 'idle';
      let lease: LeaseHandle | undefined;
      let timer: ReturnType<typeof setInterval> | undefined;
      let lost = false;
      let sendStarted = false;
      const tick = () => {
        joins.heartbeat(claim.id, deps.workerId);
        if (lease) lease = leases.renew(lease, 180_000);
      };
      try {
        if (joins.shouldCancel(claim)) {
          joins.finish(claim.id, deps.workerId, 'cancelled', 'cancelled');
          return 'processed';
        }
        lease = leases.acquireBrowser(claim.accountId, `join-${claim.id}`, 180_000);
        timer = setInterval(() => { try { tick(); } catch { lost = true; } }, 5000);
        const result = await deps.join({ profileDir: join(deps.dataDir, 'profiles', accounts.profileKey(claim.accountId)),
          expectedIdentity: claim.expectedIdentity, externalId: claim.externalId,
          shouldCancel: () => lost || joins.shouldCancel(claim), onTick: tick,
          beforeSend: () => { if (lost) return false; sendStarted = joins.markSendStarted(claim.id, deps.workerId); return sendStarted; },
        });
        joins.finish(claim.id, deps.workerId, result.status, result.reason);
        const next = SESSION_REASONS[result.reason as keyof typeof SESSION_REASONS];
        if (next && result.status === 'failed') accounts.recordSession(claim.accountId, next);
      } catch (error) {
        if (!(error instanceof BusinessError && error.code === 'claim_lost')) {
          try {
            if (sendStarted) joins.finish(claim.id, deps.workerId, 'unknown', 'unconfirmed');
            else joins.finish(claim.id, deps.workerId, 'failed', error instanceof BusinessError && error.code === 'conflict' ? 'profile_in_use' : 'join_error');
          } catch { /* already recovered */ }
        }
      } finally {
        if (timer) clearInterval(timer);
        if (lease) { try { leases.release(lease); } catch { /* lease changed */ } }
      }
      return 'processed';
    },
  };
}
