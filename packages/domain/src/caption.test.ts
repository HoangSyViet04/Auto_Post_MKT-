import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CaptionValidationError, generateProductCaption, type ProductCaptionInput } from './caption.ts';

const minimal = { name: 'iPhone 13', condition: 'Màn có xước nhẹ, chưa kiểm tra pin và linh kiện' };

describe('caption từ dữ kiện người dùng (chuẩn bị P05.4)', () => {
  test('T01 chỉ tên/tình trạng vẫn sinh caption, không bịa giá/pin/dung lượng/bảo hành', () => {
    assert.equal(generateProductCaption(minimal),
      'iPhone 13\nTình trạng: Màn có xước nhẹ, chưa kiểm tra pin và linh kiện');
    const caption = generateProductCaption({ name: 'Samsung S23', condition: 'Đã thay màn, cần kiểm tra thêm' });
    assert.equal(caption, 'Samsung S23\nTình trạng: Đã thay màn, cần kiểm tra thêm');
    for (const invented of ['Giá:', 'Pin:', 'Dung lượng:', 'Bảo hành:', 'nguyên zin', 'trả góp', '100%']) {
      assert.ok(!caption.includes(invented));
    }
  });

  test('null/undefined là chưa có dữ liệu; không biến thành giá0 hoặc dòng trống', () => {
    assert.equal(generateProductCaption({ ...minimal, priceVnd: null, storageGb: null,
      batteryPercent: null, warrantyText: null }), generateProductCaption(minimal));
    assert.equal(generateProductCaption({ ...minimal, warrantyText: ' \n\t ' }), generateProductCaption(minimal));
  });

  test('chỉ thêm thông tin tùy chọn được cung cấp, dùng định dạng tiền Việt', () => {
    assert.equal(generateProductCaption({ ...minimal, priceVnd: 5_900_000, storageGb: 128,
      batteryPercent: 87, warrantyText: '  Còn 2 tháng theo phiếu mua hàng  ' }),
    `${minimal.name}\nTình trạng: ${minimal.condition}\nGiá: 5.900.000 đ\nDung lượng: 128 GB\nPin: 87%\nBảo hành: Còn 2 tháng theo phiếu mua hàng`);
  });

  test('tên hiển thị bỏ khoảng trắng thừa; giữ nội dung tình trạng và input nguồn', () => {
    const input = Object.freeze({ name: '  iPhone\t  13\nPro  ', condition: '  Đã thay pin.\nMàn có xước.  ' });
    assert.equal(generateProductCaption(input), 'iPhone 13 Pro\nTình trạng: Đã thay pin.\nMàn có xước.');
    assert.equal(input.name, '  iPhone\t  13\nPro  ');
    assert.equal(input.condition, '  Đã thay pin.\nMàn có xước.  ');
  });

  test('tên/tình trạng thiếu hoặc không phải văn bản bị từ chối, lỗi không echo input', () => {
    for (const field of ['name', 'condition'] as const) {
      for (const value of ['', ' \n\t ', null, undefined, 13, { source: 'private-value' }]) {
        assert.throws(() => generateProductCaption({ ...minimal, [field]: value } as ProductCaptionInput), (error) => {
          assert.ok(error instanceof CaptionValidationError);
          assert.equal(error.field, field);
          assert.ok(!error.message.includes('private-value'));
          return true;
        });
      }
    }
  });

  test('giá và dung lượng phải nguyên dương, không ép chuỗi số hoặc âm thành dữ kiện hợp lệ', () => {
    for (const field of ['priceVnd', 'storageGb'] as const) {
      for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, '128']) {
        assert.throws(() => generateProductCaption({ ...minimal, [field]: value } as ProductCaptionInput), (error) => {
          assert.ok(error instanceof CaptionValidationError);
          assert.equal(error.field, field);
          return true;
        });
      }
    }
  });

  test('pin chỉ0..100 hữu hạn: 0 được cung cấp rõ vẫn giữ, không suy thành thiếu', () => {
    assert.match(generateProductCaption({ ...minimal, batteryPercent: 0 }), /\nPin: 0%$/);
    assert.match(generateProductCaption({ ...minimal, batteryPercent: 84.5 }), /\nPin: 84,5%$/);
    assert.match(generateProductCaption({ ...minimal, batteryPercent: 100 }), /\nPin: 100%$/);
    for (const value of [-1, 101, Number.NaN, Number.POSITIVE_INFINITY, '100']) {
      assert.throws(() => generateProductCaption({ ...minimal, batteryPercent: value } as ProductCaptionInput),
        CaptionValidationError);
    }
  });

  test('bảo hành sai kiểu và input không phải object không được dùng tạo caption', () => {
    assert.throws(() => generateProductCaption({ ...minimal, warrantyText: false } as unknown as ProductCaptionInput),
      CaptionValidationError);
    for (const value of [null, undefined, 'iPhone', []]) {
      assert.throws(() => generateProductCaption(value as unknown as ProductCaptionInput), CaptionValidationError);
    }
  });
});
