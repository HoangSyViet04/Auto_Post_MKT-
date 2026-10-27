import { randomUUID } from 'node:crypto';
import { type AccountSummary, BusinessError } from '#domain';
import type { Database } from './db.ts';
import { atomic, identifier, one, type RepositoryOptions, text, timestamp } from './repository-common.ts';

export const MAX_ACTIVE_ACCOUNTS = 2;
const MAX_LABEL = 100;

/** Tác vụ gắn với tài khoản qua bản duyệt; dùng chung cho đếm, tạm dừng và gỡ. */
const APPROVALS_OF = (accountId: string) => `SELECT id FROM approvals WHERE account_id=${accountId}`;

export function createAccountRepository(db: Database, options: RepositoryOptions = {}) {
  const clock = () => timestamp((options.clock ?? Date.now)());

  function label(value: unknown, exceptId?: string): string {
    text(value, MAX_LABEL);
    const clean = value.trim().replace(/\s+/gu, ' ');
    // SQLite lower() không hạ chữ hoa có dấu, nên so sánh bằng JavaScript.
    const key = clean.toLocaleLowerCase('vi');
    const taken = db.prepare('SELECT id,label FROM accounts WHERE archived_at IS NULL').all()
      .some((row) => row.id !== exceptId && String(row.label).toLocaleLowerCase('vi') === key);
    if (taken) throw new BusinessError('conflict');
    return clean;
  }

  function active(accountId: string): void {
    identifier(accountId);
    if (!one(db, 'SELECT id FROM accounts WHERE id=? AND archived_at IS NULL', accountId)) throw new BusinessError('not_found');
  }

  /** Đang gửi thì chỉ yêu cầu dừng, không gọi là đã hủy; chưa gửi thì xử lý riêng ở nơi gọi. */
  function requestStopRunning(accountId: string, now: number): void {
    db.prepare(`UPDATE publish_jobs SET stop_requested_at=COALESCE(stop_requested_at,?)
      WHERE approval_id IN (${APPROVALS_OF('?')}) AND status='running'`).run(now, accountId);
  }

  const summary = `SELECT a.id,a.label,a.slot,a.session_status AS sessionStatus,a.paused,a.created_at AS createdAt,
    i.remote_identity_id AS remoteId,i.display_name AS displayName,i.confirmed_at AS confirmedAt,
    p.id AS proxyId,p.label AS proxyLabel,
    (SELECT count(*) FROM publish_jobs j WHERE j.status='queued' AND j.approval_id IN (${APPROVALS_OF('a.id')})) AS queuedJobs,
    (SELECT count(*) FROM publish_jobs j WHERE j.status='running' AND j.approval_id IN (${APPROVALS_OF('a.id')})) AS runningJobs
    FROM accounts a LEFT JOIN account_identities i ON i.id=a.current_identity_id AND i.account_id=a.id
    LEFT JOIN browser_profiles bp ON bp.account_id=a.id LEFT JOIN proxies p ON p.id=bp.proxy_id
    WHERE a.archived_at IS NULL`;

  function toSummary(row: Record<string, unknown>): AccountSummary {
    return {
      id: String(row.id), label: String(row.label), slot: Number(row.slot) as 1 | 2,
      sessionStatus: row.sessionStatus as AccountSummary['sessionStatus'], paused: row.paused === 1,
      createdAt: Number(row.createdAt),
      identity: row.remoteId == null ? null : { remoteId: String(row.remoteId),
        displayName: row.displayName == null ? null : String(row.displayName), confirmedAt: Number(row.confirmedAt) },
      proxy: row.proxyId == null ? null : { id: String(row.proxyId), label: String(row.proxyLabel) },
      queuedJobs: Number(row.queuedJobs), runningJobs: Number(row.runningJobs),
    };
  }

  const repository = {
    list(): AccountSummary[] {
      return atomic(db, () => db.prepare(`${summary} ORDER BY a.slot`).all().map(toSummary));
    },

    get(accountId: string): AccountSummary {
      identifier(accountId);
      return atomic(db, () => {
        const row = db.prepare(`${summary} AND a.id=?`).get(accountId);
        if (!row) throw new BusinessError('not_found');
        return toSummary(row);
      });
    },

    /** Tối đa hai tài khoản đang dùng. Tạo luôn kèm hồ sơ trình duyệt riêng (chưa đăng nhập, chưa có proxy). */
    create(input: { label: string }): AccountSummary {
      if (typeof input !== 'object' || input === null) throw new BusinessError('invalid_input');
      const id = atomic(db, () => {
        const clean = label(input.label);
        const used = new Set(db.prepare('SELECT slot FROM accounts WHERE archived_at IS NULL').all().map((row) => Number(row.slot)));
        const slot = [1, 2].find((candidate) => !used.has(candidate));
        if (used.size >= MAX_ACTIVE_ACCOUNTS || slot === undefined) throw new BusinessError('account_limit');
        const accountId = randomUUID();
        const now = clock();
        db.prepare('INSERT INTO accounts(id,label,slot,created_at) VALUES(?,?,?,?)').run(accountId, clean, slot, now);
        db.prepare('INSERT INTO browser_profiles(id,account_id,directory_key,created_at) VALUES(?,?,?,?)')
          .run(randomUUID(), accountId, randomUUID(), now);
        return accountId;
      });
      return repository.get(id);
    },

    rename(accountId: string, newLabel: string): AccountSummary {
      atomic(db, () => {
        active(accountId);
        db.prepare('UPDATE accounts SET label=? WHERE id=?').run(label(newLabel, accountId), accountId);
      });
      return repository.get(accountId);
    },

    /**
     * Tạm dừng chặn nhận/gửi tác vụ của đúng tài khoản này (readiness kiểm tra paused) và yêu cầu dừng tác vụ đang chạy.
     * Không chuyển tác vụ sang tài khoản còn lại.
     */
    setPaused(accountId: string, paused: boolean): AccountSummary {
      if (typeof paused !== 'boolean') throw new BusinessError('invalid_input');
      atomic(db, () => {
        active(accountId);
        db.prepare('UPDATE accounts SET paused=? WHERE id=?').run(paused ? 1 : 0, accountId);
        if (paused) requestStopRunning(accountId, clock());
      });
      return repository.get(accountId);
    },

    setAllPaused(paused: boolean): AccountSummary[] {
      if (typeof paused !== 'boolean') throw new BusinessError('invalid_input');
      atomic(db, () => {
        const now = clock();
        for (const row of db.prepare('SELECT id FROM accounts WHERE archived_at IS NULL').all()) {
          db.prepare('UPDATE accounts SET paused=? WHERE id=?').run(paused ? 1 : 0, row.id as string);
          if (paused) requestStopRunning(row.id as string, now);
        }
      });
      return repository.list();
    },

    /**
     * Gỡ tài khoản: lưu trữ (giữ lịch sử và danh tính), giải phóng chỗ, thu hồi các bản duyệt, hủy tác vụ chưa gửi
     * và yêu cầu dừng tác vụ đang chạy. Không chuyển sang tài khoản khác. Cookie/profile trình duyệt thuộc P03.3.
     */
    remove(accountId: string): void {
      atomic(db, () => {
        active(accountId);
        const now = clock();
        db.prepare(`INSERT INTO approval_revocations(approval_id,reason_code,revoked_at)
          SELECT id,'account_removed',? FROM approvals WHERE account_id=? ON CONFLICT(approval_id) DO NOTHING`).run(now, accountId);
        db.prepare(`UPDATE publish_jobs SET status='cancelled' WHERE approval_id IN (${APPROVALS_OF('?')})
          AND status IN ('queued','paused','blocked','needs_review')`).run(accountId);
        requestStopRunning(accountId, now);
        db.prepare('UPDATE accounts SET archived_at=?,paused=1 WHERE id=?').run(now, accountId);
      });
    },
  };
  return repository;
}
