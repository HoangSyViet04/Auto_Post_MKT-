import { join } from 'node:path';
import type { JoinedGroupScanner } from '#browser';
import { BusinessError } from '#domain';
import { createAccountRepository, createJoinedScanRepository, createLeaseRepository, type Database, type LeaseHandle } from '#storage';

export function createJoinedScanRunner(deps: { db: Database; workerId: string; dataDir: string; scan: JoinedGroupScanner }) {
  const scans = createJoinedScanRepository(deps.db);
  const accounts = createAccountRepository(deps.db);
  const leases = createLeaseRepository(deps.db);
  return {
    async processNext(): Promise<'idle' | 'processed'> {
      const claim = scans.claimNext(deps.workerId);
      if (!claim) return 'idle';
      let lease: LeaseHandle | undefined;
      let timer: ReturnType<typeof setInterval> | undefined;
      let lost = false;
      const tick = () => {
        scans.heartbeat(claim.id, deps.workerId);
        if (lease) lease = leases.renew(lease, 180_000);
      };
      try {
        if (scans.shouldCancel(claim)) {
          scans.finish(claim.id, deps.workerId, 'stopped', 'account_changed');
          return 'processed';
        }
        lease = leases.acquireBrowser(claim.accountId, `scan-${claim.id}`, 180_000);
        timer = setInterval(() => { try { tick(); } catch { lost = true; } }, 5000);
        const result = await deps.scan({ profileDir: join(deps.dataDir, 'profiles', accounts.profileKey(claim.accountId)),
          expectedIdentity: claim.expectedIdentity, limit: claim.limit,
          shouldCancel: () => lost || scans.shouldCancel(claim), onTick: tick,
          onBatch: (items) => { tick(); scans.saveBatch(claim.id, deps.workerId, items); },
        });
        const cancelled = scans.shouldCancel(claim);
        scans.finish(claim.id, deps.workerId, cancelled ? 'stopped' : result.status, cancelled ? 'cancelled' : result.reason);
        const session = { session_expired: 'login_required', checkpoint: 'verification_required', identity_mismatch: 'unknown', network_error: 'network_error' } as const;
        const next = session[result.reason as keyof typeof session];
        if (next && !cancelled) accounts.recordSession(claim.accountId, next);
      } catch (error) {
        if (!(error instanceof BusinessError && error.code === 'claim_lost')) {
          try { scans.finish(claim.id, deps.workerId, 'failed', error instanceof BusinessError && error.code === 'conflict' ? 'profile_in_use' : 'scan_error'); } catch { /* already recovered */ }
        }
      } finally {
        if (timer) clearInterval(timer);
        if (lease) { try { leases.release(lease); } catch { /* lease changed */ } }
      }
      return 'processed';
    },
  };
}
