import assert from 'node:assert/strict';
import { test } from 'node:test';
import { captionSimilarity, findSimilarCaptions } from './similarity.ts';

test('giống nhau bỏ qua dấu/hoa thường/dấu câu; khác nội dung thì thấp; rỗng là 0', () => {
  assert.equal(captionSimilarity('iPhone 13 – Tình trạng: Đẹp!', 'IPHONE 13 tinh trang dep'), 1);
  assert.ok(captionSimilarity('iPhone 13 pin 89% xước viền', 'Samsung S23 fullbox bảo hành') < 0.2);
  assert.equal(captionSimilarity('', 'abc'), 0);
  assert.equal(captionSimilarity('...', '!!!'), 0);
});

test('findSimilarCaptions chỉ trả bản đạt ngưỡng, giống nhất trước, không sửa đầu vào', () => {
  const saved = [{ caption: 'iPhone 13 đẹp pin 89% giá tốt' }, { caption: 'Samsung S23' }, { caption: 'iPhone 13 đẹp pin 89% giá tốt nhé' }];
  const found = findSimilarCaptions('iPhone 13 đẹp pin 89% giá tốt', saved);
  assert.deepEqual(found.map((m) => m.item), [saved[0], saved[2]]);
  assert.equal(found[0]?.score, 1);
  assert.deepEqual(findSimilarCaptions('Xiaomi 13T', saved), []);
});
