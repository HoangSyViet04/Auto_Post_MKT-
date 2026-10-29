import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_JOIN_SETTINGS, joinSettingsProblem, parseMemberCount } from './group-join.ts';

test('đọc số thành viên từ chữ hiển thị (vi/en); không đọc được thì null, không đoán', () => {
  const cases: Array<[string, number | null]> = [
    ['12K thành viên', 12_000], ['1,2 N thành viên', 1_200], ['3 Tr thành viên', 3_000_000], ['850 thành viên', 850], ['12.345 thành viên', 12_345],
    ['1.2K members', 1_200], ['1 member', 1], ['Nhóm công khai · 5,4K thành viên · 10 bài viết/ngày', 5_400], ['Nhóm công khai', null], ['', null], ['thành viên', null],
  ];
  for (const [input, expected] of cases) assert.equal(parseMemberCount(input), expected, input);
});

test('cài đặt hạn mức: mặc định hợp lệ và thận trọng; giá trị lệch bị từ chối kèm lý do', () => {
  assert.equal(joinSettingsProblem(DEFAULT_JOIN_SETTINGS), null);
  assert.ok(DEFAULT_JOIN_SETTINGS.dailyCap <= 5 && DEFAULT_JOIN_SETTINGS.minGapSeconds >= 180);
  assert.match(joinSettingsProblem({ ...DEFAULT_JOIN_SETTINGS, dailyCap: 0 }) ?? '', /mỗi ngày/u);
  assert.match(joinSettingsProblem({ ...DEFAULT_JOIN_SETTINGS, dailyCap: 31 }) ?? '', /mỗi ngày/u);
  assert.match(joinSettingsProblem({ ...DEFAULT_JOIN_SETTINGS, minGapSeconds: 59 }) ?? '', /tối thiểu/u);
  assert.match(joinSettingsProblem({ ...DEFAULT_JOIN_SETTINGS, maxGapSeconds: 100 }) ?? '', /tối đa/u);
  assert.match(joinSettingsProblem({ ...DEFAULT_JOIN_SETTINGS, dailyCap: 2.5 }) ?? '', /mỗi ngày/u);
});
