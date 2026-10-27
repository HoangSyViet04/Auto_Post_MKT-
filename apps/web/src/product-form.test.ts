import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { emptyForm, moveImage, parsePrice, previewCaption, validateForm } from './product-form.ts';

const filled = { ...emptyForm(), name: ' iPhone 13 ', condition: 'Xước viền', images: [{ id: 'a', label: 'a.jpg' }] };

describe('form nhập máy', () => {
  test('chỉ bắt buộc tên, tình trạng và ít nhất một ảnh; báo đủ lỗi một lượt', () => {
    assert.deepEqual(Object.keys(validateForm(emptyForm()).errors).sort(), ['condition', 'images', 'name']);
    const ok = validateForm(filled);
    assert.deepEqual(ok.errors, {});
    assert.deepEqual(ok.facts, {
      name: 'iPhone 13', condition: 'Xước viền', mediaIds: ['a'], priceVnd: null,
      capacityText: null, batteryText: null, warrantyText: null, locationText: null,
    });
  });

  test('giá trống là null, không phải 0; sai định dạng bị từ chối', () => {
    assert.equal(parsePrice(''), null);
    assert.equal(parsePrice('  '), null);
    assert.equal(parsePrice('9.500.000'), 9_500_000);
    assert.equal(parsePrice('9,500,000'), 9_500_000);
    for (const bad of ['0', '9tr', '-5', '1e6', '9.5tr']) assert.equal(parsePrice(bad), 'invalid');
    assert.ok(validateForm({ ...filled, price: '9tr' }).errors.price);
    assert.equal(validateForm({ ...filled, price: '0' }).facts, null);
  });

  test('caption xem trước chỉ gồm dữ kiện đã nhập', () => {
    assert.equal(previewCaption(emptyForm()), '');
    assert.equal(previewCaption(filled), 'iPhone 13\nTình trạng: Xước viền');
    const full = previewCaption({ ...filled, price: '9500000', battery: '89%', warranty: ' 1 tháng ' });
    assert.ok(full.includes('Giá: 9.500.000 đ') && full.includes('Pin: 89%') && full.includes('Bảo hành: 1 tháng'));
    assert.ok(!full.includes('Dung lượng'));
    assert.equal(previewCaption({ ...filled, price: 'abc' }), 'iPhone 13\nTình trạng: Xước viền');
  });

  test('đổi thứ tự ảnh không sửa mảng gốc và không vượt biên', () => {
    const images = [{ id: 'a', label: '' }, { id: 'b', label: '' }, { id: 'c', label: '' }];
    assert.deepEqual(moveImage(images, 0, 1).map((i) => i.id), ['b', 'a', 'c']);
    assert.deepEqual(moveImage(images, 2, -1).map((i) => i.id), ['a', 'c', 'b']);
    assert.deepEqual(moveImage(images, 0, -1).map((i) => i.id), ['a', 'b', 'c']);
    assert.deepEqual(moveImage(images, 2, 1).map((i) => i.id), ['a', 'b', 'c']);
    assert.deepEqual(images.map((i) => i.id), ['a', 'b', 'c']);
  });
});
