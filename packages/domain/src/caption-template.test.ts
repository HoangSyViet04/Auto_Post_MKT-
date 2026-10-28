import assert from 'node:assert/strict';
import { test } from 'node:test';
import { captionTemplateProblems, renderCaptionTemplate } from './caption-template.ts';

const facts = { name: 'iPhone 13', condition: 'Đẹp 99%', priceVnd: 9_500_000, capacityText: '128GB', batteryText: null, warrantyText: null, locationText: 'Hà Nội' };

test('điền đúng dữ kiện đã nhập; dòng thiếu dữ kiện bị bỏ cả dòng, không in chỗ trống hay bịa giá trị', () => {
  const template = '{ten} - {tinh_trang}\nGiá: {gia}\nPin: {pin}\nBảo hành: {bao_hanh}\n\nKhu vực: {khu_vuc}\nLiên hệ inbox nhé!';
  assert.equal(renderCaptionTemplate(template, facts), 'iPhone 13 - Đẹp 99%\nGiá: 9.500.000 đ\n\nKhu vực: Hà Nội\nLiên hệ inbox nhé!');
  const noPrice = renderCaptionTemplate('{ten}\nGiá: {gia}\n\nLiên hệ inbox', { ...facts, priceVnd: null });
  assert.equal(noPrice, 'iPhone 13\n\nLiên hệ inbox');
  assert.equal(noPrice.includes('{'), false);
});

test('không để dòng trống thừa đầu/cuối/liên tiếp; chỗ trống lạ làm dòng bị bỏ thay vì lộ ra bài đăng', () => {
  assert.equal(renderCaptionTemplate('Pin: {pin}\n\n{ten}\n\nBảo hành: {bao_hanh}\n\n\n\nCảm ơn', facts), 'iPhone 13\n\nCảm ơn');
  assert.equal(renderCaptionTemplate('{ten}\nMàu: {mau}', facts), 'iPhone 13');
  assert.equal(renderCaptionTemplate('{pin}', facts), '');
});

test('kiểm tra mẫu: báo chỗ trống gõ sai và mẫu rỗng', () => {
  assert.deepEqual(captionTemplateProblems('{ten}\n{gía} {mau}'), ['Chỗ trống không hợp lệ: {gía}.', 'Chỗ trống không hợp lệ: {mau}.']);
  assert.deepEqual(captionTemplateProblems('{ten}\nGiá {gia}'), []);
  assert.deepEqual(captionTemplateProblems('  \n '), ['Mẫu caption đang trống.']);
});
