import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, test } from 'node:test';
import { BusinessError, type BusinessErrorCode } from '#domain';
import { assertApprovedPublishRequest, createFakePublisher } from '#contracts';
import { type Database, migrate, openDatabase } from '#storage';
import { publishingFixture } from '#test-support';

const connections: Database[] = [];
afterEach(() => { for (const db of connections.splice(0)) db.close(); });
function fixture() {
  const db = openDatabase(':memory:'); connections.push(db); migrate(db);
  return { db, ...publishingFixture(db) };
}
function fails(code: BusinessErrorCode, fn: () => unknown) {
  assert.throws(fn, (error) => error instanceof BusinessError && error.code === code);
}
function claimed(f: ReturnType<typeof fixture>, key?: string) {
  const job = f.enqueue(key);
  const claim = f.jobs.claimNext('worker-a');
  assert.ok(claim); assert.equal(claim.jobId, job.id);
  return claim;
}

describe('version repositories', () => {
  test('lưu nháp chưa chọn đích và optional rỗng, nhưng không thể duyệt nháp thành job', () => {
    const f = fixture();
    const draft = f.content.createVersion({ ...f.versionInput, destinationId: null });
    assert.equal(f.db.prepare('SELECT destination_id FROM content_versions WHERE id=?').get(draft)?.destination_id, null);
    fails('not_ready', () => f.content.approve({ ...f.approvalInput, contentVersionId: draft }));
    const product = f.content.createProduct({ ...f.input, capacityText: '  ', warrantyText: '' });
    assert.deepEqual({ ...f.db.prepare('SELECT capacity_text,warranty_text FROM product_revisions WHERE id=?').get(product.revisionId) },
      { capacity_text: null, warranty_text: null });
  });
  test('revisions/content giữ bản gốc và thứ tự ảnh, optional thiếu giữ NULL', () => {
    const f = fixture(); const claim = claimed(f);
    const saved = f.jobs.getApprovedSnapshot(claim);
    assert.deepEqual(saved.media.map((m) => m.id), [...f.mediaIds].reverse());
    assert.equal(saved.context.expectedIdentity.remoteId, 'fake-account');
    assert.equal(saved.context.destination.remoteId, 'fake-group');
    assert.equal(f.db.prepare('SELECT price_vnd FROM product_revisions WHERE id=?').get(f.revisionId)?.price_vnd, null);
    const next = f.content.reviseProduct(f.productId, f.revisionId, { ...f.input, condition: 'Đã thay pin' });
    assert.notEqual(next.revisionId, f.revisionId);
    assert.equal(f.db.prepare('SELECT condition_text FROM product_revisions WHERE id=?').get(f.revisionId)?.condition_text, f.input.condition);
    fails('conflict', () => f.content.reviseProduct(f.productId, f.revisionId, f.input));
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM product_revisions').get()?.n, 2);
  });

  test('sửa nguồn hủy quyền duyệt và invalidate job cùng transaction, replay không tạo mới', () => {
    const f = fixture(); const original = f.enqueue('same-intent');
    f.content.reviseProduct(f.productId, f.revisionId, { ...f.input, name: 'Tên mới' });
    assert.equal(f.jobs.get(original.id).status, 'needs_review');
    assert.equal(f.jobs.enqueue({ requestKey: 'same-intent', mode: 'fake', jobs: [{ approvalId: f.approvalId, scheduledAt: f.state.now }] }).replayed, true);
    fails('stale_approval', () => f.enqueue('new-intent'));
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM command_requests').get()?.n, 1);
    assert.equal(f.jobs.claimNext('worker'), undefined);
  });

  test('sửa thiếu ảnh/lỗi không để lại product/revision hoặc làm mất approval cũ', () => {
    const f = fixture();
    fails('invalid_input', () => f.content.createProduct({ ...f.input, mediaIds: [] }));
    fails('not_ready', () => f.content.reviseProduct(f.productId, f.revisionId, { ...f.input, mediaIds: [randomUUID()] }));
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM products').get()?.n, 1);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM product_revisions').get()?.n, 1);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM approval_revocations').get()?.n, 0);
    assert.equal(f.enqueue().status, 'queued');
    fails('not_ready', () => f.content.createVersion({ ...f.versionInput, mediaIds: [randomUUID()] }));
  });

  test('duyệt sai danh tính/đích và media mất sau soạn đều không tạo approval', () => {
    const f = fixture(); const before = f.db.prepare('SELECT count(*) AS n FROM approvals').get()?.n;
    fails('conflict', () => f.content.approve({ ...f.approvalInput, accountIdentityId: randomUUID() }));
    f.db.prepare("UPDATE media SET state='missing' WHERE id=?").run(f.mediaIds[0] ?? '');
    fails('conflict', () => f.content.approve(f.approvalInput));
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM approvals').get()?.n, before);
  });
});

describe('job intents and claims', () => {
  test('hai approval cùng identity/đích trong một request bị chặn và rollback request/jobs', () => {
    const f = fixture(); const secondApproval = f.content.approve(f.approvalInput);
    fails('conflict', () => f.jobs.enqueue({ requestKey: 'duplicate-target', mode: 'fake',
      jobs: [f.approvalId, secondApproval].map((approvalId) => ({ approvalId, scheduledAt: f.state.now })) }));
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM command_requests').get()?.n, 0);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM publish_jobs').get()?.n, 0);
  });

  test('nhận và gửi đều tái kiểm tra danh tính/media/quyền sau khi enqueue', () => {
    const f = fixture(); const original = f.enqueue();
    const identity = randomUUID();
    f.db.prepare("INSERT INTO account_identities(id,account_id,version,remote_identity_id,confirmed_at) VALUES(?,?,2,'other-account',?)")
      .run(identity, f.accountId, f.state.now);
    f.db.prepare('UPDATE accounts SET current_identity_id=? WHERE id=?').run(identity, f.accountId);
    assert.equal(f.jobs.claimNext('a'), undefined);
    assert.equal(f.jobs.get(original.id).status, 'needs_review');
    const g = fixture(); const claim = claimed(g);
    g.db.prepare("UPDATE media SET state='missing' WHERE id=?").run(g.mediaIds[0] ?? '');
    fails('not_ready', () => g.jobs.markSendStarted(claim));
    assert.equal(g.jobs.get(claim.jobId).status, 'blocked');
    assert.equal(g.db.prepare('SELECT send_started_at FROM publish_attempts WHERE id=?').get(claim.attemptId)?.send_started_at, null);
  });
  test('bấm lặp trả đúng job cũ; key khác cho phép ý định mới; payload khác cùng key bị conflict', () => {
    const f = fixture(); const first = f.enqueue('intent'); const replay = f.enqueue('intent');
    assert.equal(replay.id, first.id);
    assert.notEqual(f.enqueue('intent-2').id, first.id);
    fails('idempotency_conflict', () => f.enqueue('intent', f.state.now + 1));
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM publish_jobs').get()?.n, 2);
  });

  test('batch nhiều đích canonical hóa thứ tự và rollback cả batch nếu một đích chưa đủ điều kiện', () => {
    const f = fixture(); const dest = randomUUID();
    f.db.prepare("INSERT INTO destinations(id,channel,external_id,created_at) VALUES(?,'group','group-2',?)").run(dest, f.state.now);
    f.db.prepare(`INSERT INTO account_destinations(account_id,destination_id,channel,membership_status,posting_permission,source)
      VALUES(?,?,'group','joined','allowed','fixture')`).run(f.accountId, dest);
    const contentId = f.content.createVersion({ ...f.versionInput, destinationId: dest });
    const approvalId = f.content.approve({ ...f.approvalInput, contentVersionId: contentId });
    const targets = [f.approvalId, approvalId].map((id) => ({ approvalId: id, scheduledAt: f.state.now }));
    const first = f.jobs.enqueue({ requestKey: 'batch', mode: 'fake', jobs: targets });
    const second = f.jobs.enqueue({ requestKey: 'batch', mode: 'fake', jobs: [...targets].reverse() });
    assert.equal(second.requestId, first.requestId); assert.equal(first.jobs.length, 2);
    f.db.prepare("UPDATE account_destinations SET posting_permission='unknown' WHERE destination_id=?").run(dest);
    fails('not_ready', () => f.jobs.enqueue({ requestKey: 'invalid-batch', mode: 'fake', jobs: targets }));
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM command_requests').get()?.n, 1);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM publish_jobs').get()?.n, 2);
  });

  test('không nhận trước lịch, không nhận lại running; kiểm tra quyền/current identity lúc claim', () => {
    const f = fixture(); const job = f.enqueue(undefined, f.state.now + 100);
    assert.equal(f.jobs.claimNext('a'), undefined); f.state.now += 100;
    f.db.prepare("UPDATE account_destinations SET membership_status='unknown'").run();
    assert.equal(f.jobs.claimNext('a'), undefined); assert.equal(f.jobs.get(job.id).status, 'blocked');
    fails('not_ready', () => f.jobs.changeState(job.id, 'blocked', 'queued'));
    f.db.prepare("UPDATE account_destinations SET membership_status='joined'").run();
    f.jobs.changeState(job.id, 'blocked', 'queued');
    const claim = f.jobs.claimNext('a'); assert.ok(claim);
    assert.equal(f.jobs.claimNext('b'), undefined);
    fails('claim_lost', () => f.jobs.markSendStarted({ ...claim, workerId: 'b' }));
  });

  test('mode fake/live tách biệt; Page cần đúng quyền và live secret available', () => {
    const f = fixture();
    fails('mode_mismatch', () => f.jobs.enqueue({ requestKey: 'wrong-mode', mode: 'live', jobs: [{ approvalId: f.approvalId, scheduledAt: f.state.now }] }));
    f.enqueue(); assert.equal(f.jobs.claimNext('live-worker', 'live'), undefined);
    const page = randomUUID(); const pc = randomUUID(); const secret = randomUUID();
    f.db.prepare("INSERT INTO destinations(id,channel,external_id,created_at) VALUES(?,'page','fake-page',?)").run(page, f.state.now);
    f.db.prepare("INSERT INTO secret_refs(id,provider,reference_id,status,created_at) VALUES(?,'test','not-a-secret','unconfigured',?)").run(secret, f.state.now);
    f.db.prepare("INSERT INTO page_connections(id,destination_id,remote_identity_id,secret_ref_id,permission_status,created_at) VALUES(?,?,'fake-page',?,'allowed',?)")
      .run(pc, page, secret, f.state.now);
    const version = f.content.createVersion({ ...f.versionInput, destinationId: page });
    fails('not_ready', () => f.content.approve({ contentVersionId: version, pageConnectionId: pc, mode: 'live' }));
    const approvalId = f.content.approve({ contentVersionId: version, pageConnectionId: pc, mode: 'fake' });
    f.jobs.enqueue({ requestKey: 'page', mode: 'fake', jobs: [{ approvalId, scheduledAt: f.state.now }] });
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM approvals WHERE mode=\'live\'').get()?.n, 0);
    // Only DB fixture metadata. No live adapter/config/network is instantiated.
    f.db.prepare("UPDATE secret_refs SET status='available' WHERE id=?").run(secret);
    const liveApproval = f.content.approve({ contentVersionId: version, pageConnectionId: pc, mode: 'live' });
    f.jobs.enqueue({ requestKey: 'live-page-fixture', mode: 'live', jobs: [{ approvalId: liveApproval, scheduledAt: f.state.now }] });
    const claim = f.jobs.claimNext('page-worker', 'live'); assert.ok(claim);
    const snapshot = f.jobs.getApprovedSnapshot(claim);
    assert.equal(snapshot.context.expectedIdentity.kind, 'page');
    assert.equal(snapshot.context.expectedIdentity.localId, pc);
    assert.equal(snapshot.context.destination.remoteId, 'fake-page');
  });
});

describe('send boundary and state changes', () => {
  test('DB snapshot → approved request → fake publisher → observation, đúng caption/ảnh/đích', async () => {
    const f = fixture(); const claim = claimed(f); const saved = f.jobs.getApprovedSnapshot(claim);
    const request = { jobId: saved.jobId, destinationId: saved.destinationId, caption: saved.caption,
      context: saved.context, mediaPaths: saved.media.map((m) => `fixture://${m.storage_key}`) };
    assertApprovedPublishRequest(request);
    const fake = createFakePublisher(saved.context.destination.channel);
    assert.equal((await fake.prepare(request)).ok, true);
    f.jobs.markSendStarted(claim);
    const result = await fake.submit(request); assert.equal(result.status, 'published');
    assert.ok(result.status === 'published'); assert.equal(result.evidence?.source, 'simulated');
    const done = f.jobs.finish(claim, { outcome: result.status, source: 'fake', remoteId: result.remoteId });
    assert.equal(done.status, 'published');
    assert.equal(f.db.prepare('SELECT source FROM publish_observations WHERE attempt_id=?').get(claim.attemptId)?.source, 'fake');
    assert.equal(fake.submitted[0]?.caption, request.caption);
    assert.deepEqual(fake.submitted[0]?.mediaPaths, request.mediaPaths);
  });
  test('gửi có marker đã commit; source/kết quả hợp lệ lưu observation và đóng attempt cùng transaction', () => {
    const f = fixture(); const claim = claimed(f);
    fails('invalid_transition', () => f.jobs.finish(claim, { outcome: 'published', source: 'fake', remoteId: 'fake-result' }));
    f.jobs.markSendStarted(claim);
    assert.equal(f.db.prepare('SELECT send_started_at FROM publish_attempts WHERE id=?').get(claim.attemptId)?.send_started_at, f.state.now);
    fails('invalid_transition', () => f.jobs.markSendStarted(claim));
    fails('mode_mismatch', () => f.jobs.finish(claim, { outcome: 'published', source: 'api_response', remoteId: 'fake-result' }));
    assert.equal(f.jobs.get(claim.jobId).status, 'running');
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM publish_observations').get()?.n, 0);
    assert.equal(f.jobs.finish(claim, { outcome: 'pending_approval', source: 'fake' }).status, 'pending_approval');
    fails('claim_lost', () => f.jobs.finish(claim, { outcome: 'published', source: 'fake', remoteId: 'fake-result' }));
    fails('invalid_transition', () => f.jobs.changeState(claim.jobId, 'pending_approval', 'queued'));
  });

  test('sold trước gửi ngăn gửi; sold sau marker không được giả hủy kết quả đã gửi', () => {
    const f = fixture(); const before = claimed(f);
    f.content.setProductStatus(f.productId, 'sold');
    assert.equal(f.jobs.get(before.jobId).status, 'running');
    fails('not_ready', () => f.jobs.markSendStarted(before));
    assert.equal(f.jobs.get(before.jobId).status, 'cancelled');
    assert.equal(f.db.prepare('SELECT send_started_at FROM publish_attempts WHERE id=?').get(before.attemptId)?.send_started_at, null);
    const g = fixture(); const after = claimed(g); g.jobs.markSendStarted(after);
    const queued = g.enqueue(); g.content.setProductStatus(g.productId, 'sold');
    assert.equal(g.jobs.get(queued.id).status, 'cancelled');
    assert.equal(g.jobs.get(after.jobId).status, 'running');
    assert.equal(g.jobs.finish(after, { outcome: 'published', source: 'fake', remoteId: 'fake-published' }).status, 'published');
  });

  test('sửa nguồn sau claim được kiểm tra lại ngay trước marker; old claim không còn quyền', () => {
    const f = fixture(); const claim = claimed(f);
    f.content.reviseProduct(f.productId, f.revisionId, { ...f.input, name: 'Changed' });
    fails('stale_approval', () => f.jobs.markSendStarted(claim));
    assert.equal(f.jobs.get(claim.jobId).status, 'needs_review');
    fails('claim_lost', () => f.jobs.getApprovedSnapshot(claim));
  });

  test('requestStop trước marker hủy phần chưa gửi; sau marker vẫn ghi nhận unknown đúng nghĩa', () => {
    const f = fixture(); const claim = claimed(f); f.jobs.requestStop(claim.jobId);
    fails('invalid_transition', () => f.jobs.markSendStarted(claim));
    assert.equal(f.jobs.get(claim.jobId).status, 'cancelled');
    const g = fixture(); const sent = claimed(g); g.jobs.markSendStarted(sent); g.jobs.requestStop(sent.jobId);
    assert.equal(g.jobs.finish(sent, { outcome: 'unknown', source: 'fake', reasonCode: 'network_error' }).status, 'unknown');
    fails('invalid_transition', () => g.jobs.changeState(sent.jobId, 'unknown', 'queued'));
  });

  test('claim hết hạn trước gửi cần chủ động resume; sau gửi thành unknown, không tự replay', () => {
    const f = fixture(); const claim = claimed(f); f.state.now += 30_000;
    fails('claim_lost', () => f.jobs.markSendStarted(claim));
    assert.deepEqual(f.jobs.recoverExpired(), { paused: 1, unknown: 0 });
    assert.equal(f.jobs.claimNext('b'), undefined);
    f.jobs.changeState(claim.jobId, 'paused', 'queued'); const newer = f.jobs.claimNext('worker-a'); assert.ok(newer);
    assert.equal(newer.generation, 2);
    fails('claim_lost', () => f.jobs.finish(claim, { outcome: 'failed', source: 'fake' }));
    f.jobs.markSendStarted(newer); f.state.now += 30_000;
    assert.deepEqual(f.jobs.recoverExpired(), { paused: 0, unknown: 1 });
    assert.equal(f.jobs.claimNext('c'), undefined);
    fails('invalid_transition', () => f.jobs.changeState(claim.jobId, 'unknown', 'queued'));
    assert.deepEqual(f.jobs.recoverExpired(), { paused: 0, unknown: 0 });
  });

  test('state CAS và lỗi cố định: không echo payload/secrets hoặc tạo dữ liệu dở dang', () => {
    const f = fixture(); const job = f.enqueue();
    f.jobs.changeState(job.id, 'queued', 'paused');
    fails('conflict', () => f.jobs.changeState(job.id, 'queued', 'cancelled'));
    fails('invalid_input', () => f.jobs.enqueue({ requestKey: 'x', mode: 'fake', jobs: [{ approvalId: 'private-secret', scheduledAt: 0 }] }));
    assert.ok(!new BusinessError('invalid_input').message.includes('private-secret'));
    fails('invalid_input', () => f.jobs.claimNext('a', 'fake', Number.NaN));
    fails('invalid_input', () => f.jobs.enqueue(null as unknown as Parameters<typeof f.jobs.enqueue>[0]));
    fails('invalid_input', () => f.jobs.finish({ jobId: job.id, attemptId: randomUUID(), workerId: 'a', generation: 0 },
      { outcome: 'published', source: 'fake', remoteUrl: 'https://example.invalid/post?access_token=private-secret' }));
  });
});

test('repository thật: nhiều tiến trình nhận cùng cohort, mỗi job chỉ một claim và trạng thái tồn tại sau restart', { timeout: 30_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'apm repo ')); const path = join(dir, 'test.sqlite');
  const db = openDatabase(path);
  try {
    migrate(db); const f = publishingFixture(db);
    for (let i = 0; i < 60; i++) f.enqueue(`intent-${i}`);
    db.close();
    const start = String(Date.now() + 1500);
    const script = join(import.meta.dirname, 'test-fixtures/repository-claim-loop.ts');
    const outputs = await Promise.all(Array.from({ length: 3 }, (_, i) => new Promise<string[]>((resolve, reject) => {
      const child = spawn(process.execPath, [script, path, `worker-${i}`, start], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = ''; let err = '';
      child.stdout.on('data', (chunk) => { out += chunk; }); child.stderr.on('data', (chunk) => { err += chunk; });
      child.once('error', reject); child.once('close', (code) => code === 0 ? resolve(JSON.parse(out)) : reject(new Error(err)));
    })));
    assert.equal(outputs.flat().length, 60); assert.equal(new Set(outputs.flat()).size, 60);
    assert.ok(outputs.filter((ids) => ids.length).length >= 2);
    const reopened = openDatabase(path);
    try {
      assert.equal(reopened.prepare("SELECT count(*) AS n FROM publish_jobs WHERE status='failed'").get()?.n, 60);
      assert.equal(reopened.prepare('SELECT count(*) AS n FROM publish_attempts').get()?.n, 60);
      assert.equal(reopened.prepare('SELECT count(*) AS n FROM publish_observations').get()?.n, 60);
    } finally { reopened.close(); }
  } finally {
    if (db.isOpen) db.close();
    assert.equal(dirname(dir), tmpdir());
    rmSync(dir, { recursive: true, force: true });
  }
});
