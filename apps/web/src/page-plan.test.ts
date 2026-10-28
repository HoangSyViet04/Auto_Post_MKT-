import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PageConnectionItem } from '#domain';
import { PAGE_MAX_PHOTOS, pageBlocker, pagePlanProblems, pagePlanSignature } from './page-plan.ts';

const NOW = Date.UTC(2026, 9, 28, 8, 0); // 15:00 giờ Việt Nam
const page = (overrides: Partial<PageConnectionItem> = {}): PageConnectionItem => ({ id: 'c1', destinationId: 'd1', pageId: '107892312229541', name: 'Góc Nghiện Đồ Hay',
  permissionStatus: 'allowed', secretStatus: 'available', checkedAt: NOW, createdAt: NOW, canPost: true, ...overrides });
const ready = { page: page(), productId: 'p1', productSelling: true, photoCount: 2, caption: 'Bài thử', startMode: 'now' as const, startLocal: '', now: NOW };

test('sẵn sàng khi có Page đủ điều kiện, máy đang bán, caption, ≤ giới hạn ảnh và giờ hợp lệ', () => {
  assert.deepEqual(pagePlanProblems(ready), []);
  assert.deepEqual(pagePlanProblems({ ...ready, startMode: 'later', startLocal: '2026-10-28T16:00' }), []);
});

test('báo đúng lý do: chưa chọn Page/máy, máy đã bán, quá nhiều ảnh, caption trống, giờ sai', () => {
  assert.deepEqual(pagePlanProblems({ ...ready, page: undefined, productId: '' }), ['Chọn Page.', 'Chọn máy.']);
  assert.match(pagePlanProblems({ ...ready, productSelling: false })[0] ?? '', /đã bán/u);
  assert.match(pagePlanProblems({ ...ready, photoCount: PAGE_MAX_PHOTOS + 1 })[0] ?? '', /tối đa 10 ảnh/u);
  assert.deepEqual(pagePlanProblems({ ...ready, caption: '  \n ' }), ['Chưa có caption.']);
  assert.match(pagePlanProblems({ ...ready, startMode: 'later', startLocal: '2026-10-28T09:00' })[0] ?? '', /Giờ hẹn/u); // đã qua 6 giờ
  assert.match(pagePlanProblems({ ...ready, startMode: 'later', startLocal: '' })[0] ?? '', /Giờ hẹn/u);
});

test('Page bị chặn được giải thích: token hết hạn/mất/bị thu hồi, không có quyền, chưa rõ; Page tốt thì không có lý do', () => {
  assert.equal(pageBlocker(page()), null);
  assert.match(pageBlocker(page({ permissionStatus: 'expired', canPost: false })) ?? '', /hết hạn.*page:connect/u);
  assert.match(pageBlocker(page({ permissionStatus: 'denied', canPost: false })) ?? '', /không có quyền/u);
  assert.match(pageBlocker(page({ secretStatus: 'lost', canPost: false })) ?? '', /đã mất/u);
  assert.match(pageBlocker(page({ secretStatus: 'revoked', canPost: false })) ?? '', /Đã gỡ/u);
  assert.match(pageBlocker(page({ permissionStatus: 'unknown', canPost: false })) ?? '', /Chưa xác nhận/u);
  const blocked = pagePlanProblems({ ...ready, page: page({ permissionStatus: 'expired', canPost: false }) });
  assert.match(blocked[0] ?? '', /^Page chưa đăng được: Token đã hết hạn/u);
});

test('chữ ký nội dung: đổi Page/máy/giờ/caption thì khác; khoảng trắng đầu cuối caption không làm đổi', () => {
  const base = pagePlanSignature('c1', 'p1', 'now', 'Bài thử');
  assert.equal(pagePlanSignature('c1', 'p1', 'now', '  Bài thử \n'), base);
  for (const other of [pagePlanSignature('c2', 'p1', 'now', 'Bài thử'), pagePlanSignature('c1', 'p2', 'now', 'Bài thử'), pagePlanSignature('c1', 'p1', 1000, 'Bài thử'), pagePlanSignature('c1', 'p1', 'now', 'Khác')]) {
    assert.notEqual(other, base);
  }
});
