import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { createFakePublisher } from './fake.ts';
import type { PublishRequest } from './publisher.ts';

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
    assert.deepEqual(await pub.prepare(request), { ok: true });
    assert.deepEqual(await pub.submit(request), { status: 'published', remoteId: 'fake-group-job-1' });
    assert.deepEqual(await pub.verify(request), { status: 'published' });
    assert.equal(pub.submitted.length, 1);
  });

  test('kịch bản unknown/pending và job chưa gửi thì verify not_found', async () => {
    const pub = createFakePublisher('profile', {
      submit: (r) => (r.jobId === 'job-1' ? { status: 'unknown', reason: 'timeout' } : { status: 'pending_approval' }),
    });
    assert.equal((await pub.submit(request)).status, 'unknown');
    assert.deepEqual(await pub.verify(request), { status: 'unknown' });
    assert.deepEqual(await pub.verify(request), { status: 'unknown' });
    assert.equal(pub.submitted.length, 1, 'verify unknown không được gửi lại');
    assert.equal((await pub.submit({ ...request, jobId: 'job-2' })).status, 'pending_approval');
    assert.deepEqual(await pub.verify({ ...request, jobId: 'job-3' }), { status: 'not_found' });
    assert.equal(pub.submitted.length, 2, 'verify chỉ đọc, pending không được tự published');
  });

  test('sau stop không nhận thêm job', async () => {
    const pub = createFakePublisher('page');
    await pub.stop();
    assert.equal((await pub.prepare(request)).ok, false);
    assert.equal((await pub.submit(request)).status, 'failed');
    assert.equal(pub.submitted.length, 0);
  });
});
