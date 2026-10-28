import { randomUUID } from 'node:crypto';
import { BusinessError, type PageConnectionItem } from '#domain';
import type { Database } from './db.ts';
import { atomic, identifier, one, type RepositoryOptions, timestamp } from './repository-common.ts';
import type { createSecretStore } from './secret-store.ts';

export type { PageConnectionItem } from '#domain';

export interface PageConnectInput {
  /** ID số của Page do Meta cấp. */
  pageId: string;
  name: string;
  /** Page token. Đi thẳng vào kho bí mật (mã hóa theo Windows), không bao giờ vào DB hay log. */
  token: string;
  /** Các `tasks` Meta trả về cho người dùng trên Page này; cần CREATE_CONTENT để đăng. */
  tasks: readonly string[];
}

const PAGE_ID = /^\d{5,25}$/u;
const CAN_CREATE = 'CREATE_CONTENT';

/**
 * Kết nối fanpage (P09.1/P09.2). Token Page nằm trong SecretStore; bảng `page_connections` chỉ giữ tham chiếu. Mỗi Page tối đa một kết nối
 * (UNIQUE theo đích). Kết nối lại cùng Page thay token mới và thu hồi token cũ.
 */
export function createPageRepository(db: Database, deps: { secrets: ReturnType<typeof createSecretStore> } & RepositoryOptions) {
  const clock = () => timestamp((deps.clock ?? Date.now)());
  const SELECT = `SELECT pc.id,pc.destination_id,pc.remote_identity_id,d.name,pc.permission_status,s.status AS secret_status,pc.checked_at,pc.created_at
    FROM page_connections pc JOIN destinations d ON d.id=pc.destination_id LEFT JOIN secret_refs s ON s.id=pc.secret_ref_id`;

  function item(row: Record<string, unknown>): PageConnectionItem {
    const permissionStatus = row.permission_status as PageConnectionItem['permissionStatus'];
    const secretStatus = row.secret_status === null ? null : (row.secret_status as PageConnectionItem['secretStatus']);
    return {
      id: String(row.id), destinationId: String(row.destination_id), pageId: String(row.remote_identity_id), name: row.name === null ? null : String(row.name),
      permissionStatus, secretStatus, checkedAt: row.checked_at === null ? null : Number(row.checked_at), createdAt: Number(row.created_at),
      canPost: permissionStatus === 'allowed' && secretStatus === 'available',
    };
  }
  function get(id: string): PageConnectionItem {
    identifier(id);
    const row = db.prepare(`${SELECT} WHERE pc.id=?`).get(id);
    if (!row) throw new BusinessError('not_found');
    return item(row);
  }

  return {
    get,

    /** Metadata các Page đang kết nối (không gồm Page đã gỡ). */
    list(): PageConnectionItem[] {
      return (db.prepare(`${SELECT} WHERE pc.archived_at IS NULL ORDER BY d.name COLLATE NOCASE,pc.created_at`).all() as Array<Record<string, unknown>>).map(item);
    },

    /** Lưu (hoặc thay) kết nối cho một Page. Không gọi mạng; người gọi đã kiểm tra token trước. */
    async connect(input: PageConnectInput): Promise<PageConnectionItem> {
      if (typeof input !== 'object' || input === null || typeof input.pageId !== 'string' || !PAGE_ID.test(input.pageId)) throw new BusinessError('invalid_input');
      if (typeof input.name !== 'string' || input.name.trim() === '' || input.name.length > 500) throw new BusinessError('invalid_input');
      if (typeof input.token !== 'string' || input.token.length < 20 || !Array.isArray(input.tasks)) throw new BusinessError('invalid_input');
      const permission = input.tasks.includes(CAN_CREATE) ? 'allowed' : 'denied';
      const secret = await deps.secrets.put(input.token); // phải ngoài giao dịch; lỗi ở đây thì chưa ghi gì vào DB
      let oldSecret: string | null = null;
      try {
        const id = atomic(db, () => {
          const now = clock();
          const existingDestination = one<{ id: string }>(db, "SELECT id FROM destinations WHERE channel='page' AND external_id=?", input.pageId);
          const destinationId = existingDestination?.id ?? randomUUID();
          if (existingDestination) db.prepare('UPDATE destinations SET name=?,archived_at=NULL WHERE id=?').run(input.name.trim(), destinationId);
          else db.prepare("INSERT INTO destinations(id,channel,external_id,name,approval_required,created_at) VALUES(?,'page',?,?,'not_required',?)").run(destinationId, input.pageId, input.name.trim(), now);
          const existing = one<{ id: string; secret_ref_id: string | null }>(db, 'SELECT id,secret_ref_id FROM page_connections WHERE destination_id=?', destinationId);
          if (existing) {
            oldSecret = existing.secret_ref_id;
            db.prepare('UPDATE page_connections SET secret_ref_id=?,permission_status=?,checked_at=?,archived_at=NULL WHERE id=?').run(secret.id, permission, now, existing.id);
            return existing.id;
          }
          const connectionId = randomUUID();
          db.prepare("INSERT INTO page_connections(id,destination_id,channel,remote_identity_id,secret_ref_id,permission_status,checked_at,created_at) VALUES(?,?,'page',?,?,?,?,?)")
            .run(connectionId, destinationId, input.pageId, secret.id, permission, now, now);
          return connectionId;
        });
        if (oldSecret && oldSecret !== secret.id) await deps.secrets.revoke(oldSecret).catch(() => undefined); // token cũ không còn dùng
        return get(id);
      } catch (error) {
        await deps.secrets.revoke(secret.id).catch(() => undefined); // không để lại token mồ côi
        throw error;
      }
    },

    /** Chỉ dành cho worker khi cần gọi Graph API. KHÔNG bao giờ đưa qua HTTP, log hay giao diện. */
    async revealToken(connectionId: string): Promise<{ pageId: string; token: string }> {
      identifier(connectionId);
      const row = one<{ remote_identity_id: string; secret_ref_id: string | null; archived_at: number | null }>(db,
        'SELECT remote_identity_id,secret_ref_id,archived_at FROM page_connections WHERE id=?', connectionId);
      if (!row) throw new BusinessError('not_found');
      if (row.archived_at !== null || !row.secret_ref_id) throw new BusinessError('not_ready');
      return { pageId: row.remote_identity_id, token: await deps.secrets.get(row.secret_ref_id) };
    },

    /** Ghi kết quả lần kiểm tra mới nhất (ví dụ token hết hạn → expired). */
    markChecked(connectionId: string, permissionStatus: PageConnectionItem['permissionStatus']): PageConnectionItem {
      identifier(connectionId);
      if (!['unknown', 'allowed', 'denied', 'expired'].includes(permissionStatus)) throw new BusinessError('invalid_input');
      return atomic(db, () => {
        if (!db.prepare('SELECT 1 FROM page_connections WHERE id=? AND archived_at IS NULL').get(connectionId)) throw new BusinessError('not_found');
        db.prepare('UPDATE page_connections SET permission_status=?,checked_at=? WHERE id=?').run(permissionStatus, clock(), connectionId);
        return get(connectionId);
      });
    },

    /**
     * Gỡ kết nối (P09.7): lưu trữ (không xóa lịch sử), thu hồi token và DỪNG các job phụ thuộc: job chưa gửi (chờ/tạm dừng/bị chặn/cần xem lại)
     * bị hủy, job đang chạy được yêu cầu dừng (kết quả thực tế vẫn được ghi), job đã có kết quả giữ nguyên. Không bao giờ đổi sang Page khác.
     * Trả số job đã hủy.
     */
    async disconnect(connectionId: string): Promise<{ cancelledJobs: number }> {
      identifier(connectionId);
      const row = one<{ secret_ref_id: string | null }>(db, 'SELECT secret_ref_id FROM page_connections WHERE id=? AND archived_at IS NULL', connectionId);
      if (!row) throw new BusinessError('not_found');
      const dependent = 'SELECT id FROM approvals WHERE page_connection_id=?';
      const cancelledJobs = atomic(db, () => {
        const now = clock();
        db.prepare('UPDATE page_connections SET archived_at=? WHERE id=?').run(now, connectionId);
        const cancelled = db.prepare(`UPDATE publish_jobs SET status='cancelled' WHERE approval_id IN (${dependent}) AND status IN ('queued','paused','blocked','needs_review')`).run(connectionId);
        db.prepare(`UPDATE publish_jobs SET stop_requested_at=COALESCE(stop_requested_at,?) WHERE approval_id IN (${dependent}) AND status='running'`).run(now, connectionId);
        return Number(cancelled.changes);
      });
      if (row.secret_ref_id) await deps.secrets.revoke(row.secret_ref_id);
      return { cancelledJobs };
    },
  };
}
