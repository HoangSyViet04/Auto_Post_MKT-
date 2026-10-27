import { BusinessError } from '#domain';
import type { Database } from './db.ts';
import { atomic, identifier, one, type RepositoryOptions, text, timestamp } from './repository-common.ts';

export interface LeaseHandle {
  resourceKey: string;
  ownerId: string;
  fence: number;
  expiresAt: number;
}

const MAX_TTL_MS = 10 * 60_000;

/**
 * Khóa trình duyệt theo tài khoản (bảng resource_leases): đăng nhập tay, kiểm tra phiên, đăng/quét đều phải giữ khóa này
 * nên không tranh nhau một hồ sơ. Fence chỉ tăng khi đổi chủ; khóa hết hạn thì tự coi là trống (bảng không cho xóa dòng).
 */
export function createLeaseRepository(db: Database, options: RepositoryOptions = {}) {
  const clock = () => timestamp((options.clock ?? Date.now)());
  const ttl = (value: number) => {
    if (!Number.isSafeInteger(value) || value < 1_000 || value > MAX_TTL_MS) throw new BusinessError('invalid_input');
    return value;
  };

  return {
    acquireBrowser(accountId: string, ownerId: string, ttlMs: number): LeaseHandle {
      identifier(accountId);
      text(ownerId, 100);
      ttl(ttlMs);
      return atomic(db, () => {
        if (!one(db, 'SELECT id FROM accounts WHERE id=?', accountId)) throw new BusinessError('not_found');
        const now = clock();
        const key = `browser:${accountId}`;
        const row = one<{ owner_id: string | null; fence: number; expires_at: number }>(db,
          'SELECT owner_id,fence,expires_at FROM resource_leases WHERE resource_key=?', key);
        const expiresAt = now + ttlMs;
        if (!row) {
          db.prepare("INSERT INTO resource_leases(resource_key,resource_kind,account_id,owner_id,fence,expires_at) VALUES(?,'browser',?,?,1,?)")
            .run(key, accountId, ownerId, expiresAt);
          return { resourceKey: key, ownerId, fence: 1, expiresAt };
        }
        if (row.expires_at > now && row.owner_id !== ownerId) throw new BusinessError('conflict'); // đang được dùng
        const fence = row.owner_id === ownerId ? row.fence : row.fence + 1;
        db.prepare('UPDATE resource_leases SET owner_id=?,fence=?,expires_at=? WHERE resource_key=?').run(ownerId, fence, expiresAt, key);
        return { resourceKey: key, ownerId, fence, expiresAt };
      });
    },

    /** Gia hạn khi còn đúng chủ và đúng fence; nếu đã mất quyền thì báo claim_lost để dừng ngay. */
    renew(handle: LeaseHandle, ttlMs: number): LeaseHandle {
      ttl(ttlMs);
      return atomic(db, () => {
        const now = clock();
        const expiresAt = now + ttlMs;
        const changed = db.prepare('UPDATE resource_leases SET expires_at=? WHERE resource_key=? AND owner_id=? AND fence=? AND expires_at>?')
          .run(expiresAt, handle.resourceKey, handle.ownerId, handle.fence, now).changes;
        if (changed !== 1) throw new BusinessError('claim_lost');
        return { ...handle, expiresAt };
      });
    },

    /** Trả khóa bằng cách cho hết hạn ngay (giữ nguyên chủ/fence để fence không bao giờ giảm). */
    release(handle: LeaseHandle): void {
      atomic(db, () => {
        db.prepare('UPDATE resource_leases SET expires_at=? WHERE resource_key=? AND owner_id=? AND fence=?')
          .run(clock(), handle.resourceKey, handle.ownerId, handle.fence);
      });
    },

    isBrowserBusy(accountId: string): boolean {
      identifier(accountId);
      const row = one<{ expires_at: number }>(db, 'SELECT expires_at FROM resource_leases WHERE resource_key=?', `browser:${accountId}`);
      return row !== undefined && row.expires_at > clock();
    },
  };
}
