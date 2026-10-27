import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { createFakePublisher } from './fake.ts';
import { assertApprovedPublishRequest, type ApprovedPublishRequest, type PublishRequest } from './publisher.ts';

const request: PublishRequest = { jobId: 'job-1', destinationId: 'group-x', caption: 'iPhone 13 99%', mediaPaths: [] };

// Adapter giả không được gọi mạng: fetch bị thay bằng hàm ném lỗi trong suốt test
const realFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = () => {
    throw new Error('Adapter giả không được gọi mạng');
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('fake publisher', () => {
  test('mặc định mô phỏng đăng thành công, verify đọc lại được', async () => {
    const pub = createFakePublisher('group');
    assert.deepEqual(pub.capabilities, { channel: 'group', level: 'automatic', simulated: true });
    assert.ok(Object.isFrozen(pub.capabilities));
    assert.deepEqual(await pub.prepare(request), { ok: true });
    const result = await pub.submit(request);
    assert.equal(result.status, 'published');
    assert.equal(result.status === 'published' && result.remoteId, 'fake-group-job-1');
    assert.equal(result.evidence?.source, 'simulated');
    assert.ok(Number.isFinite(Date.parse(result.evidence?.observedAt ?? '')));
    const verified = await pub.verify(request);
    assert.equal(verified.status, 'published');
    assert.equal(verified.evidence?.source, 'simulated');
    assert.equal(pub.submitted.length, 1);
  });

  test('kịch bản unknown/pending và job chưa gửi thì verify not_found', async () => {
    const pub = createFakePublisher('profile', {
      submit: (r) => (r.jobId === 'job-1' ? { status: 'unknown', reason: 'timeout' } : { status: 'pending_approval' }),
    });
    assert.equal((await pub.submit(request)).status, 'unknown');
    assert.equal((await pub.verify(request)).status, 'unknown');
    assert.equal((await pub.verify(request)).status, 'unknown');
    assert.equal(pub.submitted.length, 1, 'verify unknown không được gửi lại');
    assert.equal((await pub.submit({ ...request, jobId: 'job-2' })).status, 'pending_approval');
    assert.equal((await pub.verify({ ...request, jobId: 'job-2' })).status, 'pending_approval');
    assert.equal((await pub.verify({ ...request, jobId: 'job-3' })).status, 'not_found');
    assert.equal(pub.submitted.length, 2, 'verify chỉ đọc, pending không được tự published');
  });

  test('sau stop không nhận thêm job', async () => {
    const pub = createFakePublisher('page');
    assert.deepEqual(await pub.stop(), { requested: true, futureSubmissionsBlocked: true, inFlight: 'none', remoteRecall: false });
    assert.equal((await pub.prepare(request)).ok, false);
    assert.equal((await pub.submit(request)).status, 'failed');
    assert.equal(pub.submitted.length, 0);
  });

  test('stop không thu hồi kết quả đã gửi, verify vẫn chỉ đọc', async () => {
    const pub = createFakePublisher('group');
    await pub.submit(request);
    await pub.stop();
    assert.equal((await pub.verify(request)).status, 'published');
    assert.equal((await pub.submit({ ...request, jobId: 'job-new' })).status, 'failed');
    assert.equal(pub.submitted.length, 1);
  });

  test('snapshot bất biến: sửa input sau gửi không đổi bằng chứng; sai đích/caption/media/context =>unknown', async () => {
    const pub = createFakePublisher('group');
    const input = { ...approved(), mediaPaths: ['/fake/one.jpg'] };
    await pub.submit(input);
    const saved = pub.submitted[0];
    assert.ok(saved);
    assert.ok(Object.isFrozen(saved));
    assert.ok(Object.isFrozen(saved.mediaPaths));
    assert.ok(Object.isFrozen(saved.context?.expectedIdentity));
    assert.throws(() => (saved.mediaPaths as string[]).push('/fake/other.jpg'), TypeError);
    input.caption = 'Nội dung đã đổi';
    input.mediaPaths.push('/fake/other.jpg');
    assert.equal(saved.caption, 'iPhone 13');
    assert.equal(saved.mediaPaths.length, 1);
    for (const changed of [input, { ...saved, destinationId: 'other' }, { ...saved, context: {
      ...saved.context, approvalId: 'new-approval',
    } } as PublishRequest]) {
      const result = await pub.verify(changed);
      assert.equal(result.status, 'unknown');
      assert.equal(result.reasonCode, 'request_mismatch');
    }
    assert.equal((await pub.verify(approved())).status, 'published');
    assert.equal(pub.submitted.length, 1);
  });

  test('prepare reason code chặn session/identity/đích sai trước gửi; giả không tuyên bố chứng cứ thật', async () => {
    const blocked = createFakePublisher('group', {
      prepare: () => ({ ok: false, reasonCode: 'session_expired', reason: 'Phiên giả hết hạn' }),
    });
    const prepared = await blocked.prepare(approved());
    assert.equal(prepared.ok, false);
    assert.equal((await blocked.submit(approved())).reasonCode, 'session_expired');
    assert.equal(blocked.submitted.length, 0);
    const wrongChannel = createFakePublisher('profile');
    const result = await wrongChannel.submit(approved());
    assert.equal(result.reasonCode, 'destination_not_allowed');
    assert.equal(wrongChannel.submitted.length, 0);
    const pub = createFakePublisher('group', { submit: () => ({ status: 'published', remoteId: 'fake',
      evidence: { source: 'graph_api', observedAt: '2026-01-01T00:00:00Z' } }) });
    assert.equal((await pub.submit(approved())).evidence?.source, 'simulated');
  });

  test('fixture ném lỗi lúc gửi =>unknown, không suy not_found hoặc tự gửi lại', async () => {
    const pub = createFakePublisher('group', { submit() { throw new Error('fixture'); } });
    assert.equal((await pub.submit(request)).status, 'unknown');
    assert.equal((await pub.verify(request)).status, 'unknown');
    assert.equal(pub.submitted.length, 1);
  });
});

function approved(): ApprovedPublishRequest {
  return { jobId: 'approved-job', destinationId: 'local-destination', caption: 'iPhone 13', mediaPaths: ['/fake/one.jpg'],
    context: { requestId: 'ui-request', approvalId: 'approval', contentVersionId: 'content-v1',
      expectedIdentity: { kind: 'account', localId: 'account-a', remoteId: 'facebook-a' },
      destination: { channel: 'group', remoteId: 'group-x' },
    },
  };
}

describe('approved publish boundary', () => {
  test('TCN/Page bắt buộc đúng chính danh tính đích, group được khác account', () => {
    const base = approved();
    assert.doesNotThrow(() => assertApprovedPublishRequest(base));
    for (const channel of ['profile', 'page'] as const) {
      const context = { ...base.context,
        expectedIdentity: { kind: channel === 'page' ? 'page' : 'account', localId: 'local-a', remoteId: 'remote-a' },
        destination: { channel, remoteId: 'remote-b' },
      };
      assert.throws(() => assertApprovedPublishRequest({ ...base, context }), /identity\/destination/);
      assert.doesNotThrow(() => assertApprovedPublishRequest({ ...base, context: {
        ...context, destination: { channel, remoteId: 'remote-a' },
      } }));
    }
  });

  test('context hợp lệ được chấp nhận; legacy không đủ để cấp quyền cho live/scheduler', () => {
    assert.doesNotThrow(() => assertApprovedPublishRequest(approved()));
    for (const invalid of [null, {}, request, { ...approved(), mediaPaths: [] },
      { ...approved(), context: { ...approved().context, approvalId: '' } },
      { ...approved(), context: { ...approved().context, expectedIdentity: { kind: 'account', localId: 'a', remoteId: '' } } },
      { ...approved(), context: { ...approved().context, destination: { channel: 'page', remoteId: 'page-x' } } },
    ]) assert.throws(() => assertApprovedPublishRequest(invalid), /Approved publish/);
  });
});
