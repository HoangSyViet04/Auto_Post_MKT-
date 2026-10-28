import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ContentVersionItem, GroupItem, PresetItem } from '#domain';
import { captionFor, duplicateWarning, emptyDraft, nextDailyStart, planItems, planProblems, planSignature, presetSelection, resolveStart, similarToHistory, toVnLocal } from './post-plan.ts';

const NOW = Date.UTC(2026, 9, 27, 7, 0); // 14:00 giờ Việt Nam
const ready = { ...emptyDraft(), accountId: 'a', productId: 'p', caption: 'iPhone 13\nTình trạng: đẹp', selected: ['g1', 'g2'] };
const context = { accountSession: 'logged_in', productSelling: true, now: NOW };

test('caption từng đích: sửa riêng thì dùng bản riêng, trống thì dùng caption chung; nguồn template chỉ khi bằng caption mẫu', () => {
  const draft = { ...ready, overrides: { g2: '  Bản riêng cho nhóm 2  ', g1: '   ' } };
  assert.equal(captionFor(draft, 'g1'), 'iPhone 13\nTình trạng: đẹp');
  assert.equal(captionFor(draft, 'g2'), 'Bản riêng cho nhóm 2');
  assert.deepEqual(planItems(draft, 'iPhone 13\nTình trạng: đẹp').map((item) => [item.destinationId, item.source]), [['g1', 'template'], ['g2', 'manual']]);
});

test('giờ hẹn: bây giờ, hoặc giờ Việt Nam; giờ sai hoặc đã qua quá lâu bị từ chối', () => {
  assert.equal(resolveStart(ready, NOW), NOW);
  assert.equal(resolveStart({ ...ready, startMode: 'later', startLocal: '2026-10-27T15:30' }, NOW), Date.UTC(2026, 9, 27, 8, 30));
  assert.equal(resolveStart({ ...ready, startMode: 'later', startLocal: '2026-10-27T13:50' }, NOW), Date.UTC(2026, 9, 27, 6, 50)); // trễ 10 phút vẫn trong ngưỡng
  assert.equal(resolveStart({ ...ready, startMode: 'later', startLocal: '2026-10-27T09:00' }, NOW), null); // đã qua 5 giờ
  assert.equal(resolveStart({ ...ready, startMode: 'later', startLocal: '' }, NOW), null);
  assert.equal(resolveStart({ ...ready, startMode: 'later', startLocal: '2026-02-31T10:00' }, NOW), null);
});

test('điều kiện gửi: báo đủ lý do thật sự chặn; sẵn sàng thì không có lý do', () => {
  assert.deepEqual(planProblems(ready, context), []);
  const empty = planProblems(emptyDraft(), { accountSession: null, productSelling: false, now: NOW });
  assert.equal(empty.length, 3); // thiếu tài khoản, thiếu máy, chưa chọn nhóm (chưa chọn nhóm thì chưa tính caption trống)
  assert.ok(planProblems(ready, { ...context, accountSession: 'login_required' })[0]?.includes('đã đăng nhập'));
  assert.ok(planProblems(ready, { ...context, productSelling: false })[0]?.includes('đã bán'));
  assert.ok(planProblems({ ...ready, caption: '  ' }, context)[0]?.includes('2 nhóm chưa có caption'));
  assert.deepEqual(planProblems({ ...ready, caption: '  ', overrides: { g1: 'a', g2: 'b' } }, context), []); // đủ caption riêng thì không cần caption chung
  assert.ok(planProblems({ ...ready, startMode: 'later', startLocal: 'sai' }, context)[0]?.includes('Giờ hẹn'));
});

test('cảnh báo trùng: nhiều nhóm cùng caption; giống bản đã lưu cho đúng đích đó', () => {
  const items = planItems(ready, '');
  assert.match(duplicateWarning(items) ?? '', /2 nhóm dùng cùng một caption/u);
  assert.equal(duplicateWarning(planItems({ ...ready, overrides: { g2: 'Khác hẳn nội dung này' } }, '')), null);

  const version = (destinationId: string | null, caption: string): ContentVersionItem => ({ id: 'v', revisionId: 'r', revisionNo: 1, caption, source: 'manual',
    destinationId, createdAt: 1, mediaIds: [] });
  const history = [version('g1', 'iPhone 13 Tình trạng: đẹp'), version('g2', 'Samsung S23 fullbox'), version(null, 'iPhone 13 Tình trạng: đẹp')];
  const hits = similarToHistory(items, history);
  assert.deepEqual(hits.map((hit) => hit.destinationId), ['g1']); // g2 không có bản giống; bản không gắn đích không tính
  assert.ok((hits[0]?.score ?? 0) >= 0.8);
});

test('chữ ký nội dung: đổi tài khoản/máy/giờ/caption/đích thì khác (mã yêu cầu mới), không đổi thì giống', () => {
  const items = planItems(ready, '');
  const base = planSignature('a', 'p', NOW, items);
  assert.equal(planSignature('a', 'p', NOW, planItems(ready, '')), base);
  for (const changed of [planSignature('b', 'p', NOW, items), planSignature('a', 'q', NOW, items), planSignature('a', 'p', NOW + 1, items),
    planSignature('a', 'p', NOW, planItems({ ...ready, caption: 'khác' }, '')), planSignature('a', 'p', NOW, planItems({ ...ready, selected: ['g1'] }, ''))]) {
    assert.notEqual(changed, base);
  }
});

test('giờ hằng ngày: lần kế tiếp theo giờ Việt Nam, đúng giờ hiện tại thì sang ngày mai; giờ sai bị từ chối', () => {
  assert.equal(nextDailyStart('15:30', NOW), Date.UTC(2026, 9, 27, 8, 30)); // 14:00 → hôm nay 15:30
  assert.equal(nextDailyStart('08:30', NOW), Date.UTC(2026, 9, 28, 1, 30)); // đã qua → sáng mai
  assert.equal(nextDailyStart('14:00', NOW), Date.UTC(2026, 9, 28, 7, 0)); // đúng bây giờ → ngày mai
  assert.equal(nextDailyStart('00:15', Date.UTC(2026, 9, 27, 18, 0)), Date.UTC(2026, 9, 28, 17, 15)); // 01:00 sáng 28/10 VN (đã qua 00:15) → 00:15 ngày 29/10 VN
  assert.equal(nextDailyStart('24:00', NOW), null);
  assert.equal(nextDailyStart('8:30', NOW), null);
  assert.equal(toVnLocal(Date.UTC(2026, 9, 27, 8, 30)), '2026-10-27T15:30');
  assert.equal(resolveStart({ ...ready, startMode: 'later', startLocal: toVnLocal(nextDailyStart('08:30', NOW) as number) }, NOW), nextDailyStart('08:30', NOW)); // giá trị đưa vào ô giờ hẹn dùng lại được
});

const group = (id: string, accountId: string, eligible: boolean): GroupItem => ({ id, externalId: id, canonicalUrl: null, name: `Nhóm ${id}`, region: null, topic: null, rulesNote: null,
  approvalRequired: 'unknown', curation: 'normal', userNote: null, archived: false, createdAt: 0, accounts: [{ accountId, eligible } as GroupItem['accounts'][number]] });

test('áp dụng cấu hình: chỉ chọn nhóm của đúng tài khoản và còn đủ điều kiện; nhóm không còn/không đủ điều kiện được báo rõ, không thay bằng nhóm khác', () => {
  const target = (accountId: string, destinationId: string) => ({ accountId, destinationId, channel: 'group' as const, name: `Nhóm ${destinationId}`, externalId: destinationId });
  const preset: Pick<PresetItem, 'targets'> = { targets: [target('a', 'g1'), target('a', 'g2'), target('a', 'g3'), target('b', 'g1'), target('b', 'g4')] };
  const result = presetSelection(preset, 'a', [group('g1', 'a', true), group('g2', 'a', false), group('g9', 'a', true)]);
  assert.deepEqual(result.selected, ['g1']);
  assert.deepEqual(result.skipped.map((entry) => [entry.destinationId, entry.reason]), [['g2', 'not_eligible'], ['g3', 'not_loaded']]);
  assert.deepEqual(presetSelection(preset, 'b', [group('g1', 'b', true)]).selected, ['g1']); // cặp của tài khoản b không lẫn với a
  assert.deepEqual(presetSelection(preset, 'c', [group('g1', 'c', true)]), { selected: [], skipped: [] }); // tài khoản khác không tự nhận nhóm
});
