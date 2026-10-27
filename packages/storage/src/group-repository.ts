import { randomUUID } from 'node:crypto';
import {
  BusinessError,
  type GroupAccountRelation,
  type GroupApproval,
  type GroupBlocker,
  type GroupCuration,
  type GroupItem,
  type GroupListResponse,
  type GroupMembership,
  type GroupPermission,
  normalizeGroupReference,
} from '#domain';
import type { Database } from './db.ts';
import { atomic, identifier, objectInput, one, type RepositoryOptions, timestamp } from './repository-common.ts';

const MEMBERSHIPS = ['unknown', 'joined', 'not_joined'] as const;
const PERMISSIONS = ['unknown', 'allowed', 'denied'] as const;
const APPROVALS = ['unknown', 'required', 'not_required'] as const;
const CURATIONS = ['normal', 'preferred', 'unsuitable'] as const;

export interface GroupProfileInput {
  name?: string | null;
  region?: string | null;
  topic?: string | null;
  rulesNote?: string | null;
  userNote?: string | null;
  approvalRequired?: GroupApproval;
  curation?: GroupCuration;
}
export interface AddGroupInput extends GroupProfileInput {
  /** Link hoặc ID số do người dùng nhập. */
  reference: string;
  accountId: string;
  membership?: GroupMembership;
  permission?: GroupPermission;
}
export interface GroupFilter {
  accountId?: string;
  q?: string;
  region?: string;
  membership?: GroupMembership;
  curation?: GroupCuration;
  includeArchived?: boolean;
  page?: number;
  pageSize?: number;
}

/** Bỏ dấu và hạ chữ hoa để tìm "ha noi" ra "Hà Nội" (LIKE của SQLite không làm được). */
export function foldText(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/giu, 'd').toLocaleLowerCase('vi');
}

function member<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) throw new BusinessError('invalid_input');
  return value as T;
}
function optionalText(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || value.length > max) throw new BusinessError('invalid_input');
  return value.trim() || null;
}

export function createGroupRepository(db: Database, options: RepositoryOptions = {}) {
  const clock = () => timestamp((options.clock ?? Date.now)());

  function activeAccount(accountId: string): void {
    identifier(accountId);
    if (!one(db, 'SELECT id FROM accounts WHERE id=? AND archived_at IS NULL', accountId)) throw new BusinessError('not_found');
  }
  function group(destinationId: string): void {
    identifier(destinationId);
    if (!one(db, "SELECT id FROM destinations WHERE id=? AND channel='group'", destinationId)) throw new BusinessError('not_found');
  }
  function upsertRelation(destinationId: string, accountId: string, membership: GroupMembership | undefined, permission: GroupPermission | undefined): void {
    const existing = one<{ membership_status: string; posting_permission: string }>(db,
      'SELECT membership_status,posting_permission FROM account_destinations WHERE account_id=? AND destination_id=?', accountId, destinationId);
    const nextMembership = membership ?? existing?.membership_status ?? 'unknown';
    const nextPermission = permission ?? existing?.posting_permission ?? 'unknown';
    // Người dùng tự khai báo: nguồn 'manual', chưa phải kết quả đọc từ giao diện Facebook.
    db.prepare(`INSERT INTO account_destinations(account_id,destination_id,channel,membership_status,posting_permission,source,checked_at)
      VALUES(?,?,'group',?,?,'manual',?) ON CONFLICT(account_id,destination_id) DO UPDATE SET
      membership_status=excluded.membership_status,posting_permission=excluded.posting_permission,source='manual',checked_at=excluded.checked_at`)
      .run(accountId, destinationId, nextMembership, nextPermission, clock());
  }

  function blockers(row: { externalId: string | null; archived: boolean; curation: string }, relation: { membership: string; permission: string }, paused: boolean): GroupBlocker[] {
    const found: GroupBlocker[] = [];
    if (!row.externalId) found.push('no_external_id');
    if (relation.membership !== 'joined') found.push('not_joined');
    if (relation.permission !== 'allowed') found.push('no_permission');
    if (row.curation === 'unsuitable') found.push('unsuitable');
    if (row.archived) found.push('archived');
    if (paused) found.push('account_paused');
    return found;
  }

  const repository = {
    /**
     * Lưu nhóm từ link/ID người dùng nhập. Cùng nhóm (cùng ID, hoặc cùng link khi chưa có ID) chỉ có một bản ghi dù nhiều
     * tài khoản; quan hệ tham gia/quyền đăng lưu riêng từng tài khoản. Không ghi đè dữ liệu đã có của nhóm.
     */
    add(input: AddGroupInput): { id: string; created: boolean } {
      objectInput(input);
      activeAccount(input.accountId);
      const normalized = normalizeGroupReference(input.reference);
      if (!normalized) throw new BusinessError('invalid_input');
      const membership = input.membership === undefined ? undefined : member(input.membership, MEMBERSHIPS);
      const permission = input.permission === undefined ? undefined : member(input.permission, PERMISSIONS);
      const profile = {
        name: optionalText(input.name, 500), region: optionalText(input.region, 200), topic: optionalText(input.topic, 200),
        rulesNote: optionalText(input.rulesNote, 10_000), userNote: optionalText(input.userNote, 10_000),
        approval: input.approvalRequired === undefined ? 'unknown' : member(input.approvalRequired, APPROVALS),
        curation: input.curation === undefined ? 'normal' : member(input.curation, CURATIONS),
      };
      return atomic(db, () => {
        const existing = normalized.externalId
          ? one<{ id: string }>(db, "SELECT id FROM destinations WHERE channel='group' AND external_id=?", normalized.externalId)
          : one<{ id: string }>(db, "SELECT id FROM destinations WHERE channel='group' AND canonical_url=?", normalized.canonicalUrl);
        let id = existing?.id;
        if (id) {
          // Chỉ điền chỗ còn trống, không ghi đè nội dung người dùng đã nhập trước đó.
          db.prepare(`UPDATE destinations SET name=COALESCE(name,?),region=COALESCE(region,?),topic=COALESCE(topic,?),
            rules_note=COALESCE(rules_note,?),user_note=COALESCE(user_note,?) WHERE id=?`)
            .run(profile.name, profile.region, profile.topic, profile.rulesNote, profile.userNote, id);
        } else {
          id = randomUUID();
          db.prepare(`INSERT INTO destinations(id,channel,external_id,canonical_url,name,topic,region,rules_note,approval_required,
            curation,user_note,created_at) VALUES(?,'group',?,?,?,?,?,?,?,?,?,?)`).run(id, normalized.externalId, normalized.canonicalUrl,
            profile.name, profile.topic, profile.region, profile.rulesNote, profile.approval, profile.curation, profile.userNote, clock());
        }
        upsertRelation(id, input.accountId, membership, permission);
        return { id, created: !existing };
      });
    },

    /** Sửa thông tin do người dùng ghi nhận. Không đổi được ID/link (danh tính bất biến). */
    update(destinationId: string, patch: GroupProfileInput): void {
      objectInput(patch);
      group(destinationId);
      const sets: string[] = [];
      const values: Array<string | null> = [];
      const text = (column: string, key: keyof GroupProfileInput, max: number) => {
        if (patch[key] === undefined) return;
        sets.push(`${column}=?`);
        values.push(optionalText(patch[key], max));
      };
      text('name', 'name', 500); text('region', 'region', 200); text('topic', 'topic', 200);
      text('rules_note', 'rulesNote', 10_000); text('user_note', 'userNote', 10_000);
      if (patch.approvalRequired !== undefined) { sets.push('approval_required=?'); values.push(member(patch.approvalRequired, APPROVALS)); }
      if (patch.curation !== undefined) { sets.push('curation=?'); values.push(member(patch.curation, CURATIONS)); }
      if (!sets.length) throw new BusinessError('invalid_input');
      atomic(db, () => { db.prepare(`UPDATE destinations SET ${sets.join(',')} WHERE id=?`).run(...values, destinationId); });
    },

    /** Khai báo của người dùng cho một cặp tài khoản–nhóm; không suy ra từ việc tìm thấy nhóm. */
    setRelation(destinationId: string, accountId: string, relation: { membership?: GroupMembership; permission?: GroupPermission }): void {
      objectInput(relation);
      group(destinationId);
      activeAccount(accountId);
      const membership = relation.membership === undefined ? undefined : member(relation.membership, MEMBERSHIPS);
      const permission = relation.permission === undefined ? undefined : member(relation.permission, PERMISSIONS);
      if (membership === undefined && permission === undefined) throw new BusinessError('invalid_input');
      atomic(db, () => { upsertRelation(destinationId, accountId, membership, permission); });
    },

    /** Ngừng dùng (lưu trữ) hoặc dùng lại. Không xóa: lịch sử bài đăng còn tham chiếu nhóm. */
    setArchived(destinationId: string, archived: boolean): void {
      if (typeof archived !== 'boolean') throw new BusinessError('invalid_input');
      group(destinationId);
      atomic(db, () => {
        db.prepare("UPDATE destinations SET archived_at=? WHERE id=? AND channel='group'").run(archived ? clock() : null, destinationId);
      });
    },

    list(filter: GroupFilter = {}): GroupListResponse {
      const page = filter.page ?? 1;
      const pageSize = filter.pageSize ?? 20;
      if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
        throw new BusinessError('invalid_input');
      }
      if (filter.accountId !== undefined) identifier(filter.accountId);
      if (filter.membership !== undefined) member(filter.membership, MEMBERSHIPS);
      if (filter.curation !== undefined) member(filter.curation, CURATIONS);
      if (filter.q !== undefined && (typeof filter.q !== 'string' || filter.q.length > 200)) throw new BusinessError('invalid_input');
      if (filter.region !== undefined && (typeof filter.region !== 'string' || filter.region.length > 200)) throw new BusinessError('invalid_input');

      return atomic(db, () => {
        const rows = db.prepare(`SELECT id,external_id AS externalId,canonical_url AS canonicalUrl,name,region,topic,rules_note AS rulesNote,
          approval_required AS approvalRequired,curation,user_note AS userNote,archived_at AS archivedAt,created_at AS createdAt
          FROM destinations WHERE channel='group' ${filter.includeArchived ? '' : 'AND archived_at IS NULL'}
          ORDER BY created_at DESC,id`).all() as Array<Record<string, unknown>>;
        const relations = db.prepare(`SELECT ad.destination_id AS destinationId,ad.account_id AS accountId,a.label AS accountLabel,a.paused,
          ad.membership_status AS membership,ad.posting_permission AS permission,ad.source,ad.checked_at AS checkedAt
          FROM account_destinations ad JOIN accounts a ON a.id=ad.account_id WHERE a.archived_at IS NULL ORDER BY a.slot`).all() as Array<Record<string, unknown>>;
        const byDestination = new Map<string, Array<Record<string, unknown>>>();
        for (const relation of relations) {
          const key = String(relation.destinationId);
          byDestination.set(key, [...(byDestination.get(key) ?? []), relation]);
        }
        const needle = filter.q ? foldText(filter.q.trim()) : '';
        const region = filter.region ? foldText(filter.region.trim()) : '';
        const items: GroupItem[] = [];
        for (const row of rows) {
          const base = {
            externalId: row.externalId === null ? null : String(row.externalId), archived: row.archivedAt !== null, curation: String(row.curation),
          };
          const mine = byDestination.get(String(row.id)) ?? [];
          const accounts: GroupAccountRelation[] = mine.map((relation) => {
            const blockedBy = blockers(base, { membership: String(relation.membership), permission: String(relation.permission) }, relation.paused === 1);
            return { accountId: String(relation.accountId), accountLabel: String(relation.accountLabel),
              membership: relation.membership as GroupMembership, permission: relation.permission as GroupPermission,
              source: relation.source as GroupAccountRelation['source'], checkedAt: relation.checkedAt === null ? null : Number(relation.checkedAt),
              eligible: blockedBy.length === 0, blockedBy };
          });
          const scoped = filter.accountId ? accounts.filter((relation) => relation.accountId === filter.accountId) : accounts;
          if (filter.accountId && scoped.length === 0) continue;
          if (filter.membership && !scoped.some((relation) => relation.membership === filter.membership)) continue;
          if (filter.curation && base.curation !== filter.curation) continue;
          if (region && !foldText(String(row.region ?? '')).includes(region)) continue;
          const text = [row.name, row.canonicalUrl, row.externalId, row.topic, row.region, row.rulesNote, row.userNote]
            .filter((value) => value !== null && value !== undefined).map(String).join(' ');
          if (needle && !foldText(text).includes(needle)) continue;
          items.push({
            id: String(row.id), externalId: base.externalId, canonicalUrl: row.canonicalUrl === null ? null : String(row.canonicalUrl),
            name: row.name === null ? null : String(row.name), region: row.region === null ? null : String(row.region),
            topic: row.topic === null ? null : String(row.topic), rulesNote: row.rulesNote === null ? null : String(row.rulesNote),
            approvalRequired: row.approvalRequired as GroupApproval, curation: base.curation as GroupCuration,
            userNote: row.userNote === null ? null : String(row.userNote), archived: base.archived, createdAt: Number(row.createdAt),
            accounts: filter.accountId ? scoped : accounts,
          });
        }
        return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize };
      });
    },
  };
  return repository;
}
