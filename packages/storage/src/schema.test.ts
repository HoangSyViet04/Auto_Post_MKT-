import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backup } from 'node:sqlite';
import { describe, test } from 'node:test';
import { JOB_STATUSES } from '#domain';
import { type Database, openDatabase } from './db.ts';
import { defineMigration, loadMigrations, migrate } from './migrate.ts';

const id = () => randomUUID();
const now = 1_700_000_000_000;
const fingerprint = 'a'.repeat(64);

function insert(db: Database, table: string, values: Record<string, string | number | null>) {
  const keys = Object.keys(values);
  db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...Object.values(values));
}

function account(db: Database, slot: number, remote = `remote-${id()}`) {
  const accountId = id();
  const identityId = id();
  insert(db, 'accounts', { id: accountId, label: `Account ${slot}`, slot, created_at: now });
  insert(db, 'account_identities', { id: identityId, account_id: accountId, version: 1, remote_identity_id: remote, confirmed_at: now });
  db.prepare('UPDATE accounts SET current_identity_id=? WHERE id=?').run(identityId, accountId);
  return { accountId, identityId, remote };
}

function destination(db: Database, channel = 'group', remote = `destination-${id()}`) {
  const destinationId = id();
  insert(db, 'destinations', { id: destinationId, channel, external_id: remote, created_at: now });
  return destinationId;
}

function relationship(db: Database, accountId: string, destinationId: string, channel = 'group') {
  insert(db, 'account_destinations', { account_id: accountId, destination_id: destinationId, channel, source: 'fixture' });
}

function media(db: Database, state = 'ready') {
  const mediaId = id();
  insert(db, 'media', { id: mediaId, storage_key: id(), sha256: fingerprint, mime_type: 'image/jpeg', byte_size: 32, state, created_at: now });
  return mediaId;
}

function content(db: Database, destinationId: string, options: { ready?: boolean; gap?: boolean; empty?: boolean } = {}) {
  const productId = id();
  const revisionId = id();
  const contentId = id();
  insert(db, 'products', { id: productId, code: `product-${productId}`, created_at: now });
  insert(db, 'product_revisions', { id: revisionId, product_id: productId, revision_no: 1, name: 'iPhone', condition_text: 'Máy đã dùng', created_at: now });
  db.prepare('UPDATE products SET current_revision_id=? WHERE id=?').run(revisionId, productId);
  const mediaId = media(db, options.ready === false ? 'staging' : 'ready');
  const secondMediaId = media(db);
  insert(db, 'product_revision_media', { product_revision_id: revisionId, media_id: mediaId, position: 0 });
  insert(db, 'product_revision_media', { product_revision_id: revisionId, media_id: secondMediaId, position: 1 });
  insert(db, 'content_versions', { id: contentId, product_revision_id: revisionId, destination_id: destinationId, caption: 'Nội dung fixture', source: 'template', created_at: now });
  if (!options.empty) insert(db, 'content_version_media', { content_version_id: contentId, product_revision_id: revisionId, media_id: mediaId, position: options.gap ? 1 : 0 });
  return { productId, revisionId, contentId, mediaId, secondMediaId };
}

function approve(db: Database, values: Record<string, string | number | null>) {
  const approvalId = id();
  insert(db, 'approvals', { id: approvalId, mode: 'fake', approved_at: now, ...values });
  return approvalId;
}

function request(db: Database, key: string = id()) {
  const requestId = id();
  insert(db, 'command_requests', { id: requestId, scope: 'publish', request_key: key, payload_fingerprint: fingerprint, created_at: now });
  return requestId;
}

function job(db: Database, approvalId: string, requestId = request(db), status = 'queued') {
  const jobId = id();
  insert(db, 'publish_jobs', { id: jobId, request_id: requestId, approval_id: approvalId, status, scheduled_at: now, created_at: now,
    ...(status === 'running' ? { claim_owner_id: id(), claim_generation: 1, claimed_at: now, claim_expires_at: now + 1000 } : {}) });
  return jobId;
}

function fixture() {
  const db = openDatabase(':memory:');
  migrate(db);
  const a = account(db, 1);
  const b = account(db, 2);
  const group = destination(db);
  const otherGroup = destination(db);
  relationship(db, a.accountId, group);
  relationship(db, b.accountId, group);
  relationship(db, a.accountId, otherGroup);
  const c = content(db, group);
  const approvalValues = { content_version_id: c.contentId, destination_id: group, channel: 'group', account_id: a.accountId, account_identity_id: a.identityId };
  return { db, a, b, group, otherGroup, ...c, approvalValues };
}

describe('offline schema migration v2', () => {
  test('fresh DB, STRICT tables, no seed, noop and foreign keys valid', () => {
    const db = openDatabase(':memory:');
    try {
      assert.deepEqual(migrate(db), { applied: [1, 2, 3], currentVersion: 3 });
      assert.deepEqual(migrate(db), { applied: [], currentVersion: 3 });
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
      const tables = db.prepare("SELECT name, strict FROM pragma_table_list WHERE schema='main' AND name NOT LIKE 'sqlite_%'").all();
      assert.ok(tables.length >= 25);
      assert.ok(tables.every((table) => table.strict === 1));
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM accounts').get()?.n, 0);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM publish_jobs').get()?.n, 0);
      const secretColumns = db.prepare('PRAGMA table_info(secret_refs)').all().map((column) => column.name);
      assert.deepEqual(secretColumns, ['id', 'provider', 'reference_id', 'status', 'created_at']);
    } finally { db.close(); }
  });

  test('upgrade v1 preserves WAL data; online backup restores v1 independently before upgrading restored copy', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'apm schema dữ liệu '));
    const livePath = join(dir, 'live.sqlite');
    const backupPath = join(dir, 'snapshot-v1.sqlite');
    const restoredPath = join(dir, 'restored.sqlite');
    const db = openDatabase(livePath);
    const migrations = loadMigrations();
    try {
      assert.deepEqual(migrate(db, migrations.slice(0, 1)), { applied: [1], currentVersion: 1 });
      db.prepare('INSERT INTO app_meta(key,value) VALUES (?,?)').run('upgrade-sentinel', 'giữ dữ liệu');
      assert.ok(existsSync(`${livePath}-wal`));
      assert.ok(await backup(db, backupPath) > 0);
      assert.deepEqual(migrate(db), { applied: [2, 3], currentVersion: 3 });
      assert.equal(db.prepare("SELECT value FROM app_meta WHERE key='upgrade-sentinel'").get()?.value, 'giữ dữ liệu');
      copyFileSync(backupPath, restoredPath);
      const restored = openDatabase(restoredPath);
      try {
        assert.equal(restored.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()?.v, 1);
        assert.equal(restored.prepare("SELECT value FROM app_meta WHERE key='upgrade-sentinel'").get()?.value, 'giữ dữ liệu');
        assert.equal(restored.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='products'").get()?.n, 0);
        assert.deepEqual(migrate(restored), { applied: [2, 3], currentVersion: 3 });
        assert.equal(restored.prepare("SELECT value FROM app_meta WHERE key='upgrade-sentinel'").get()?.value, 'giữ dữ liệu');
      } finally { restored.close(); }
      assert.equal(db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()?.v, 3, 'restore never overwrites upgraded live database');
    } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('failed v2 rolls back all new tables and preserves existing v1 data', () => {
    const db = openDatabase(':memory:');
    const migrations = loadMigrations();
    try {
      migrate(db, migrations.slice(0, 1));
      db.prepare('INSERT INTO app_meta(key,value) VALUES (?,?)').run('preserve', 'sentinel');
      const v2 = migrations[1];
      assert.ok(v2);
      assert.throws(() => migrate(db, [migrations[0], defineMigration(2, 'bad', `${v2.sql}\nSELECT * FROM missing_table;`)].filter((item) => item !== undefined)), /rollback/);
      assert.equal(db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()?.v, 1);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='products'").get()?.n, 0);
      assert.equal(db.prepare("SELECT value FROM app_meta WHERE key='preserve'").get()?.value, 'sentinel');
    } finally { db.close(); }
  });
});

describe('approval identity and media constraints', () => {
  test('identity, content and destination tuples cannot cross accounts or targets', () => {
    const f = fixture();
    const { db } = f;
    try {
      assert.throws(() => approve(db, { ...f.approvalValues, account_identity_id: f.b.identityId }), /identity/);
      assert.throws(() => db.prepare('UPDATE accounts SET current_identity_id=? WHERE id=?').run(f.b.identityId, f.a.accountId), /FOREIGN KEY/);
      assert.throws(() => approve(db, { ...f.approvalValues, destination_id: f.otherGroup }), /FOREIGN KEY/);
      const approvalId = approve(db, f.approvalValues);
      const jobId = job(db, approvalId);
      const resolved = db.prepare('SELECT a.account_id,a.account_identity_id,a.destination_id,a.content_version_id FROM publish_jobs j JOIN approvals a ON a.id=j.approval_id WHERE j.id=?').get(jobId);
      assert.deepEqual({ ...resolved }, { account_id: f.a.accountId, account_identity_id: f.a.identityId, destination_id: f.group, content_version_id: f.contentId });
      assert.throws(() => db.prepare('UPDATE approvals SET account_id=? WHERE id=?').run(f.b.accountId, approvalId), /immutable/);
      assert.throws(() => db.prepare('UPDATE destinations SET external_id=? WHERE id=?').run('different-target', f.group), /immutable/);
      assert.throws(() => db.prepare('UPDATE account_identities SET remote_identity_id=? WHERE id=?').run('different-user', f.a.identityId), /immutable/);
      const otherApproval = approve(db, { ...f.approvalValues, account_id: f.b.accountId, account_identity_id: f.b.identityId });
      assert.throws(() => db.prepare('UPDATE publish_jobs SET approval_id=? WHERE id=?').run(otherApproval, jobId), /immutable/);
    } finally { db.close(); }
  });

  test('profile self identity and Page connection must match exact destination', () => {
    const f = fixture();
    const { db } = f;
    try {
      const profile = destination(db, 'profile', f.a.remote);
      relationship(db, f.a.accountId, profile, 'profile');
      relationship(db, f.b.accountId, profile, 'profile');
      const profileContent = content(db, profile);
      const values = { ...f.approvalValues, content_version_id: profileContent.contentId, destination_id: profile, channel: 'profile' };
      approve(db, values);
      assert.throws(() => approve(db, { ...values, account_id: f.b.accountId, account_identity_id: f.b.identityId }), /profile destination/);
      const pageA = destination(db, 'page', 'page-A');
      const pageB = destination(db, 'page', 'page-B');
      const connectionA = id();
      insert(db, 'page_connections', { id: connectionA, destination_id: pageA, remote_identity_id: 'page-A', created_at: now });
      assert.throws(() => insert(db, 'page_connections', { id: id(), destination_id: pageB, remote_identity_id: 'page-A', created_at: now }), /FOREIGN KEY/);
      const pageContentA = content(db, pageA);
      const pageContentB = content(db, pageB);
      const pageValues = { content_version_id: pageContentA.contentId, destination_id: pageA, channel: 'page', page_connection_id: connectionA };
      approve(db, pageValues);
      assert.throws(() => approve(db, { ...pageValues, content_version_id: pageContentB.contentId, destination_id: pageB }), /FOREIGN KEY/);
      assert.throws(() => approve(db, { ...pageValues, account_id: f.a.accountId }), /CHECK/);
      assert.throws(() => db.prepare('UPDATE page_connections SET destination_id=? WHERE id=?').run(pageB, connectionA), /immutable/);
    } finally { db.close(); }
  });

  test('approval freezes bytes, revision/content snapshots and selected media order', () => {
    const f = fixture();
    const { db } = f;
    try {
      const other = content(db, f.group);
      assert.throws(() => insert(db, 'content_version_media', { content_version_id: f.contentId, product_revision_id: other.revisionId, media_id: other.mediaId, position: 1 }), /FOREIGN KEY/);
      assert.throws(() => insert(db, 'content_version_media', { content_version_id: f.contentId, product_revision_id: f.revisionId, media_id: other.mediaId, position: 1 }), /FOREIGN KEY/);
      assert.throws(() => insert(db, 'content_version_media', { content_version_id: f.contentId, product_revision_id: f.revisionId, media_id: f.secondMediaId, position: 0 }), /UNIQUE/);
      const secondMedia = media(db);
      assert.throws(() => insert(db, 'product_revision_media', { product_revision_id: f.revisionId, media_id: secondMedia, position: 2 }), /already consumed/);
      approve(db, f.approvalValues);
      assert.throws(() => db.prepare('UPDATE content_versions SET caption=? WHERE id=?').run('changed', f.contentId), /immutable/);
      assert.throws(() => db.prepare('UPDATE product_revisions SET name=? WHERE id=?').run('changed', f.revisionId), /immutable/);
      assert.throws(() => db.prepare('UPDATE content_version_media SET position=5 WHERE content_version_id=?').run(f.contentId), /immutable/);
      assert.throws(() => db.prepare('DELETE FROM content_version_media WHERE content_version_id=?').run(f.contentId), /immutable/);
      assert.throws(() => insert(db, 'content_version_media', { content_version_id: f.contentId, product_revision_id: f.revisionId, media_id: f.secondMediaId, position: 1 }), /already approved/);
      assert.throws(() => db.prepare('UPDATE media SET storage_key=? WHERE id=?').run(id(), f.mediaId), /immutable/);
      assert.throws(() => db.prepare('UPDATE media SET sha256=? WHERE id=?').run('b'.repeat(64), f.mediaId), /immutable/);
      db.prepare("UPDATE media SET state='missing' WHERE id=?").run(f.mediaId);
      assert.equal(db.prepare('SELECT state FROM media WHERE id=?').get(f.mediaId)?.state, 'missing', 'state remains mutable for runtime revalidation');
    } finally { db.close(); }
  });

  test('empty, unready, gapped media and stale identities cannot be approved', () => {
    const f = fixture();
    const { db } = f;
    try {
      for (const options of [{ empty: true }, { ready: false }, { gap: true }]) {
        const c = content(db, f.group, options);
        assert.throws(() => approve(db, { ...f.approvalValues, content_version_id: c.contentId }), /media/);
      }
      const newerIdentity = id();
      insert(db, 'account_identities', { id: newerIdentity, account_id: f.a.accountId, version: 2, remote_identity_id: f.a.remote, confirmed_at: now + 1 });
      db.prepare('UPDATE accounts SET current_identity_id=? WHERE id=?').run(newerIdentity, f.a.accountId);
      assert.throws(() => approve(db, f.approvalValues), /current account identity/);
      const approved = approve(db, { ...f.approvalValues, account_identity_id: newerIdentity });
      assert.ok(approved);
      assert.throws(() => db.prepare('UPDATE products SET current_revision_id=? WHERE id=?').run(content(db, f.group).revisionId, f.productId), /FOREIGN KEY/);
      assert.equal(db.prepare('SELECT price_vnd FROM product_revisions WHERE id=?').get(f.revisionId)?.price_vnd, null);
      assert.throws(() => insert(db, 'product_revisions', { id: id(), product_id: f.productId, revision_no: 2, name: 'fixture', condition_text: 'fixture', price_vnd: 0, created_at: now }), /CHECK/);
    } finally { db.close(); }
  });

  test('active slots limit two accounts while preserving archived account history', () => {
    const f = fixture();
    try {
      assert.throws(() => account(f.db, 1), /UNIQUE/);
      assert.throws(() => account(f.db, 3), /CHECK/);
      f.db.prepare('UPDATE accounts SET archived_at=? WHERE id=?').run(now + 1, f.a.accountId);
      const replacement = account(f.db, 1);
      assert.notEqual(replacement.accountId, f.a.accountId);
      assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM accounts').get()?.n, 3);
      assert.throws(() => approve(f.db, f.approvalValues), /current account identity/);
    } finally { f.db.close(); }
  });
});

describe('job intent, provenance and lease constraints', () => {
  test('idempotency is per request and target identity; a new intent may reuse an approval', () => {
    const f = fixture();
    try {
      const approvalId = approve(f.db, f.approvalValues);
      const requestId = request(f.db, 'same-intent');
      job(f.db, approvalId, requestId);
      assert.throws(() => job(f.db, approvalId, requestId), /request already|UNIQUE/);
      const secondApproval = approve(f.db, f.approvalValues);
      assert.throws(() => job(f.db, secondApproval, requestId), /request already/);
      assert.throws(() => request(f.db, 'same-intent'), /UNIQUE/);
      assert.throws(() => f.db.prepare('UPDATE command_requests SET payload_fingerprint=? WHERE id=?').run('b'.repeat(64), requestId), /immutable/);
      assert.ok(job(f.db, approvalId));
      const otherAccountApproval = approve(f.db, { ...f.approvalValues, account_id: f.b.accountId, account_identity_id: f.b.identityId });
      assert.ok(job(f.db, otherAccountApproval, requestId), 'same destination, distinct selected account is a distinct target identity');
      insert(f.db, 'approval_revocations', { approval_id: approvalId, reason_code: 'owner_revoked', revoked_at: now });
      assert.throws(() => job(f.db, approvalId), /revoked/);
      assert.throws(() => f.db.prepare('DELETE FROM approval_revocations WHERE approval_id=?').run(approvalId), /immutable/);
    } finally { f.db.close(); }
  });

  test('all domain job statuses accepted; invalid or unclaimed running status rejected', () => {
    const f = fixture();
    try {
      const approvalId = approve(f.db, f.approvalValues);
      for (const status of JOB_STATUSES) assert.ok(job(f.db, approvalId, request(f.db), status));
      assert.throws(() => job(f.db, approvalId, request(f.db), 'draft'), /CHECK/);
      assert.throws(() => insert(f.db, 'publish_jobs', { id: id(), request_id: request(f.db), approval_id: approvalId, status: 'running', scheduled_at: now, created_at: now }), /CHECK/);
    } finally { f.db.close(); }
  });

  test('send marker is durable; unknown/pending provenance is append-only and fake is distinguished', () => {
    const f = fixture();
    try {
      const approvalId = approve(f.db, f.approvalValues);
      const jobId = job(f.db, approvalId);
      const attemptId = id();
      insert(f.db, 'publish_attempts', { id: attemptId, job_id: jobId, attempt_no: 1, started_at: now });
      f.db.prepare('UPDATE publish_attempts SET send_started_at=? WHERE id=?').run(now + 1, attemptId);
      assert.throws(() => f.db.prepare('DELETE FROM publish_attempts WHERE id=?').run(attemptId), /durable/);
      assert.throws(() => f.db.prepare('DELETE FROM publish_jobs WHERE id=?').run(jobId), /durable/);
      assert.throws(() => f.db.prepare('UPDATE publish_attempts SET send_started_at=NULL WHERE id=?').run(attemptId), /already recorded/);
      assert.throws(() => f.db.prepare('UPDATE publish_attempts SET send_started_at=? WHERE id=?').run(now + 2, attemptId), /already recorded/);
      f.db.prepare('UPDATE publish_attempts SET finished_at=? WHERE id=?').run(now + 3, attemptId);
      assert.throws(() => f.db.prepare('UPDATE publish_attempts SET finished_at=NULL WHERE id=?').run(attemptId), /already recorded/);
      const observationId = id();
      insert(f.db, 'publish_observations', { id: observationId, attempt_id: attemptId, outcome: 'unknown', source: 'fake', reason_code: 'timeout_fixture', observed_at: now + 2 });
      insert(f.db, 'publish_observations', { id: id(), attempt_id: attemptId, outcome: 'pending_approval', source: 'fake', observed_at: now + 3 });
      assert.throws(() => insert(f.db, 'publish_observations', { id: id(), attempt_id: attemptId, outcome: 'published', source: 'fake', observed_at: now + 4 }), /CHECK/);
      insert(f.db, 'publish_observations', { id: id(), attempt_id: attemptId, outcome: 'published', source: 'fake', remote_id: 'fake-result', observed_at: now + 4 });
      assert.throws(() => insert(f.db, 'publish_observations', { id: id(), attempt_id: attemptId, outcome: 'unknown', source: 'ui_observation', observed_at: now + 5 }), /mode mismatch/);
      assert.throws(() => insert(f.db, 'publish_observations', { id: id(), attempt_id: attemptId, outcome: 'unknown', source: 'guessed', observed_at: now + 5 }), /CHECK/);
      assert.throws(() => insert(f.db, 'publish_observations', { id: id(), attempt_id: attemptId, outcome: 'probably_published', source: 'fake', observed_at: now + 5 }), /CHECK/);
      const liveApprovalId = approve(f.db, { ...f.approvalValues, mode: 'live' });
      const liveJobId = job(f.db, liveApprovalId);
      const liveAttemptId = id();
      insert(f.db, 'publish_attempts', { id: liveAttemptId, job_id: liveJobId, attempt_no: 1, started_at: now });
      assert.throws(() => insert(f.db, 'publish_observations', { id: id(), attempt_id: liveAttemptId, outcome: 'unknown', source: 'fake', observed_at: now + 5 }), /mode mismatch/);
      assert.throws(() => f.db.prepare("UPDATE publish_observations SET outcome='published' WHERE id=?").run(observationId), /immutable/);
      assert.equal(f.db.prepare('SELECT status FROM publish_jobs WHERE id=?').get(jobId)?.status, 'queued', 'observations do not silently drive unimplemented scheduler transitions');
    } finally { f.db.close(); }
  });

  test('lease binding and fence cannot reset, decrease or transfer owner without increment', () => {
    const f = fixture();
    try {
      const key = `browser:${f.a.accountId}`;
      insert(f.db, 'resource_leases', { resource_key: key, resource_kind: 'browser', account_id: f.a.accountId, owner_id: 'worker-A', fence: 1, expires_at: now });
      assert.throws(() => f.db.prepare('UPDATE resource_leases SET owner_id=? WHERE resource_key=?').run('worker-B', key), /fence/);
      f.db.prepare('UPDATE resource_leases SET owner_id=?,fence=2 WHERE resource_key=?').run('worker-B', key);
      assert.throws(() => f.db.prepare('UPDATE resource_leases SET fence=1 WHERE resource_key=?').run(key), /fence/);
      assert.throws(() => f.db.prepare('DELETE FROM resource_leases WHERE resource_key=?').run(key), /fence/);
      assert.throws(() => insert(f.db, 'resource_leases', { resource_key: 'browser:wrong', resource_kind: 'browser', account_id: f.a.accountId, owner_id: 'worker-C', fence: 1, expires_at: now }), /CHECK/);
    } finally { f.db.close(); }
  });

  test('scanner and preset foundation retains source account and exact target pair', () => {
    const f = fixture();
    try {
      const scanId = id();
      assert.throws(() => insert(f.db, 'scan_runs', { id: id(), account_id: f.a.accountId, account_identity_id: f.b.identityId, mode: 'joined', result_limit: 5, simulated: 1, created_at: now }), /FOREIGN KEY/);
      assert.throws(() => insert(f.db, 'scan_runs', { id: id(), account_id: f.a.accountId, mode: 'keyword', result_limit: 5, simulated: 1, created_at: now }), /CHECK/);
      insert(f.db, 'scan_runs', { id: scanId, account_id: f.a.accountId, account_identity_id: f.a.identityId, mode: 'keyword', keyword: 'điện thoại', result_limit: 5, status: 'partial', simulated: 1, created_at: now });
      insert(f.db, 'scan_results', { id: id(), scan_run_id: scanId, destination_id: f.group, observed_at: now });
      assert.throws(() => insert(f.db, 'scan_results', { id: id(), scan_run_id: scanId, destination_id: f.group, observed_at: now }), /UNIQUE/);
      assert.throws(() => f.db.prepare('UPDATE scan_runs SET account_id=?, account_identity_id=? WHERE id=?').run(f.b.accountId, f.b.identityId, scanId), /immutable scan identity/);
      assert.throws(() => f.db.prepare("UPDATE scan_results SET membership_status='joined' WHERE scan_run_id=?").run(scanId), /immutable scan result/);
      const page = destination(f.db, 'page', 'preset-page');
      assert.throws(() => insert(f.db, 'scan_results', { id: id(), scan_run_id: scanId, destination_id: page, observed_at: now }), /FOREIGN KEY/);
      const presetId = id();
      insert(f.db, 'posting_presets', { id: presetId, label: 'Fixture preset', schedule_policy_json: '{}', created_at: now });
      assert.throws(() => insert(f.db, 'posting_presets', { id: id(), label: 'Bad preset', schedule_policy_json: '[]', created_at: now }), /CHECK/);
      insert(f.db, 'preset_targets', { id: id(), preset_id: presetId, destination_id: f.group, channel: 'group', account_id: f.a.accountId });
      assert.throws(() => insert(f.db, 'preset_targets', { id: id(), preset_id: presetId, destination_id: f.group, channel: 'group', account_id: f.a.accountId }), /UNIQUE/);
      assert.throws(() => insert(f.db, 'preset_targets', { id: id(), preset_id: presetId, destination_id: page, channel: 'page', account_id: f.a.accountId }), /CHECK/);
    } finally { f.db.close(); }
  });

  test('OR REPLACE cannot erase send marker, observation, request or lease fence through configured connections', () => {
    const f = fixture();
    try {
      assert.equal(f.db.prepare('PRAGMA recursive_triggers').get()?.recursive_triggers, 1);
      const approvalId = approve(f.db, f.approvalValues);
      const requestId = request(f.db, 'preserved-key');
      const jobId = job(f.db, approvalId, requestId);
      const attemptId = id();
      insert(f.db, 'publish_attempts', { id: attemptId, job_id: jobId, attempt_no: 1, started_at: now, send_started_at: now + 1 });
      assert.throws(() => f.db.prepare('INSERT OR REPLACE INTO publish_attempts(id,job_id,attempt_no,started_at) VALUES(?,?,?,?)').run(attemptId, jobId, 1, now), /durable/);
      assert.equal(f.db.prepare('SELECT send_started_at FROM publish_attempts WHERE id=?').get(attemptId)?.send_started_at, now + 1);
      const observationId = id();
      insert(f.db, 'publish_observations', { id: observationId, attempt_id: attemptId, outcome: 'unknown', source: 'fake', observed_at: now + 2 });
      assert.throws(() => f.db.prepare("INSERT OR REPLACE INTO publish_observations(id,attempt_id,outcome,source,remote_id,observed_at) VALUES(?,?,'published','fake','replacement',?)").run(observationId, attemptId, now + 3), /immutable/);
      assert.equal(f.db.prepare('SELECT outcome FROM publish_observations WHERE id=?').get(observationId)?.outcome, 'unknown');
      assert.throws(() => f.db.prepare("INSERT OR REPLACE INTO command_requests(id,scope,request_key,payload_fingerprint,created_at) VALUES(?,'publish','preserved-key',?,?)").run(id(), 'b'.repeat(64), now), /immutable/);
      const key = `browser:${f.a.accountId}`;
      insert(f.db, 'resource_leases', { resource_key: key, resource_kind: 'browser', account_id: f.a.accountId, owner_id: 'worker-A', fence: 5, expires_at: now });
      assert.throws(() => f.db.prepare("INSERT OR REPLACE INTO resource_leases(resource_key,resource_kind,account_id,owner_id,fence,expires_at) VALUES(?,'browser',?,'worker-B',1,?)").run(key, f.a.accountId, now), /fence/);
      assert.equal(f.db.prepare('SELECT fence FROM resource_leases WHERE resource_key=?').get(key)?.fence, 5);
    } finally { f.db.close(); }
  });

  test('idempotent DO NOTHING preserves immutable request; conditional lease UPSERT preserves fencing rules', () => {
    const f = fixture();
    try {
      const requestId = request(f.db, 'idempotent-key');
      f.db.prepare("INSERT INTO command_requests(id,scope,request_key,payload_fingerprint,created_at) VALUES(?,'publish','idempotent-key',?,?) ON CONFLICT(scope,request_key) DO NOTHING").run(id(), 'b'.repeat(64), now);
      const preserved = f.db.prepare("SELECT id,payload_fingerprint FROM command_requests WHERE scope='publish' AND request_key='idempotent-key'").get();
      assert.equal(preserved?.id, requestId);
      assert.equal(preserved?.payload_fingerprint, fingerprint, 'repository still must compare fingerprints, DO NOTHING is not payload validation');
      const key = `browser:${f.a.accountId}`;
      insert(f.db, 'resource_leases', { resource_key: key, resource_kind: 'browser', account_id: f.a.accountId, owner_id: 'worker-A', fence: 1, expires_at: now });
      const upsert = f.db.prepare("INSERT INTO resource_leases(resource_key,resource_kind,account_id,owner_id,fence,expires_at) VALUES(?,'browser',?,?,?,?) ON CONFLICT(resource_key) DO UPDATE SET owner_id=excluded.owner_id,fence=excluded.fence,expires_at=excluded.expires_at WHERE resource_leases.expires_at<=?");
      upsert.run(key, f.a.accountId, 'worker-B', 2, now + 1000, now);
      assert.equal(f.db.prepare('SELECT fence FROM resource_leases WHERE resource_key=?').get(key)?.fence, 2);
      assert.equal(upsert.run(key, f.a.accountId, 'worker-C', 3, now + 2000, now).changes, 0, 'unexpired lease cannot be taken by this conditional UPSERT');
      assert.throws(() => upsert.run(key, f.a.accountId, 'worker-C', 2, now + 2000, now + 1000), /fence/);
      assert.equal(f.db.prepare('SELECT owner_id FROM resource_leases WHERE resource_key=?').get(key)?.owner_id, 'worker-B');
    } finally { f.db.close(); }
  });

  test('REPLACE also protects unreferenced media, destination and Page identities through alternate unique keys', () => {
    const db = openDatabase(':memory:');
    try {
      migrate(db);
      const mediaId = media(db);
      const storageKey = db.prepare('SELECT storage_key FROM media WHERE id=?').get(mediaId)?.storage_key;
      assert.equal(typeof storageKey, 'string');
      assert.throws(() => db.prepare("INSERT OR REPLACE INTO media(id,storage_key,sha256,mime_type,byte_size,state,created_at) VALUES(?,?,?,'image/png',64,'ready',?)").run(id(), String(storageKey), 'b'.repeat(64), now), /immutable media/);
      assert.equal(db.prepare('SELECT id FROM media WHERE storage_key=?').get(String(storageKey))?.id, mediaId);
      const page = destination(db, 'page', 'standalone-page');
      assert.throws(() => db.prepare("INSERT OR REPLACE INTO destinations(id,channel,external_id,created_at) VALUES(?,'page','standalone-page',?)").run(id(), now), /immutable destination/);
      const connectionId = id();
      insert(db, 'page_connections', { id: connectionId, destination_id: page, remote_identity_id: 'standalone-page', created_at: now });
      assert.throws(() => db.prepare("INSERT OR REPLACE INTO page_connections(id,destination_id,remote_identity_id,created_at) VALUES(?,?,'standalone-page',?)").run(id(), page, now), /immutable page/);
      assert.equal(db.prepare('SELECT id FROM page_connections WHERE destination_id=?').get(page)?.id, connectionId);
    } finally { db.close(); }
  });
});
