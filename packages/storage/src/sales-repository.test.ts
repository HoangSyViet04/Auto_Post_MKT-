import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, test } from 'node:test';
import { BusinessError, type BusinessErrorCode } from '#domain';
import { createTestWorkspace, seedOfflineScenario } from '#test-support';
import { createSalesRepository } from './sales-repository.ts';

let workspace: ReturnType<typeof createTestWorkspace>;
let scenario: Awaited<ReturnType<typeof seedOfflineScenario>>;
let sales: ReturnType<typeof createSalesRepository>;
const code = (expected: BusinessErrorCode) => (error: unknown) => error instanceof BusinessError && error.code === expected;

beforeEach(async () => {
  workspace = createTestWorkspace();
  scenario = await seedOfflineScenario(workspace);
  sales = createSalesRepository(workspace.db, { clock: () => scenario.state.now });
});
afterEach(() => { workspace.dispose(); });

/** Một bài đã gửi đi (published) làm nguồn. */
function publishedJob(key: string): string {
  scenario.enqueue(key);
  const claim = scenario.jobs.claimNext('worker-test', 'fake');
  assert.ok(claim);
  scenario.jobs.markSendStarted(claim);
  scenario.jobs.finish(claim, { outcome: 'published', source: 'fake', remoteId: 'r1' });
  return claim.jobId;
}
const at = (minutesAgo: number) => scenario.state.now - minutesAgo * 60_000;

test('ghi nhận khách hỏi/đơn hàng nhập tay, gắn bài nguồn hoặc để trống; lọc và tổng hợp theo máy/nơi đăng', () => {
  const job = publishedJob('s1');
  const inquiry = sales.add({ kind: 'inquiry', productId: scenario.productId, jobId: job, occurredAt: at(30), customerLabel: ' Anh Nam ', note: 'Hỏi còn bảo hành không' });
  assert.deepEqual([inquiry.customerLabel, inquiry.source?.externalId, inquiry.jobId, inquiry.voided], ['Anh Nam', 'fake-group', job, false]);
  sales.add({ kind: 'order', productId: scenario.productId, jobId: job, occurredAt: at(10), amountVnd: 9_500_000 });
  sales.add({ kind: 'order', productId: scenario.productId, occurredAt: at(5), amountVnd: 1_000_000, note: '   ' }); // không rõ nguồn; ghi chú trống bỏ đi
  sales.add({ kind: 'inquiry', productId: scenario.productId, occurredAt: at(1) });

  assert.equal(sales.list().total, 4);
  assert.equal(sales.list({ kind: 'order' }).total, 2);
  assert.equal(sales.list({ jobId: job }).total, 2);
  assert.equal(sales.list({ productId: randomUUID() }).total, 0);
  assert.equal(sales.list({ from: at(12), to: at(4) }).total, 2);
  assert.equal(sales.list().items[0]?.note, null); // mới nhất trước
  assert.equal(sales.list({ kind: 'order', from: at(6), to: at(4) }).items[0]?.note, null);

  const summary = sales.summary();
  assert.deepEqual(summary.total, { inquiries: 2, orders: 2, orderAmountVnd: 10_500_000 });
  assert.deepEqual(summary.byProduct.map((row) => [row.productName, row.inquiries, row.orders]), [['iPhone 13', 2, 2]]);
  const bySource = new Map(summary.bySource.map((row) => [row.destination?.externalId ?? null, row]));
  assert.deepEqual([bySource.get('fake-group')?.inquiries, bySource.get('fake-group')?.orders, bySource.get('fake-group')?.orderAmountVnd], [1, 1, 9_500_000]);
  assert.deepEqual([bySource.get(null)?.inquiries, bySource.get(null)?.orders, bySource.get(null)?.orderAmountVnd], [1, 1, 1_000_000]);
  assert.deepEqual(sales.summary({ from: at(12), to: at(4) }).total, { inquiries: 0, orders: 2, orderAmountVnd: 10_500_000 });
});

test('từ chối ghi nhận sai: tương lai, tiền cho khách hỏi, tiền sai, bài của máy khác, bài chưa gửi, máy không tồn tại, chữ quá dài', () => {
  const sent = publishedJob('s2');
  const base = { kind: 'inquiry' as const, productId: scenario.productId, occurredAt: at(1) };
  assert.throws(() => sales.add({ ...base, occurredAt: scenario.state.now + 60 * 60_000 }), code('invalid_input')); // ở tương lai
  assert.throws(() => sales.add({ ...base, amountVnd: 100_000 }), code('invalid_input')); // khách hỏi không có giá trị đơn
  assert.throws(() => sales.add({ ...base, kind: 'order', amountVnd: 0 }), code('invalid_input'));
  assert.throws(() => sales.add({ ...base, kind: 'order', amountVnd: 1.5 }), code('invalid_input'));
  assert.throws(() => sales.add({ ...base, kind: 'bot' as never }), code('invalid_input'));
  assert.throws(() => sales.add({ ...base, note: 'x'.repeat(2001) }), code('invalid_input'));
  assert.throws(() => sales.add({ ...base, customerLabel: 'x'.repeat(201) }), code('invalid_input'));
  assert.throws(() => sales.add({ ...base, productId: randomUUID() }), code('not_found'));
  assert.throws(() => sales.add({ ...base, jobId: randomUUID() }), code('not_found'));

  const other = scenario.content.createProduct({ ...scenario.input, name: 'Máy khác' });
  assert.throws(() => sales.add({ ...base, productId: other.productId, jobId: sent }), code('invalid_input')); // bài thuộc máy khác
  const queued = scenario.enqueue('s3'); // chưa gửi đi
  assert.throws(() => sales.add({ ...base, jobId: queued.id }), code('not_ready'));
  assert.equal(sales.list().total, 0); // lỗi không để lại dòng nào
});

test('nhập nhầm thì đánh dấu hủy (không xóa): bỏ khỏi danh sách và tổng hợp, vẫn xem lại được; DB chặn sửa/xóa dòng', () => {
  const kept = sales.add({ kind: 'order', productId: scenario.productId, occurredAt: at(2), amountVnd: 5_000_000 });
  const mistaken = sales.add({ kind: 'order', productId: scenario.productId, occurredAt: at(1), amountVnd: 7_000_000 });
  sales.voidEvent(mistaken.id);
  assert.deepEqual(sales.list().items.map((entry) => entry.id), [kept.id]);
  assert.equal(sales.list({ includeVoided: true }).total, 2);
  assert.equal(sales.get(mistaken.id).voided, true);
  assert.deepEqual(sales.summary().total, { inquiries: 0, orders: 1, orderAmountVnd: 5_000_000 });
  assert.throws(() => sales.voidEvent(mistaken.id), code('conflict')); // hủy hai lần
  assert.throws(() => sales.voidEvent(randomUUID()), code('not_found'));

  const db = workspace.db;
  assert.throws(() => db.prepare('UPDATE sales_events SET amount_vnd=1 WHERE id=?').run(kept.id), /voided once/u); // chỉ được đánh dấu hủy
  assert.throws(() => db.prepare('UPDATE sales_events SET voided_at=NULL WHERE id=?').run(mistaken.id), /voided once/u); // không khôi phục
  assert.throws(() => db.prepare('DELETE FROM sales_events WHERE id=?').run(kept.id), /never deleted/u);
});
