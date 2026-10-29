import { randomUUID } from 'node:crypto';
import { BusinessError, type GroupJoinState, type GroupJoinStatus, type GroupPrivacy, type GroupSearchResultItem, type GroupSearchSummary, normalizeGroupReference, SEARCH_KEYWORD_MAX, SEARCH_LIMIT_MAX } from '#domain';
import type { Database } from './db.ts';
import { atomic, identifier, one, type RepositoryOptions, text } from './repository-common.ts';

export interface GroupSearchClaim {
  id: string; accountId: string; identityId: string; expectedIdentity: string; keyword: string; limit: number;
}
export interface ObservedSearchGroup {
  reference: string; name: string | null; privacy: GroupPrivacy; memberCount: number | null; joinState: GroupJoinState;
}

/** Gọn khoảng trắng, bỏ ký tự điều khiển; null nếu không hợp lệ. */
export function cleanKeyword(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: loại ký tự điều khiển khỏi từ khóa
  const keyword = value.replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim();
  return keyword.length >= 2 && keyword.length <= SEARCH_KEYWORD_MAX ? keyword : null;
}

/** Tìm nhóm theo từ khóa: chỉ đọc kết quả, lưu thành danh sách ứng viên. Không tạo nhóm đích, không cấp quyền đăng. */
export function createGroupSearchRepository(db: Database, options: RepositoryOptions = {}) {
  const now = options.clock ?? Date.now;
  function current(accountId: string) {
    return one<{ identityId: string }>(db, `SELECT a.current_identity_id AS identityId FROM accounts a
      JOIN account_identities i ON i.id=a.current_identity_id AND i.account_id=a.id
      WHERE a.id=? AND a.archived_at IS NULL AND a.paused=0 AND a.session_status='logged_in'`, accountId);
  }
  function owned(id: string, workerId: string): GroupSearchClaim {
    const row = one<GroupSearchClaim>(db, `SELECT s.id,s.account_id AS accountId,s.account_identity_id AS identityId,
      i.remote_identity_id AS expectedIdentity,s.keyword,s.result_limit AS "limit" FROM scan_runs s
      JOIN account_identities i ON i.id=s.account_identity_id WHERE s.id=? AND s.mode='keyword' AND s.status='running' AND s.claimed_by=?`, id, workerId);
    if (!row) throw new BusinessError('claim_lost');
    return row;
  }
  const repo = {
    enqueue(accountId: string, keywordInput: string, limit: number): { id: string } {
      identifier(accountId);
      const keyword = cleanKeyword(keywordInput);
      if (!keyword || !Number.isInteger(limit) || limit < 1 || limit > SEARCH_LIMIT_MAX) throw new BusinessError('invalid_input');
      return atomic(db, () => {
        const account = current(accountId);
        if (!account) throw new BusinessError('not_ready');
        const id = randomUUID();
        db.prepare(`INSERT INTO scan_runs(id,account_id,account_identity_id,mode,keyword,result_limit,simulated,created_at)
          VALUES(?,?,?,'keyword',?,?,0,?)`).run(id, accountId, account.identityId, keyword, limit, now());
        return { id };
      });
    },
    latest(accountId: string): GroupSearchSummary | null {
      identifier(accountId);
      const row = db.prepare(`SELECT s.id,s.account_id AS accountId,s.keyword,s.status,s.result_limit AS "limit",s.reason_code AS reasonCode,
        s.created_at AS createdAt,s.finished_at AS finishedAt,s.cancel_requested_at IS NOT NULL AS cancelRequested,
        (SELECT count(*) FROM group_search_results r WHERE r.scan_run_id=s.id) AS observedCount
        FROM scan_runs s WHERE account_id=? AND mode='keyword' ORDER BY created_at DESC,rowid DESC LIMIT 1`).get(accountId) as unknown as GroupSearchSummary | undefined;
      return row ? { ...row, cancelRequested: !!row.cancelRequested } : null;
    },
    /** Kết quả của lần tìm gần nhất của tài khoản, kèm yêu cầu tham gia gần nhất của CHÍNH tài khoản này cho từng nhóm. */
    results(accountId: string): GroupSearchResultItem[] {
      identifier(accountId);
      const rows = db.prepare(`SELECT r.id,r.external_id AS externalId,r.canonical_url AS canonicalUrl,r.name,r.privacy,r.member_count AS memberCount,
        r.join_state AS joinState,r.observed_at AS observedAt,
        (SELECT j.status FROM group_join_requests j WHERE j.account_id=? AND j.external_id=r.external_id ORDER BY j.created_at DESC,j.rowid DESC LIMIT 1) AS requestStatus,
        (SELECT j.reason_code FROM group_join_requests j WHERE j.account_id=? AND j.external_id=r.external_id ORDER BY j.created_at DESC,j.rowid DESC LIMIT 1) AS requestReason
        FROM group_search_results r WHERE r.scan_run_id=(SELECT s.id FROM scan_runs s WHERE s.account_id=? AND s.mode='keyword'
          ORDER BY s.created_at DESC,s.rowid DESC LIMIT 1) ORDER BY r.rowid`).all(accountId, accountId, accountId) as unknown as Array<
        Omit<GroupSearchResultItem, 'request'> & { requestStatus: GroupJoinStatus | null; requestReason: string | null }>;
      return rows.map(({ requestStatus, requestReason, ...item }) => ({ ...item, request: requestStatus ? { status: requestStatus, reasonCode: requestReason } : null }));
    },
    claimNext(workerId: string): GroupSearchClaim | undefined {
      text(workerId, 100);
      return atomic(db, () => {
        const time = now();
        db.prepare(`UPDATE scan_runs SET status='partial',reason_code='worker_lost',finished_at=?
          WHERE mode='keyword' AND status='running' AND COALESCE(heartbeat_at,started_at)<?`).run(time, time - 180_000);
        const row = one<{ id: string }>(db, `SELECT s.id FROM scan_runs s WHERE s.mode='keyword' AND s.status='queued'
          AND NOT EXISTS(SELECT 1 FROM resource_leases l WHERE l.resource_key='browser:'||s.account_id AND l.expires_at>?)
          ORDER BY s.created_at,s.rowid LIMIT 1`, time);
        if (!row) return undefined;
        db.prepare("UPDATE scan_runs SET status='running',claimed_by=?,started_at=?,heartbeat_at=? WHERE id=? AND status='queued'")
          .run(workerId, time, time, row.id);
        return owned(row.id, workerId);
      });
    },
    heartbeat(id: string, workerId: string): void {
      const changed = db.prepare("UPDATE scan_runs SET heartbeat_at=? WHERE id=? AND mode='keyword' AND status='running' AND claimed_by=?").run(now(), id, workerId).changes;
      if (changed !== 1) throw new BusinessError('claim_lost');
    },
    shouldCancel(claim: GroupSearchClaim): boolean {
      const row = one<{ status: string; cancelled: number }>(db, 'SELECT status,cancel_requested_at IS NOT NULL AS cancelled FROM scan_runs WHERE id=?', claim.id);
      return row?.status !== 'running' || !!row.cancelled || current(claim.accountId)?.identityId !== claim.identityId;
    },
    /** Ảnh chụp tích lũy sau mỗi vòng cuộn. Chỉ lưu nhóm có ID số; cập nhật thông tin đọc được thêm ở vòng sau. */
    saveBatch(id: string, workerId: string, items: readonly ObservedSearchGroup[]): void {
      atomic(db, () => {
        const claim = owned(id, workerId);
        if (repo.shouldCancel(claim)) return;
        for (const item of items.slice(0, claim.limit)) {
          const normalized = normalizeGroupReference(item.reference);
          if (!normalized?.externalId) continue;
          db.prepare(`INSERT INTO group_search_results(id,scan_run_id,external_id,canonical_url,name,privacy,member_count,join_state,observed_at)
            VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(scan_run_id,external_id) DO UPDATE SET name=COALESCE(excluded.name,name),
            privacy=CASE WHEN excluded.privacy='unknown' THEN privacy ELSE excluded.privacy END,
            member_count=COALESCE(excluded.member_count,member_count),join_state=excluded.join_state`)
            .run(randomUUID(), id, normalized.externalId, normalized.canonicalUrl, item.name, item.privacy, item.memberCount, item.joinState, now());
        }
      });
    },
    cancel(id: string): void {
      identifier(id);
      const changed = db.prepare(`UPDATE scan_runs SET cancel_requested_at=?,
        status=CASE WHEN status='queued' THEN 'stopped' ELSE status END,
        finished_at=CASE WHEN status='queued' THEN ? ELSE finished_at END,
        reason_code=CASE WHEN status='queued' THEN 'cancelled' ELSE reason_code END
        WHERE id=? AND mode='keyword' AND status IN ('queued','running')`).run(now(), now(), id).changes;
      if (changed !== 1) throw new BusinessError('invalid_transition');
    },
    finish(id: string, workerId: string, status: 'partial' | 'stopped' | 'blocked' | 'failed', reason: string): void {
      if (!['partial', 'stopped', 'blocked', 'failed'].includes(status) || !/^[a-z_]{1,40}$/u.test(reason)) throw new BusinessError('invalid_input');
      const changed = db.prepare("UPDATE scan_runs SET status=?,reason_code=?,finished_at=? WHERE id=? AND mode='keyword' AND status='running' AND claimed_by=?")
        .run(status, reason, now(), id, workerId).changes;
      if (changed !== 1) throw new BusinessError('claim_lost');
    },
  };
  return repo;
}
