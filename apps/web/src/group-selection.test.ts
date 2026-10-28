import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GroupItem } from '#domain';
import { selectGroupCount } from './group-selection.ts';

const group = (id: string, preferred = false, accountId = 'a', eligible = true): GroupItem => ({ id, name: id,
  externalId: '123456789', canonicalUrl: null, region: null, topic: null, rulesNote: null, approvalRequired: 'unknown',
  curation: preferred ? 'preferred' : 'normal', userNote: null, archived: false, createdAt: 1,
  accounts: [{ accountId, accountLabel: accountId, membership: 'joined', permission: eligible ? 'allowed' : 'unknown',
    source: 'manual', checkedAt: 1, eligible, blockedBy: eligible ? [] : ['no_permission'] }],
});
test('nhập 30 chọn đúng 30 nhóm, ưu tiên trước, không trùng, thứ tự ổn định', () => {
  const all = Array.from({ length: 40 }, (_, i) => group(`group-${String(i).padStart(2, '0')}`, i >= 35));
  const result = selectGroupCount([...all, all[0] as GroupItem], 'a', 30);
  assert.equal(result.available, 40); assert.equal(result.selected.length, 30);
  assert.deepEqual(result.selected.slice(0, 5), all.slice(35).map((item) => item.id));
  assert.deepEqual(selectGroupCount([...all].reverse(), 'a', 30), result);
});
test('thiếu nhóm báo số có thực; không chọn nhóm tài khoản khác, không phù hợp, ngừng dùng hoặc chưa đủ quyền', () => {
  const all = [group('ok'), group('other', true, 'b'), group('denied', false, 'a', false),
    { ...group('bad'), curation: 'unsuitable' as const }, { ...group('archived'), archived: true }];
  assert.deepEqual(selectGroupCount(all, 'a', 30), { selected: ['ok'], available: 1 });
  assert.deepEqual(selectGroupCount([], 'a', 30), { selected: [], available: 0 });
  for (const count of [0, -1, 1.5, 101, Number.NaN]) assert.throws(() => selectGroupCount(all, 'a', count));
});
