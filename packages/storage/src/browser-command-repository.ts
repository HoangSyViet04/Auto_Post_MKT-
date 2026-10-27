import { randomUUID } from 'node:crypto';
import { BusinessError, type BrowserCommandKind, type BrowserCommandSummary } from '#domain';
import type { Database } from './db.ts';
import { atomic, identifier, one, type RepositoryOptions, text, timestamp } from './repository-common.ts';

const KINDS = ['login', 'verify'] as const;
const FINAL = ['succeeded', 'failed', 'cancelled'] as const;
type FinalStatus = (typeof FINAL)[number];
/** Lệnh đang chạy mà quá lâu không có nhịp sống thì coi worker đã mất. */
export const DEFAULT_STALE_MS = 20 * 60_000;

export interface ClaimedBrowserCommand {
  id: string;
  accountId: string;
  kind: BrowserCommandKind;
}

export function createBrowserCommandRepository(db: Database, options: RepositoryOptions = {}) {
  const clock = () => timestamp((options.clock ?? Date.now)());
  const select = `SELECT id,kind,status,result_code AS resultCode,requested_at AS requestedAt,finished_at AS finishedAt,
    cancel_requested_at AS cancelRequestedAt FROM browser_commands`;

  const repository = {
    /** Một tài khoản chỉ có một lệnh đang chờ/đang chạy (chỉ mục duy nhất); trùng thì báo conflict, không tạo thêm. */
    enqueue(accountId: string, kind: BrowserCommandKind): { id: string } {
      identifier(accountId);
      if (!(KINDS as readonly string[]).includes(kind)) throw new BusinessError('invalid_input');
      return atomic(db, () => {
        if (!one(db, 'SELECT id FROM accounts WHERE id=? AND archived_at IS NULL', accountId)) throw new BusinessError('not_found');
        const id = randomUUID();
        db.prepare("INSERT INTO browser_commands(id,account_id,kind,requested_at) VALUES(?,?,?,?)").run(id, accountId, kind, clock());
        return { id };
      });
    },

    /** Lệnh gần nhất của tài khoản (kể cả đã xong) để hiển thị trạng thái và lần kiểm tra cuối. */
    latestFor(accountId: string): BrowserCommandSummary | null {
      identifier(accountId);
      const row = db.prepare(`${select} WHERE account_id=? ORDER BY requested_at DESC,rowid DESC LIMIT 1`).get(accountId);
      return row ? (row as unknown as BrowserCommandSummary) : null;
    },

    /** Nhận lệnh cũ nhất đang chờ bằng cập nhật có điều kiện; trước đó dọn các lệnh chạy dở của worker đã mất. */
    claimNext(workerId: string, staleMs: number = DEFAULT_STALE_MS): ClaimedBrowserCommand | undefined {
      text(workerId, 100);
      if (!Number.isSafeInteger(staleMs) || staleMs < 1_000) throw new BusinessError('invalid_input');
      return atomic(db, () => {
        const now = clock();
        db.prepare(`UPDATE browser_commands SET status='failed',result_code='worker_lost',finished_at=?
          WHERE status='running' AND COALESCE(heartbeat_at,claimed_at)<?`).run(now, now - staleMs);
        const next = one<{ id: string; account_id: string; kind: BrowserCommandKind }>(db,
          "SELECT id,account_id,kind FROM browser_commands WHERE status='queued' ORDER BY requested_at,rowid LIMIT 1");
        if (!next) return undefined;
        const changed = db.prepare("UPDATE browser_commands SET status='running',claimed_by=?,claimed_at=?,heartbeat_at=? WHERE id=? AND status='queued'")
          .run(workerId, now, now, next.id).changes;
        return changed === 1 ? { id: next.id, accountId: next.account_id, kind: next.kind } : undefined;
      });
    },

    heartbeat(id: string, workerId: string): void {
      identifier(id);
      atomic(db, () => {
        const changed = db.prepare("UPDATE browser_commands SET heartbeat_at=? WHERE id=? AND status='running' AND claimed_by=?").run(clock(), id, workerId).changes;
        if (changed !== 1) throw new BusinessError('claim_lost');
      });
    },

    isCancelRequested(id: string): boolean {
      identifier(id);
      const row = one<{ cancel_requested_at: number | null; status: string }>(db, 'SELECT cancel_requested_at,status FROM browser_commands WHERE id=?', id);
      return row?.cancel_requested_at != null || row?.status === 'cancelled';
    },

    /** Chưa chạy thì hủy ngay; đang chạy thì chỉ ghi yêu cầu, worker dừng ở lần kiểm tra tiếp theo. */
    requestCancel(id: string): 'cancelled' | 'cancel_requested' {
      identifier(id);
      return atomic(db, () => {
        const row = one<{ status: string }>(db, 'SELECT status FROM browser_commands WHERE id=?', id);
        if (!row) throw new BusinessError('not_found');
        const now = clock();
        if (row.status === 'queued') {
          db.prepare("UPDATE browser_commands SET status='cancelled',result_code='cancelled_before_start',cancel_requested_at=?,finished_at=? WHERE id=?").run(now, now, id);
          return 'cancelled';
        }
        if (row.status !== 'running') throw new BusinessError('invalid_transition');
        db.prepare('UPDATE browser_commands SET cancel_requested_at=COALESCE(cancel_requested_at,?) WHERE id=?').run(now, id);
        return 'cancel_requested';
      });
    },

    finish(id: string, workerId: string, status: FinalStatus, resultCode: string): void {
      identifier(id);
      if (!(FINAL as readonly string[]).includes(status) || !/^[a-z_]{1,40}$/u.test(resultCode)) throw new BusinessError('invalid_input');
      atomic(db, () => {
        const changed = db.prepare("UPDATE browser_commands SET status=?,result_code=?,finished_at=? WHERE id=? AND status='running' AND claimed_by=?")
          .run(status, resultCode, clock(), id, workerId).changes;
        if (changed !== 1) throw new BusinessError('claim_lost');
      });
    },
  };
  return repository;
}
