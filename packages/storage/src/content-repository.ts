import { randomUUID } from 'node:crypto';
import { BusinessError, type IntegrationMode } from '#domain';
import type { Database } from './db.ts';
import { atomic, identifier, invalidateProduct, mediaIds, mode, objectInput, one, readiness, type RepositoryOptions,
  snapshot, text, timestamp } from './repository-common.ts';

export interface ProductRevisionInput {
  name: string; condition: string; mediaIds: readonly string[]; priceVnd?: number | null;
  capacityText?: string | null; batteryText?: string | null; warrantyText?: string | null; locationText?: string | null;
}
export interface ContentVersionInput {
  productRevisionId: string; destinationId?: string | null; caption: string; mediaIds: readonly string[];
  source: 'template' | 'manual' | 'llm';
}
export type ApprovalInput = { contentVersionId: string; mode: IntegrationMode } & (
  { accountId: string; accountIdentityId: string; pageConnectionId?: never }
  | { pageConnectionId: string; accountId?: never; accountIdentityId?: never }
);

export function createContentRepository(db: Database, options: RepositoryOptions = {}) {
  const clock = () => timestamp((options.clock ?? Date.now)());

  function insertRevision(productId: string, revisionNo: number, input: ProductRevisionInput, now: number): string {
    objectInput(input);
    text(input.name, 500); text(input.condition); mediaIds(input.mediaIds);
    if (input.priceVnd != null && (!Number.isSafeInteger(input.priceVnd) || input.priceVnd <= 0)) throw new BusinessError('invalid_input');
    const optional = [input.capacityText, input.batteryText, input.warrantyText, input.locationText].map((value) => {
      if (value == null) return null;
      if (typeof value === 'string' && !value.trim()) return null;
      text(value); return value.trim();
    });
    for (const id of input.mediaIds) {
      if (one<{ state: string }>(db, 'SELECT state FROM media WHERE id=?', id)?.state !== 'ready') throw new BusinessError('not_ready');
    }
    const revisionId = randomUUID();
    db.prepare(`INSERT INTO product_revisions(id,product_id,revision_no,name,condition_text,price_vnd,
      capacity_text,battery_text,warranty_text,location_text,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
      .run(revisionId, productId, revisionNo, input.name.trim(), input.condition.trim(), input.priceVnd ?? null, ...optional, now);
    const add = db.prepare('INSERT INTO product_revision_media(product_revision_id,media_id,position) VALUES(?,?,?)');
    input.mediaIds.forEach((id, position) => { add.run(revisionId, id, position); });
    db.prepare('UPDATE products SET current_revision_id=? WHERE id=?').run(revisionId, productId);
    return revisionId;
  }

  return {
    listProducts(page = 1, pageSize = 20) {
      if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000
        || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new BusinessError('invalid_input');
      return atomic(db, () => {
        const total = Number(db.prepare(`SELECT count(*) AS n FROM products p
          JOIN product_revisions r ON r.id=p.current_revision_id`).get()?.n ?? 0);
        const items = db.prepare(`SELECT p.id,p.code,p.status,p.current_revision_id AS currentRevisionId,
          r.name,r.condition_text AS condition,r.price_vnd AS priceVnd,p.created_at AS createdAt,
          (SELECT count(*) FROM product_revision_media pm WHERE pm.product_revision_id=r.id) AS mediaCount
          FROM products p JOIN product_revisions r ON r.id=p.current_revision_id
          ORDER BY p.created_at DESC,p.id LIMIT ? OFFSET ?`).all(pageSize, (page - 1) * pageSize);
        return { items, total, page, pageSize };
      });
    },

    createProduct(input: ProductRevisionInput) {
      return atomic(db, () => {
        const now = clock(); const productId = randomUUID();
        db.prepare('INSERT INTO products(id,code,created_at) VALUES(?,?,?)').run(productId, `APM-${productId}`, now);
        const revisionId = insertRevision(productId, 1, input, now);
        return { productId, revisionId };
      });
    },

    reviseProduct(productId: string, expectedRevisionId: string, input: ProductRevisionInput) {
      identifier(productId); identifier(expectedRevisionId);
      return atomic(db, () => {
        const old = one<{ current_revision_id: string; revision_no: number }>(db, `SELECT p.current_revision_id,r.revision_no
          FROM products p JOIN product_revisions r ON r.id=p.current_revision_id WHERE p.id=?`, productId);
        if (!old) throw new BusinessError('not_found');
        if (old.current_revision_id !== expectedRevisionId) throw new BusinessError('conflict');
        const now = clock();
        const revisionId = insertRevision(productId, old.revision_no + 1, input, now);
        invalidateProduct(db, productId, now, false);
        return { productId, revisionId };
      });
    },

    setProductStatus(productId: string, status: 'selling' | 'sold' | 'archived') {
      identifier(productId);
      if (!['selling', 'sold', 'archived'].includes(status)) throw new BusinessError('invalid_input');
      atomic(db, () => {
        const old = one<{ status: string }>(db, 'SELECT status FROM products WHERE id=?', productId);
        if (!old) throw new BusinessError('not_found');
        if (old.status === status) return;
        db.prepare('UPDATE products SET status=? WHERE id=?').run(status, productId);
        invalidateProduct(db, productId, clock(), status !== 'selling');
      });
    },

    createVersion(input: ContentVersionInput): string {
      objectInput(input);
      identifier(input.productRevisionId); text(input.caption); mediaIds(input.mediaIds);
      if (input.destinationId != null) identifier(input.destinationId);
      if (!['template', 'manual', 'llm'].includes(input.source)) throw new BusinessError('invalid_input');
      return atomic(db, () => {
        const product = one<{ status: string; current_revision_id: string }>(db, `SELECT p.status,p.current_revision_id
          FROM products p JOIN product_revisions r ON r.product_id=p.id WHERE r.id=?`, input.productRevisionId);
        if (!product) throw new BusinessError('not_found');
        if (product.status !== 'selling') throw new BusinessError('not_ready');
        if (product.current_revision_id !== input.productRevisionId) throw new BusinessError('stale_approval');
        if (input.destinationId != null && !one(db, 'SELECT id FROM destinations WHERE id=? AND archived_at IS NULL', input.destinationId)) {
          throw new BusinessError('not_found');
        }
        for (const id of input.mediaIds) {
          if (!one(db, `SELECT m.id FROM product_revision_media rm JOIN media m ON m.id=rm.media_id
            WHERE rm.product_revision_id=? AND rm.media_id=? AND m.state='ready'`, input.productRevisionId, id)) throw new BusinessError('not_ready');
        }
        const contentVersionId = randomUUID();
        db.prepare('INSERT INTO content_versions(id,product_revision_id,destination_id,caption,source,created_at) VALUES(?,?,?,?,?,?)')
          .run(contentVersionId, input.productRevisionId, input.destinationId ?? null, input.caption, input.source, clock());
        const add = db.prepare('INSERT INTO content_version_media(content_version_id,product_revision_id,media_id,position) VALUES(?,?,?,?)');
        input.mediaIds.forEach((id, position) => { add.run(contentVersionId, input.productRevisionId, id, position); });
        return contentVersionId;
      });
    },

    approve(input: ApprovalInput): string {
      objectInput(input);
      identifier(input.contentVersionId); mode(input.mode);
      if (input.pageConnectionId) {
        identifier(input.pageConnectionId);
        if (input.accountId || input.accountIdentityId) throw new BusinessError('invalid_input');
      } else { identifier(input.accountId); identifier(input.accountIdentityId); }
      return atomic(db, () => {
        const content = one<{ destination_id: string | null; channel: string | null }>(db, `SELECT c.destination_id,d.channel
          FROM content_versions c LEFT JOIN destinations d ON d.id=c.destination_id WHERE c.id=?`, input.contentVersionId);
        if (!content) throw new BusinessError('not_found');
        if (!content.destination_id || !content.channel) throw new BusinessError('not_ready');
        const approvalId = randomUUID();
        db.prepare(`INSERT INTO approvals(id,content_version_id,destination_id,channel,account_id,account_identity_id,
          page_connection_id,mode,approved_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(approvalId, input.contentVersionId,
          content.destination_id, content.channel, input.accountId ?? null, input.accountIdentityId ?? null,
          input.pageConnectionId ?? null, input.mode, clock());
        const problem = readiness(db, snapshot(db, approvalId), input.mode);
        if (problem) throw new BusinessError(problem.code);
        return approvalId;
      });
    },
  };
}
