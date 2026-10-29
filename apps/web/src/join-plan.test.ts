import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GroupJoinQuota, GroupSearchResultItem } from '#domain';
import { availableToJoin, formatCount, joinable, joinProblems, pickJoinable } from './join-plan.ts';

const item = (id: string, joinState: GroupSearchResultItem['joinState'], request: GroupSearchResultItem['request'] = null): GroupSearchResultItem =>
  ({ id, externalId: id, canonicalUrl: `https://www.facebook.com/groups/${id}`, name: id, privacy: 'public', memberCount: null, joinState, observedAt: 0, request });
const quota = (patch: Partial<GroupJoinQuota> = {}): GroupJoinQuota => ({ used: 0, pending: 0, cap: 5, remaining: 5, nextFreeAt: null, ...patch });

test('chỉ nhóm có thể tham gia và chưa có yêu cầu đang hiệu lực mới xếp được; thất bại/bỏ qua/hủy thì thử lại được', () => {
  assert.equal(joinable(item('a', 'can_join')), true);
  for (const state of ['joined', 'requested', 'unknown'] as const) assert.equal(joinable(item('a', state)), false);
  for (const status of ['queued', 'running', 'requested', 'joined', 'unknown'] as const) assert.equal(joinable(item('a', 'can_join', { status, reasonCode: null })), false);
  for (const status of ['skipped', 'failed', 'cancelled'] as const) assert.equal(joinable(item('a', 'can_join', { status, reasonCode: null })), true);
});

test('chọn tự động tối đa N nhóm xếp được, không bù bằng nhóm không đủ điều kiện', () => {
  const list = [item('1', 'joined'), item('2', 'can_join'), item('3', 'can_join', { status: 'requested', reasonCode: null }), item('4', 'can_join'), item('5', 'can_join')];
  assert.deepEqual(pickJoinable(list, 2), ['2', '4']);
  assert.deepEqual(pickJoinable(list, 10), ['2', '4', '5']);
  assert.deepEqual(pickJoinable(list, 0), []);
  assert.deepEqual(pickJoinable(list, 1.5), []);
});

test('điều kiện gửi: số tick không vượt số nhập, không vượt hạn mức còn lại, phải xác nhận', () => {
  assert.deepEqual(joinProblems({ selected: 3, maxCount: 3, quota: quota(), confirmed: true }), []);
  assert.equal(joinProblems({ selected: 0, maxCount: 3, quota: quota(), confirmed: true })[0], 'Tick ít nhất một nhóm.');
  assert.match(joinProblems({ selected: 4, maxCount: 3, quota: quota(), confirmed: true })[0] ?? '', /nhiều hơn số bạn nhập/u);
  assert.match(joinProblems({ selected: 3, maxCount: Number.NaN, quota: quota(), confirmed: true })[0] ?? '', /Nhập số nhóm/u);
  assert.match(joinProblems({ selected: 3, maxCount: 3, quota: quota({ used: 3, remaining: 2 }), confirmed: true })[0] ?? '', /Chỉ còn xếp thêm được 2/u);
  assert.match(joinProblems({ selected: 2, maxCount: 2, quota: quota({ pending: 4 }), confirmed: true })[0] ?? '', /Chỉ còn xếp thêm được 1/u); // yêu cầu đã xếp cũng chiếm chỗ
  assert.match(joinProblems({ selected: 1, maxCount: 1, quota: quota(), confirmed: false })[0] ?? '', /xác nhận/u);
  assert.equal(availableToJoin(null), 0);
  assert.equal(availableToJoin(quota({ remaining: 1, pending: 4 })), 0);
});

test('hiển thị số thành viên gọn; thiếu là chưa rõ', () => {
  assert.deepEqual([formatCount(null), formatCount(850), formatCount(12_000), formatCount(1_500), formatCount(2_000_000)], ['chưa rõ', '850', '12 N', '1.5 N', '2 Tr']);
});
