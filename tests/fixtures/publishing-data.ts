/** Fake DB records only: no files, real account credentials or network. Not a production seed. */
import { randomUUID } from 'node:crypto';
import type { Database } from '#storage';
import { createContentRepository, createJobRepository } from '#storage';
import { getAppEnv, getIntegrationMode } from '#config';

export function publishingFixture(db: Database, options: { mediaIds?: readonly string[] } = {}) {
  if (getAppEnv() !== 'test' || getIntegrationMode() !== 'fake') throw new Error('Test fixtures require test/fake mode');
  const state = { now: 1_700_000_000_000 };
  const clockOptions = { clock: () => state.now };
  const content = createContentRepository(db, clockOptions);
  const jobs = createJobRepository(db, clockOptions);
  const accountId = randomUUID(); const identityId = randomUUID(); const groupId = randomUUID();
  db.prepare("INSERT INTO accounts(id,label,slot,session_status,created_at) VALUES(?,'Fake account',1,'logged_in',?)").run(accountId, state.now);
  db.prepare("INSERT INTO account_identities(id,account_id,version,remote_identity_id,confirmed_at) VALUES(?,?,1,'fake-account',?)")
    .run(identityId, accountId, state.now);
  db.prepare('UPDATE accounts SET current_identity_id=? WHERE id=?').run(identityId, accountId);
  db.prepare("INSERT INTO destinations(id,channel,external_id,created_at) VALUES(?,'group','fake-group',?)").run(groupId, state.now);
  db.prepare(`INSERT INTO account_destinations(account_id,destination_id,channel,membership_status,posting_permission,source)
    VALUES(?,?,'group','joined','allowed','fixture')`).run(accountId, groupId);
  const mediaIds = options.mediaIds ?? [randomUUID(), randomUUID()];
  for (const id of options.mediaIds ? [] : mediaIds) {
    db.prepare("INSERT INTO media(id,storage_key,sha256,mime_type,byte_size,state,created_at) VALUES(?,?,?,'image/jpeg',32,'ready',?)")
      .run(id, randomUUID(), 'a'.repeat(64), state.now);
  }
  const input = { name: 'iPhone 13', condition: 'Máy đã dùng, xước viền', mediaIds };
  const product = content.createProduct(input);
  const versionInput = { productRevisionId: product.revisionId, destinationId: groupId,
    caption: 'iPhone 13\nTình trạng: Máy đã dùng, xước viền', mediaIds: [...mediaIds].reverse(), source: 'template' as const };
  const contentVersionId = content.createVersion(versionInput);
  const approvalInput = { contentVersionId, mode: 'fake' as const, accountId, accountIdentityId: identityId };
  const approvalId = content.approve(approvalInput);
  function enqueue(key: string = randomUUID(), scheduledAt = state.now) {
    const result = jobs.enqueue({ requestKey: key, mode: 'fake', jobs: [{ approvalId, scheduledAt }] });
    const job = result.jobs[0];
    if (!job) throw new Error('Fixture job missing');
    return job;
  }
  return { state, content, jobs, accountId, identityId, groupId, mediaIds, input, ...product,
    versionInput, contentVersionId, approvalInput, approvalId, enqueue };
}
