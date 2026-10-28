import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, describe, test } from 'node:test';
import sharp from 'sharp';
import type { ApprovedPublishRequest } from '#contracts';
import { createGroupPublisher } from '#fb-group';
import { createProfilePublisher } from '#fb-profile';
import { type MockFacebook, type MockFacebookOptions, startMockFacebook } from '../../../../tests/fixtures/mock-facebook.ts';

// Trang Facebook giả chạy trên Edge ngầm (không gọi mạng thật). Rút ngắn mọi khoảng chờ cho nhanh.
const timing = { uploadMs: 4_000, closeMs: 4_000, settleMs: 600, retryMs: 100, pageMs: 500, stepMs: 400, scrollMs: 100 };
let dir: string;
let images: string[];
let mock: MockFacebook | undefined;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'apm mock '));
  images = [];
  for (const [index, color] of ['#2563eb', '#dc2626'].entries()) {
    const path = join(dir, `anh-${index + 1}.png`);
    writeFileSync(path, await sharp({ create: { width: 320, height: 240, channels: 3, background: color } }).png().toBuffer());
    images.push(path);
  }
});
after(() => { rmSync(dir, { recursive: true, force: true }); });
afterEach(async () => { await mock?.close(); mock = undefined; });

const CAPTION = 'Bán iPhone 13 128GB giá tốt\nTình trạng: đẹp, pin 89%';
function groupRequest(overrides: Partial<ApprovedPublishRequest> = {}): ApprovedPublishRequest {
  return { jobId: 'job-1', destinationId: 'dest-1', caption: CAPTION, mediaPaths: images,
    context: { requestId: 'req', approvalId: 'apr', contentVersionId: 'ver',
      expectedIdentity: { kind: 'account', localId: 'acc-1', remoteId: 'vanity:nick.a' }, destination: { channel: 'group', remoteId: '123456789012' } }, ...overrides };
}
function profileRequest(): ApprovedPublishRequest {
  return groupRequest({ context: { requestId: 'req', approvalId: 'apr', contentVersionId: 'ver',
    expectedIdentity: { kind: 'account', localId: 'acc-1', remoteId: 'vanity:nick.a' }, destination: { channel: 'profile', remoteId: 'vanity:nick.a' } } });
}
async function group(options: MockFacebookOptions = {}) {
  mock = await startMockFacebook(options);
  return createGroupPublisher({ profileDirFor: () => 'khong-dung', launch: mock.launch, timing });
}

describe('adapter nhóm trên Facebook giả', () => {
  test('đăng đủ chữ và đúng 2 ảnh một lần: prepare chưa đăng gì, submit đăng đúng một lần và xác nhận bằng bài mới trong feed', async () => {
    const publisher = await group();
    const request = groupRequest();
    assert.deepEqual(await publisher.prepare(request), { ok: true });
    assert.equal(mock?.submits, 0); // chuẩn bị xong nhưng chưa gửi gì
    const result = await publisher.submit(request);
    assert.equal(result.status, 'published');
    assert.equal(mock?.submits, 1);
    assert.deepEqual(mock?.posts.map((post) => [post.text.includes('Bán iPhone 13 128GB'), post.images]), [[true, 2]]);
    assert.equal(result.status === 'published' && result.remoteId, '1000000'); // ID đọc từ liên kết gần bài
    assert.equal(result.evidence?.source, 'browser_observation');
    assert.match(result.evidence?.remoteUrl ?? '', /\/groups\/123456789012\/posts\/1000000$/u);
    assert.equal((await publisher.submit(request)).status, 'failed'); // phiên đã đóng: không gửi lại được
    assert.equal(mock?.submits, 1);
  });

  test('bấm Đăng mà không thấy bài: unknown (không giả thành công), dù feed đã có bài cùng nội dung từ trước; chỉ gửi đúng một lần', async () => {
    const publisher = await group({ swallowPost: true, existingPosts: ['Bán iPhone 13 128GB giá tốt (bài cũ)'] });
    const request = groupRequest();
    assert.deepEqual(await publisher.prepare(request), { ok: true });
    const result = await publisher.submit(request);
    assert.equal(result.status, 'unknown');
    assert.equal(mock?.submits, 1); // đã bấm một lần, không thử lại
  });

  test('ảnh từ kho có tên .blob (không đuôi ảnh) vẫn đính đúng thứ tự và đủ số lượng; file không phải ảnh dừng trước khi gửi', async () => {
    const { copyFileSync } = await import('node:fs');
    const blobs = images.map((path, index) => { const blob = join(dir, `${index}-kho-ung-dung.blob`); copyFileSync(path, blob); return blob; });
    const publisher = await group();
    const request = groupRequest({ mediaPaths: blobs });
    assert.deepEqual(await publisher.prepare(request), { ok: true });
    assert.equal((await publisher.submit(request)).status, 'published');
    assert.equal(mock?.posts[0]?.images, 2);

    const notImage = join(dir, 'khong-phai-anh.blob');
    writeFileSync(notImage, 'đây không phải ảnh');
    const bad = await publisher.prepare(groupRequest({ jobId: 'job-2', mediaPaths: [notImage] }));
    assert.deepEqual([bad.ok, !bad.ok && bad.reasonCode], [false, 'media_invalid']);
    assert.equal(mock?.submits, 1); // chỉ lần đăng đầu; lần hai dừng trước khi gửi
  });

  test('quy tắc sản phẩm: bài phải có ít nhất một ảnh — yêu cầu không ảnh bị từ chối trước khi mở trình duyệt', async () => {
    const publisher = await group();
    const result = await publisher.prepare(groupRequest({ mediaPaths: [] }));
    assert.deepEqual([result.ok, !result.ok && result.reasonCode], [false, 'invalid_request']);
    assert.equal(mock?.composerClicks, 0);
  });

  test('dừng TRƯỚC khi gửi với mã lý do đúng: chưa đăng nhập, checkpoint, sai danh tính, sai nhóm, giao diện đổi, ảnh không đính được', async () => {
    const cases: Array<[MockFacebookOptions, ApprovedPublishRequest, string]> = [
      [{ loggedIn: false }, groupRequest(), 'session_expired'],
      [{ checkpoint: true }, groupRequest(), 'checkpoint'],
      [{ vanity: 'nick.khac' }, groupRequest(), 'identity_mismatch'],
      [{ redirectGroupTo: '999999999999' }, groupRequest(), 'destination_not_allowed'],
      [{ composer: false }, groupRequest(), 'ui_changed'],
      [{ dropUploads: true }, groupRequest(), 'media_invalid'],
    ];
    for (const [options, request, reasonCode] of cases) {
      const publisher = await group(options);
      const prepared = await publisher.prepare(request);
      assert.deepEqual([prepared.ok, !prepared.ok && prepared.reasonCode], [false, reasonCode], JSON.stringify(options));
      assert.equal(mock?.submits, 0, `không được gửi: ${JSON.stringify(options)}`);
      assert.equal((await publisher.submit(request)).status, 'failed'); // không có phiên đã chuẩn bị
      await mock?.close();
      mock = undefined;
    }
  });

  test('yêu cầu không hợp lệ hoặc sai kênh bị từ chối; stop đóng phiên chưa gửi và chặn việc sau đó', async () => {
    const publisher = await group();
    const wrongChannel = groupRequest({ context: { ...groupRequest().context, destination: { channel: 'profile', remoteId: 'vanity:nick.a' } } });
    const bad = await publisher.prepare(wrongChannel);
    assert.deepEqual([bad.ok, !bad.ok && bad.reasonCode], [false, 'destination_not_allowed']);
    const noContext = await publisher.prepare({ jobId: 'j', destinationId: 'd', caption: 'abc', mediaPaths: [] });
    assert.deepEqual([noContext.ok, !noContext.ok && noContext.reasonCode], [false, 'invalid_request']);

    const request = groupRequest();
    assert.deepEqual(await publisher.prepare(request), { ok: true }); // phiên đã mở, chưa gửi
    assert.deepEqual(await publisher.stop(), { requested: true, futureSubmissionsBlocked: true, inFlight: 'none', remoteRecall: false });
    assert.equal((await publisher.submit(request)).status, 'failed'); // phiên đã bị đóng
    const after = await publisher.prepare(groupRequest({ jobId: 'job-2' }));
    assert.deepEqual([after.ok, !after.ok && after.reasonCode], [false, 'stopped']);
    assert.equal(mock?.submits, 0);
  });

  test('verify chỉ đọc: thấy bài thì published, không thấy thì not_found (không phải lệnh được gửi lại)', async () => {
    const publisher = await group({ existingPosts: ['Bán iPhone 13 128GB giá tốt'] });
    assert.equal((await publisher.verify(groupRequest())).status, 'published');
    assert.equal((await publisher.verify(groupRequest({ caption: 'Một caption khác hẳn' }))).status, 'not_found');
    assert.equal(mock?.submits, 0);
  });
});

describe('adapter trang cá nhân trên Facebook giả', () => {
  test('hai bước Tiếp → Đăng, đối tượng khớp cấu hình thì đăng', async () => {
    mock = await startMockFacebook({ audience: 'Công khai' });
    const publisher = createProfilePublisher({ profileDirFor: () => 'khong-dung', launch: mock.launch, timing, requiredAudience: 'Công khai' });
    const request = profileRequest();
    assert.deepEqual(await publisher.prepare(request), { ok: true });
    assert.equal(mock.submits, 0);
    assert.equal((await publisher.submit(request)).status, 'published');
    assert.equal(mock.submits, 1);
  });

  test('đối tượng không khớp cấu hình bắt buộc: dừng trước khi gửi; không đặt cấu hình thì không kiểm tra', async () => {
    mock = await startMockFacebook({ audience: 'Công khai' });
    const strict = createProfilePublisher({ profileDirFor: () => 'khong-dung', launch: mock.launch, timing, requiredAudience: 'Chỉ mình tôi' });
    const blocked = await strict.prepare(profileRequest());
    assert.deepEqual([blocked.ok, !blocked.ok && blocked.reasonCode], [false, 'destination_not_allowed']);
    assert.equal(mock.submits, 0);
    const lenient = createProfilePublisher({ profileDirFor: () => 'khong-dung', launch: mock.launch, timing });
    assert.deepEqual(await lenient.prepare(profileRequest()), { ok: true });
  });

  test('đăng nhập sai nick hoặc đích không trùng danh tính duyệt đều bị từ chối trước khi gửi', async () => {
    mock = await startMockFacebook({ vanity: 'nick.a' }); // đang đăng nhập nick.a
    const publisher = createProfilePublisher({ profileDirFor: () => 'khong-dung', launch: mock.launch, timing });
    const base = profileRequest();
    const asOther = { ...base, context: { ...base.context, destination: { channel: 'profile' as const, remoteId: 'vanity:nick.b' },
      expectedIdentity: { ...base.context.expectedIdentity, remoteId: 'vanity:nick.b' } } }; // bản duyệt cho nick.b nhưng trình duyệt là nick.a
    const wrongPerson = await publisher.prepare(asOther);
    assert.deepEqual([wrongPerson.ok, !wrongPerson.ok && wrongPerson.reasonCode], [false, 'identity_mismatch']);
    const crossed = { ...base, context: { ...base.context, destination: { channel: 'profile' as const, remoteId: 'vanity:nick.b' } } }; // đích khác người đăng
    const invalid = await publisher.prepare(crossed);
    assert.deepEqual([invalid.ok, !invalid.ok && invalid.reasonCode], [false, 'invalid_request']); // hợp đồng chặn từ đầu
    assert.equal(mock.submits, 0);
  });
});
