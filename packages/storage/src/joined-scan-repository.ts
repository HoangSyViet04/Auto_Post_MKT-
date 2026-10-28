import { randomUUID } from 'node:crypto';
import { BusinessError, type JoinedScanSummary, normalizeGroupReference } from '#domain';
import type { Database } from './db.ts';
import { createGroupRepository } from './group-repository.ts';
import { atomic, identifier, one, type RepositoryOptions, text } from './repository-common.ts';

export interface JoinedScanClaim {
  id: string; accountId: string; identityId: string; expectedIdentity: string; limit: number;
}
export interface ObservedJoinedGroup { reference: string; name?: string | null }
export function createJoinedScanRepository(db: Database, options: RepositoryOptions = {}) {
  const now = options.clock ?? Date.now;
  const groups = createGroupRepository(db, options);
  function current(accountId: string) {
    return one<{ identityId: string; remoteId: string }>(db, `SELECT a.current_identity_id AS identityId,i.remote_identity_id AS remoteId
      FROM accounts a JOIN account_identities i ON i.id=a.current_identity_id AND i.account_id=a.id
      WHERE a.id=? AND a.archived_at IS NULL AND a.paused=0 AND a.session_status='logged_in'`, accountId);
  }
  function owned(id: string, workerId: string): JoinedScanClaim {
    const row = one<JoinedScanClaim>(db, `SELECT s.id,s.account_id AS accountId,s.account_identity_id AS identityId,
      i.remote_identity_id AS expectedIdentity,s.result_limit AS "limit" FROM scan_runs s
      JOIN account_identities i ON i.id=s.account_identity_id WHERE s.id=? AND s.status='running' AND s.claimed_by=?`, id, workerId);
    if (!row) throw new BusinessError('claim_lost');
    return row;
  }
  const repo = {
    enqueue(accountId: string, limit: number): { id: string } {
      identifier(accountId);
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new BusinessError('invalid_input');
      return atomic(db, () => {
        const account = current(accountId);
        if (!account) throw new BusinessError('not_ready');
        const id = randomUUID();
        db.prepare(`INSERT INTO scan_runs(id,account_id,account_identity_id,mode,result_limit,simulated,created_at)
          VALUES(?,?,?,'joined',?,0,?)`).run(id, accountId, account.identityId, limit, now());
        return { id };
      });
    },
    latest(accountId: string): JoinedScanSummary | null {
      identifier(accountId);
      const row = db.prepare(`SELECT s.id,s.account_id AS accountId,s.status,s.result_limit AS "limit",s.reason_code AS reasonCode,
        s.created_at AS createdAt,s.finished_at AS finishedAt,s.without_id_count AS withoutIdCount,
        s.cancel_requested_at IS NOT NULL AS cancelRequested,(SELECT count(*) FROM scan_results r WHERE r.scan_run_id=s.id) AS observedCount
        FROM scan_runs s WHERE account_id=? AND mode='joined' ORDER BY created_at DESC,rowid DESC LIMIT 1`).get(accountId) as unknown as JoinedScanSummary | undefined;
      return row ? { ...row, cancelRequested: !!row.cancelRequested } : null;
    },
    claimNext(workerId: string): JoinedScanClaim | undefined {
      text(workerId, 100);
      return atomic(db, () => {
        const time = now();
        db.prepare(`UPDATE scan_runs SET status='partial',reason_code='worker_lost',finished_at=?
          WHERE mode='joined' AND status='running' AND COALESCE(heartbeat_at,started_at)<?`).run(time, time - 180_000);
        const row = one<{ id: string }>(db, `SELECT s.id FROM scan_runs s WHERE s.mode='joined' AND s.status='queued'
          AND NOT EXISTS(SELECT 1 FROM resource_leases l WHERE l.resource_key='browser:'||s.account_id AND l.expires_at>?)
          ORDER BY s.created_at,s.rowid LIMIT 1`, time);
        if (!row) return undefined;
        db.prepare("UPDATE scan_runs SET status='running',claimed_by=?,started_at=?,heartbeat_at=? WHERE id=? AND status='queued'")
          .run(workerId, time, time, row.id);
        return owned(row.id, workerId);
      });
    },
    heartbeat(id: string, workerId: string): void {
      const changed = db.prepare("UPDATE scan_runs SET heartbeat_at=? WHERE id=? AND status='running' AND claimed_by=?").run(now(), id, workerId).changes;
      if (changed !== 1) throw new BusinessError('claim_lost');
    },
    shouldCancel(claim: JoinedScanClaim): boolean {
      const row = one<{ status: string; cancelled: number }>(db, 'SELECT status,cancel_requested_at IS NOT NULL AS cancelled FROM scan_runs WHERE id=?', claim.id);
      return row?.status !== 'running' || !!row.cancelled || current(claim.accountId)?.identityId !== claim.identityId;
    },
    saveBatch(id: string, workerId: string, items: readonly ObservedJoinedGroup[]): void {
      atomic(db, () => {
        const claim = owned(id, workerId);
        if (repo.shouldCancel(claim)) return;
        let withoutId = 0;
        for (const item of items.slice(0, claim.limit)) {
          const normalized = normalizeGroupReference(item.reference);
          if (!normalized) continue;
          if (!normalized.externalId) { withoutId += 1; continue; }
          const stored = groups.add({ accountId: claim.accountId, reference: normalized.canonicalUrl, name: item.name, membership: 'joined' }, 'joined_scan');
          db.prepare(`INSERT INTO scan_results(id,scan_run_id,destination_id,observed_name,observed_url,observed_external_id,membership_status,observed_at)
            VALUES(?,?,?,?,?,?,'joined',?) ON CONFLICT(scan_run_id,destination_id) DO NOTHING`)
            .run(randomUUID(), id, stored.id, item.name ?? null, normalized.canonicalUrl, normalized.externalId, now());
        }
        db.prepare('UPDATE scan_runs SET without_id_count=? WHERE id=?').run(withoutId, id);
      });
    },
    cancel(id: string): void {
      identifier(id);
      const changed = db.prepare(`UPDATE scan_runs SET cancel_requested_at=?,
        status=CASE WHEN status='queued' THEN 'stopped' ELSE status END,
        finished_at=CASE WHEN status='queued' THEN ? ELSE finished_at END,
        reason_code=CASE WHEN status='queued' THEN 'cancelled' ELSE reason_code END
        WHERE id=? AND mode='joined' AND status IN ('queued','running')`).run(now(), now(), id).changes;
      if (changed !== 1) throw new BusinessError('invalid_transition');
    },
    finish(id: string, workerId: string, status: 'partial' | 'stopped' | 'blocked' | 'failed', reason: string): void {
      if (!['partial', 'stopped', 'blocked', 'failed'].includes(status) || !/^[a-z_]{1,40}$/u.test(reason)) throw new BusinessError('invalid_input');
      const changed = db.prepare("UPDATE scan_runs SET status=?,reason_code=?,finished_at=? WHERE id=? AND status='running' AND claimed_by=?")
        .run(status, reason, now(), id, workerId).changes;
      if (changed !== 1) throw new BusinessError('claim_lost');
    },
  };
  return repo;
}
