import { randomUUID } from 'node:crypto';
import { BusinessError, DEFAULT_JOIN_SETTINGS, type GroupJoinQuota, type GroupJoinRequestItem, type GroupJoinSettings, type GroupJoinStatus,
  JOIN_BATCH_MAX, JOIN_WINDOW_MS, GROUP_JOIN_STOP_REASONS, joinSettingsProblem } from '#domain';
import type { Database } from './db.ts';
import { atomic, identifier, one, type RepositoryOptions, text } from './repository-common.ts';

export interface GroupJoinClaim {
  id: string; accountId: string; identityId: string; expectedIdentity: string; externalId: string; canonicalUrl: string;
}
export interface GroupJoinRepositoryOptions extends RepositoryOptions {
  /** Số ngẫu nhiên trong [0,1) để chọn khoảng cách giữa hai lần gửi; thay được trong test. */
  random?: () => number;
}

const FINAL: readonly GroupJoinStatus[] = ['requested', 'joined', 'skipped', 'failed', 'unknown', 'cancelled'];
/** Trạng thái tính vào hạn mức: đã gửi, có thể đã gửi (unknown) hoặc đang gửi sau mốc gửi. */
const COUNTED_SQL = "(status IN ('requested','joined','unknown') OR (status='running' AND send_started_at IS NOT NULL))";

/**
 * Yêu cầu tham gia nhóm. Chỉ sinh từ nhóm người dùng tick; mỗi tài khoản có hạn mức trong 24 giờ gần nhất và khoảng cách tối thiểu
 * giữa hai lần gửi. Hạn mức được kiểm tra ở ba nơi: lúc xếp, lúc worker nhận việc và ngay trước khi bấm (`markSendStarted`).
 */
export function createGroupJoinRepository(db: Database, options: GroupJoinRepositoryOptions = {}) {
  const now = options.clock ?? Date.now;
  const random = options.random ?? Math.random;
  function current(accountId: string) {
    return one<{ identityId: string; remoteId: string }>(db, `SELECT a.current_identity_id AS identityId,i.remote_identity_id AS remoteId
      FROM accounts a JOIN account_identities i ON i.id=a.current_identity_id AND i.account_id=a.id
      WHERE a.id=? AND a.archived_at IS NULL AND a.paused=0 AND a.session_status='logged_in'`, accountId);
  }
  function settings(): GroupJoinSettings {
    const row = one<GroupJoinSettings>(db, 'SELECT daily_cap AS dailyCap,min_gap_seconds AS minGapSeconds,max_gap_seconds AS maxGapSeconds FROM group_join_settings WHERE id=1');
    return row ? { ...row } : DEFAULT_JOIN_SETTINGS;
  }
  function sentTimes(accountId: string, since: number): number[] {
    return (db.prepare(`SELECT send_started_at AS t FROM group_join_requests WHERE account_id=? AND send_started_at>? AND ${COUNTED_SQL} ORDER BY send_started_at`)
      .all(accountId, since) as Array<{ t: number }>).map((row) => row.t);
  }
  function quota(accountId: string): GroupJoinQuota {
    const cap = settings().dailyCap;
    const times = sentTimes(accountId, now() - JOIN_WINDOW_MS);
    const remaining = Math.max(0, cap - times.length);
    // Khi hết hạn mức: lúc lần gửi cũ nhất rời khỏi cửa sổ 24 giờ thì có chỗ trống.
    const nextFreeAt = remaining === 0 && times[times.length - cap] !== undefined ? (times[times.length - cap] as number) + JOIN_WINDOW_MS : null;
    const pending = one<{ n: number }>(db, "SELECT count(*) AS n FROM group_join_requests WHERE account_id=? AND status IN ('queued','running') AND send_started_at IS NULL", accountId)?.n ?? 0;
    return { used: times.length, pending, cap, remaining, nextFreeAt };
  }
  function owned(id: string, workerId: string): GroupJoinClaim {
    const row = one<GroupJoinClaim>(db, `SELECT j.id,j.account_id AS accountId,j.account_identity_id AS identityId,i.remote_identity_id AS expectedIdentity,
      j.external_id AS externalId,j.canonical_url AS canonicalUrl FROM group_join_requests j
      JOIN account_identities i ON i.id=j.account_identity_id AND i.account_id=j.account_id WHERE j.id=? AND j.status='running' AND j.claimed_by=?`, id, workerId);
    if (!row) throw new BusinessError('claim_lost');
    return row;
  }
  const repo = {
    settings,
    saveSettings(value: GroupJoinSettings): GroupJoinSettings {
      if (joinSettingsProblem(value) !== null) throw new BusinessError('invalid_input');
      db.prepare('UPDATE group_join_settings SET daily_cap=?,min_gap_seconds=?,max_gap_seconds=?,updated_at=? WHERE id=1')
        .run(value.dailyCap, value.minGapSeconds, value.maxGapSeconds, now());
      return settings();
    },
    quota,
    /**
     * Xếp yêu cầu cho các kết quả tìm kiếm người dùng đã tick. `maxCount` là số nhóm người dùng muốn gửi lượt này; tick nhiều hơn bị từ chối.
     * Yêu cầu đầu chạy ngay (hoặc sau khoảng cách tối thiểu kể từ lần gửi gần nhất), các yêu cầu sau cách nhau ngẫu nhiên.
     */
    enqueue(input: { accountId: string; searchResultIds: readonly string[]; maxCount: number }): { batchId: string; count: number; firstAt: number } {
      identifier(input.accountId);
      const ids = [...new Set(input.searchResultIds)];
      for (const id of ids) identifier(id);
      if (ids.length === 0 || ids.length !== input.searchResultIds.length || ids.length > JOIN_BATCH_MAX
        || !Number.isInteger(input.maxCount) || input.maxCount < 1 || input.maxCount > JOIN_BATCH_MAX || ids.length > input.maxCount) throw new BusinessError('invalid_input');
      return atomic(db, () => {
        const account = current(input.accountId);
        if (!account) throw new BusinessError('not_ready');
        const rows = ids.map((id) => one<{ externalId: string; canonicalUrl: string; name: string | null; joinState: string }>(db,
          `SELECT r.external_id AS externalId,r.canonical_url AS canonicalUrl,r.name,r.join_state AS joinState FROM group_search_results r
           JOIN scan_runs s ON s.id=r.scan_run_id WHERE r.id=? AND s.account_id=? AND s.mode='keyword'`, id, input.accountId));
        for (const row of rows) {
          if (!row) throw new BusinessError('not_found');
          if (row.joinState !== 'can_join') throw new BusinessError('invalid_input');
          const prior = one<{ n: number }>(db, "SELECT count(*) AS n FROM group_join_requests WHERE account_id=? AND external_id=? AND status IN ('queued','running','requested','joined','unknown')", input.accountId, row.externalId);
          if (prior && prior.n > 0) throw new BusinessError('conflict');
        }
        const rule = settings();
        const room = quota(input.accountId);
        if (room.remaining - room.pending < ids.length) throw new BusinessError('join_limit'); // yêu cầu đã xếp mà chưa gửi cũng chiếm chỗ
        const time = now();
        const lastSent = sentTimes(input.accountId, time - JOIN_WINDOW_MS).at(-1);
        let at = Math.max(time, lastSent === undefined ? 0 : lastSent + rule.minGapSeconds * 1000);
        const batchId = randomUUID();
        const firstAt = at;
        rows.forEach((row, index) => {
          if (!row) return;
          if (index > 0) at += Math.round((rule.minGapSeconds + random() * (rule.maxGapSeconds - rule.minGapSeconds)) * 1000);
          db.prepare(`INSERT INTO group_join_requests(id,batch_id,account_id,account_identity_id,external_id,canonical_url,name,not_before,created_at)
            VALUES(?,?,?,?,?,?,?,?,?)`).run(randomUUID(), batchId, input.accountId, account.identityId, row.externalId, row.canonicalUrl, row.name, at, time);
        });
        return { batchId, count: ids.length, firstAt };
      });
    },
    list(accountId: string, limit = 50): GroupJoinRequestItem[] {
      identifier(accountId);
      return db.prepare(`SELECT id,batch_id AS batchId,external_id AS externalId,canonical_url AS canonicalUrl,name,status,reason_code AS reasonCode,
        not_before AS notBefore,send_started_at AS sentAt,finished_at AS finishedAt,created_at AS createdAt
        FROM group_join_requests WHERE account_id=? ORDER BY created_at DESC,not_before DESC,rowid DESC LIMIT ?`).all(accountId, Math.min(Math.max(1, limit), 200)) as unknown as GroupJoinRequestItem[];
    },
    /** Nhận một yêu cầu đã đến giờ, của tài khoản không bận trình duyệt, đủ khoảng cách và còn hạn mức. */
    claimNext(workerId: string): GroupJoinClaim | undefined {
      text(workerId, 100);
      return atomic(db, () => {
        const time = now();
        // Worker mất giữa chừng: đã qua mốc gửi thì không rõ kết quả (không gửi lại), chưa qua thì coi là lỗi chưa gửi.
        db.prepare(`UPDATE group_join_requests SET status=CASE WHEN send_started_at IS NULL THEN 'failed' ELSE 'unknown' END,reason_code='worker_lost',finished_at=?
          WHERE status='running' AND COALESCE(heartbeat_at,send_started_at,created_at)<?`).run(time, time - 180_000);
        const rule = settings();
        const candidates = db.prepare(`SELECT j.id,j.account_id AS accountId FROM group_join_requests j WHERE j.status='queued' AND j.not_before<=?
          AND NOT EXISTS(SELECT 1 FROM resource_leases l WHERE l.resource_key='browser:'||j.account_id AND l.expires_at>?)
          ORDER BY j.not_before,j.rowid`).all(time, time) as Array<{ id: string; accountId: string }>;
        for (const candidate of candidates) {
          if (quota(candidate.accountId).remaining <= 0) {
            db.prepare("UPDATE group_join_requests SET status='skipped',reason_code='daily_cap',finished_at=? WHERE id=? AND status='queued'").run(time, candidate.id);
            continue;
          }
          const lastSent = sentTimes(candidate.accountId, time - rule.minGapSeconds * 1000).at(-1);
          if (lastSent !== undefined) continue; // chưa đủ khoảng cách; vòng sau thử lại
          const busy = one<{ n: number }>(db, "SELECT count(*) AS n FROM group_join_requests WHERE account_id=? AND status='running'", candidate.accountId);
          if (busy && busy.n > 0) continue;
          db.prepare("UPDATE group_join_requests SET status='running',claimed_by=?,heartbeat_at=? WHERE id=? AND status='queued'").run(workerId, time, candidate.id);
          return owned(candidate.id, workerId);
        }
        return undefined;
      });
    },
    heartbeat(id: string, workerId: string): void {
      const changed = db.prepare("UPDATE group_join_requests SET heartbeat_at=? WHERE id=? AND status='running' AND claimed_by=?").run(now(), id, workerId).changes;
      if (changed !== 1) throw new BusinessError('claim_lost');
    },
    shouldCancel(claim: GroupJoinClaim): boolean {
      const row = one<{ status: string; cancelled: number }>(db, 'SELECT status,cancel_requested_at IS NOT NULL AS cancelled FROM group_join_requests WHERE id=?', claim.id);
      return row?.status !== 'running' || !!row.cancelled || current(claim.accountId)?.identityId !== claim.identityId;
    },
    /**
     * Ghi mốc gửi ngay trước khi bấm "Tham gia". Trả false (và không ghi) nếu hạn mức/khoảng cách không còn đủ hoặc đã bị hủy;
     * khi đó worker không bấm. Từ mốc này, mất kết nối chỉ có thể là `unknown`, không bao giờ gửi lại.
     */
    markSendStarted(id: string, workerId: string): boolean {
      return atomic(db, () => {
        const claim = owned(id, workerId);
        if (repo.shouldCancel(claim)) return false;
        const rule = settings();
        const time = now();
        if (quota(claim.accountId).remaining <= 0) return false;
        if (sentTimes(claim.accountId, time - rule.minGapSeconds * 1000).length > 0) return false;
        db.prepare('UPDATE group_join_requests SET send_started_at=? WHERE id=? AND send_started_at IS NULL').run(time, id);
        return true;
      });
    },
    finish(id: string, workerId: string, status: GroupJoinStatus, reason: string | null): void {
      if (!FINAL.includes(status) || (reason !== null && !/^[a-z_]{1,40}$/u.test(reason))) throw new BusinessError('invalid_input');
      atomic(db, () => {
        const claim = owned(id, workerId);
        const time = now();
        db.prepare("UPDATE group_join_requests SET status=?,reason_code=?,finished_at=? WHERE id=? AND status='running' AND claimed_by=?").run(status, reason, time, id, workerId);
        if (reason && GROUP_JOIN_STOP_REASONS.includes(reason)) {
          db.prepare("UPDATE group_join_requests SET status='skipped',reason_code='batch_stopped',finished_at=? WHERE account_id=? AND status='queued'").run(time, claim.accountId);
        }
      });
    },
    /** Hủy một yêu cầu: đang chờ thì hủy ngay; đang chạy thì yêu cầu dừng (chặn nếu chưa tới mốc gửi). */
    cancel(id: string): void {
      identifier(id);
      const time = now();
      const changed = db.prepare(`UPDATE group_join_requests SET cancel_requested_at=?,
        status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END,
        finished_at=CASE WHEN status='queued' THEN ? ELSE finished_at END,
        reason_code=CASE WHEN status='queued' THEN 'cancelled' ELSE reason_code END
        WHERE id=? AND status IN ('queued','running')`).run(time, time, id).changes;
      if (changed !== 1) throw new BusinessError('invalid_transition');
    },
    /** Hủy mọi yêu cầu còn chờ của tài khoản (không đụng yêu cầu đang chạy hoặc đã gửi). */
    cancelQueued(accountId: string): number {
      identifier(accountId);
      return db.prepare("UPDATE group_join_requests SET status='cancelled',reason_code='cancelled',finished_at=? WHERE account_id=? AND status='queued'")
        .run(now(), accountId).changes as number;
    },
  };
  return repo;
}
