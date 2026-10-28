import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptySalesDraft, salesBody, sourceLabel } from './sales-form.ts';

const NOW = Date.UTC(2026, 9, 28, 8, 0); // 15:00 giờ Việt Nam
const draft = { ...emptySalesDraft(NOW), productId: 'p1' };

test('form mặc định lấy giờ hiện tại theo giờ Việt Nam; hợp lệ thì quy về epoch UTC', () => {
  assert.equal(draft.occurredLocal, '2026-10-28T15:00');
  const result = salesBody({ ...draft, occurredLocal: '2026-10-28T14:30', customerLabel: ' Anh Nam ', note: '  ' }, NOW);
  assert.deepEqual(result, { ok: true, body: { kind: 'inquiry', productId: 'p1', jobId: null, occurredAt: Date.UTC(2026, 9, 28, 7, 30), customerLabel: 'Anh Nam', note: null, amountVnd: null } });
});

test('giá trị đơn chỉ áp dụng cho đơn hàng; số tiền đọc theo kiểu Việt Nam; sai thì báo lỗi', () => {
  const order = salesBody({ ...draft, kind: 'order', amount: '9.500.000', jobId: 'j1' }, NOW);
  assert.equal(order.ok && order.body.amountVnd, 9_500_000);
  assert.equal(order.ok && order.body.jobId, 'j1');
  const inquiry = salesBody({ ...draft, kind: 'inquiry', amount: '9.500.000' }, NOW); // khách hỏi: bỏ qua tiền đã gõ
  assert.equal(inquiry.ok && inquiry.body.amountVnd, null);
  assert.equal(salesBody({ ...draft, kind: 'order', amount: 'abc' }, NOW).ok, false);
  assert.equal(salesBody({ ...draft, kind: 'order', amount: '' }, NOW).ok && true, true); // đơn chưa rõ giá trị vẫn ghi được
});

test('từ chối: chưa chọn máy, giờ sai hoặc ở tương lai, chữ quá dài', () => {
  assert.deepEqual(salesBody({ ...draft, productId: '' }, NOW), { ok: false, errors: ['Chọn máy.'] });
  const bad = salesBody({ ...draft, occurredLocal: '2026-02-31T10:00' }, NOW);
  assert.equal(!bad.ok && bad.errors[0]?.includes('Giờ không hợp lệ'), true);
  const future = salesBody({ ...draft, occurredLocal: '2026-10-29T10:00' }, NOW);
  assert.equal(!future.ok && future.errors[0]?.includes('tương lai'), true);
  assert.equal(salesBody({ ...draft, note: 'x'.repeat(2001) }, NOW).ok, false);
});

test('nhãn nguồn: nơi đăng hoặc "Không rõ nguồn"', () => {
  assert.equal(sourceLabel(null), 'Không rõ nguồn');
  assert.equal(sourceLabel({ channel: 'group', destinationId: 'd', name: 'Chợ Apple', externalId: '1' }), 'Nhóm · Chợ Apple');
  assert.equal(sourceLabel({ channel: 'profile', destinationId: 'd', name: null, externalId: 'vanity:a' }), 'Trang cá nhân · vanity:a');
});
