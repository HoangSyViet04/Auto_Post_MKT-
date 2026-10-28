import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ProductImpact } from '#domain';
import { hasImpact, impactLines } from './product-impact.ts';

const impact = (pendingJobs: number, runningJobs: number, settledJobs: number): ProductImpact => ({ productId: 'p', pendingJobs, runningJobs, settledJobs, byStatus: {} });

test('chỉ hỏi lại khi có bài chưa gửi hoặc đang chạy bị ảnh hưởng; bài đã có kết quả thì không cần', () => {
  assert.equal(hasImpact(impact(0, 0, 5)), false);
  assert.equal(hasImpact(impact(1, 0, 0)), true);
  assert.equal(hasImpact(impact(0, 1, 0)), true);
});

test('mô tả đúng hậu quả: sửa → cần xem lại (không tự đăng), bán/ngừng bán → hủy, đang chạy → yêu cầu dừng, đã gửi → không đổi', () => {
  const revise = impactLines('revise', impact(2, 1, 3));
  assert.equal(revise.length, 3);
  assert.match(revise[0] as string, /2 bài chưa gửi.*Cần xem lại.*không tự đăng/u);
  assert.match(revise[1] as string, /1 bài đang chạy.*yêu cầu dừng/u);
  assert.match(revise[2] as string, /3 bài đã gửi.*không thay đổi/u);
  assert.match(impactLines('sold', impact(2, 0, 0))[0] as string, /2 bài chưa gửi sẽ bị HỦY/u);
  assert.match(impactLines('archived', impact(1, 0, 0))[0] as string, /HỦY/u);
  assert.match(impactLines('selling', impact(1, 0, 0))[0] as string, /Cần xem lại/u);
  assert.deepEqual(impactLines('revise', impact(0, 0, 0)), []);
});
