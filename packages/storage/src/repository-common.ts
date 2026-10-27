import type { SQLInputValue } from 'node:sqlite';
import { BusinessError, type BusinessErrorCode, type IntegrationMode } from '#domain';
import { type Database, transaction } from './db.ts';

export interface RepositoryOptions { clock?: () => number }
export const MAX_MEDIA = 100;

export function objectInput(value: unknown): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new BusinessError('invalid_input');
}

export function identifier(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(value)) {
    throw new BusinessError('invalid_input');
  }
}
export function text(value: unknown, max = 10_000): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new BusinessError('invalid_input');
}
export function timestamp(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new BusinessError('invalid_input');
  return value;
}
export function mode(value: unknown): asserts value is IntegrationMode {
  if (value !== 'fake' && value !== 'live') throw new BusinessError('invalid_input');
}
export function mediaIds(value: readonly string[]): void {
  if (!Array.isArray(value) || !value.length || value.length > MAX_MEDIA || new Set(value).size !== value.length) {
    throw new BusinessError('invalid_input');
  }
  for (const id of value) identifier(id);
}
export function one<T>(db: Database, sql: string, ...params: SQLInputValue[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}
export function atomic<T>(db: Database, fn: () => T): T {
  try { return transaction(db, fn); }
  catch (error) {
    if (error instanceof Error && 'errcode' in error && typeof error.errcode === 'number' && (error.errcode & 255) === 19) {
      throw new BusinessError('conflict');
    }
    throw error;
  }
}

export interface ApprovalSnapshot {
  approval_id: string; mode: IntegrationMode; content_version_id: string; product_revision_id: string;
  product_id: string; current_revision_id: string; product_status: string; destination_id: string;
  channel: 'profile' | 'group' | 'page'; external_id: string | null; destination_archived: number | null;
  caption: string; account_id: string | null; account_identity_id: string | null;
  current_identity_id: string | null; account_archived: number | null; paused: number | null;
  session_status: string | null; membership_status: string | null; posting_permission: string | null;
  identity_remote_id: string | null; page_connection_id: string | null; page_archived: number | null;
  permission_status: string | null; page_remote_id: string | null; secret_status: string | null; revoked: number;
}
export interface ManagedMedia {
  id: string; storage_key: string; sha256: string; mime_type: string; byte_size: number; position: number; state: string;
}
export function snapshot(db: Database, approvalId: string): ApprovalSnapshot {
  const row = one<ApprovalSnapshot>(db, `SELECT a.id AS approval_id,a.mode,a.content_version_id,a.destination_id,a.channel,
    a.account_id,a.account_identity_id,a.page_connection_id,c.product_revision_id,c.caption,r.product_id,
    p.current_revision_id,p.status AS product_status,d.external_id,d.archived_at AS destination_archived,
    ac.current_identity_id,ac.archived_at AS account_archived,ac.paused,ac.session_status,
    ad.membership_status,ad.posting_permission,ai.remote_identity_id AS identity_remote_id,
    pc.archived_at AS page_archived,pc.permission_status,pc.remote_identity_id AS page_remote_id,s.status AS secret_status,
    EXISTS(SELECT 1 FROM approval_revocations ar WHERE ar.approval_id=a.id) AS revoked
    FROM approvals a JOIN content_versions c ON c.id=a.content_version_id
    JOIN product_revisions r ON r.id=c.product_revision_id JOIN products p ON p.id=r.product_id
    JOIN destinations d ON d.id=a.destination_id LEFT JOIN accounts ac ON ac.id=a.account_id
    LEFT JOIN account_identities ai ON ai.id=a.account_identity_id
    LEFT JOIN account_destinations ad ON ad.account_id=a.account_id AND ad.destination_id=a.destination_id
    LEFT JOIN page_connections pc ON pc.id=a.page_connection_id LEFT JOIN secret_refs s ON s.id=pc.secret_ref_id
    WHERE a.id=?`, approvalId);
  if (!row) throw new BusinessError('not_found');
  return row;
}
export function selectedMedia(db: Database, contentId: string): ManagedMedia[] {
  return db.prepare(`SELECT m.id,m.storage_key,m.sha256,m.mime_type,m.byte_size,cm.position,m.state
    FROM content_version_media cm JOIN media m ON m.id=cm.media_id WHERE cm.content_version_id=? ORDER BY cm.position`)
    .all(contentId) as unknown as ManagedMedia[];
}
export interface ReadinessProblem { code: BusinessErrorCode; status: 'cancelled' | 'needs_review' | 'blocked' }
export function readiness(db: Database, row: ApprovalSnapshot, expectedMode: IntegrationMode): ReadinessProblem | undefined {
  if (row.mode !== expectedMode) return { code: 'mode_mismatch', status: 'blocked' };
  if (row.product_status !== 'selling') return { code: 'not_ready', status: 'cancelled' };
  if (row.revoked || row.current_revision_id !== row.product_revision_id) return { code: 'stale_approval', status: 'needs_review' };
  if (row.destination_archived !== null || !row.external_id) return { code: 'not_ready', status: 'blocked' };
  if (row.channel === 'page') {
    if (row.page_archived !== null || row.permission_status !== 'allowed' || (expectedMode === 'live' && row.secret_status !== 'available')) {
      return { code: 'not_ready', status: 'blocked' };
    }
  } else {
    if (row.current_identity_id !== row.account_identity_id) return { code: 'stale_approval', status: 'needs_review' };
    if (row.account_archived !== null || row.paused || row.session_status !== 'logged_in'
      || row.posting_permission !== 'allowed' || (row.channel === 'group' && row.membership_status !== 'joined')) {
      return { code: 'not_ready', status: 'blocked' };
    }
  }
  const media = selectedMedia(db, row.content_version_id);
  if (!media.length || media.some((item, i) => item.state !== 'ready' || item.position !== i)) {
    return { code: 'not_ready', status: 'blocked' };
  }
}

/** Invalidation is committed with product edits. Running sends are never called cancelled. */
export function invalidateProduct(db: Database, productId: string, now: number, sold: boolean): void {
  db.prepare(`INSERT INTO approval_revocations(approval_id,reason_code,revoked_at)
    SELECT a.id,?,? FROM approvals a JOIN content_versions c ON c.id=a.content_version_id
    JOIN product_revisions r ON r.id=c.product_revision_id WHERE r.product_id=?
    ON CONFLICT(approval_id) DO NOTHING`).run(sold ? 'product_not_selling' : 'product_changed', now, productId);
  const approvals = `SELECT a.id FROM approvals a JOIN content_versions c ON c.id=a.content_version_id
    JOIN product_revisions r ON r.id=c.product_revision_id WHERE r.product_id=?`;
  db.prepare(`UPDATE publish_jobs SET status=? WHERE approval_id IN (${approvals})
    AND status IN ('queued','paused','blocked','needs_review')`).run(sold ? 'cancelled' : 'needs_review', productId);
  db.prepare(`UPDATE publish_jobs SET stop_requested_at=COALESCE(stop_requested_at,?)
    WHERE approval_id IN (${approvals}) AND status='running'`).run(now, productId);
}
