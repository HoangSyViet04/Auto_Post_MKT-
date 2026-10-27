import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeGroupReference } from './group-link.ts';

const byId = (id: string) => ({ externalId: id, canonicalUrl: `https://www.facebook.com/groups/${id}` });

test('ID số và các dạng link có ID đều chuẩn hóa về một đích; bỏ query, hash, đường dẫn phụ', () => {
  const expected = byId('123456789012');
  for (const input of ['123456789012', ' 123456789012 ', 'https://www.facebook.com/groups/123456789012', 'http://m.facebook.com/groups/123456789012/',
    'facebook.com/groups/123456789012?ref=share#x', 'https://web.facebook.com/groups/123456789012/posts/999/', 'WWW.FACEBOOK.COM/groups/123456789012/about']) {
    assert.deepEqual(normalizeGroupReference(input), expected, input);
  }
});

test('link chỉ có tên rút gọn được lưu nhưng chưa có ID số (chưa đủ điều kiện đăng)', () => {
  assert.deepEqual(normalizeGroupReference('https://www.facebook.com/groups/Muaban.iPhone-cu/'),
    { externalId: null, canonicalUrl: 'https://www.facebook.com/groups/muaban.iphone-cu' });
});

test('từ chối đầu vào không phải một nhóm Facebook cụ thể', () => {
  for (const input of ['', '   ', '1234', 'abc', 'https://example.com/groups/123456789', 'https://facebook.com.evil.com/groups/123456789',
    'https://www.facebook.com/profile.php?id=123456789', 'https://www.facebook.com/groups/', 'https://www.facebook.com/groups/feed',
    'https://www.facebook.com/groups/discover/', 'ftp://facebook.com/groups/123456789', 'https://user:pw@facebook.com/groups/123456789',
    'https://www.facebook.com/groups/a b', `https://www.facebook.com/groups/${'x'.repeat(200)}`, 'javascript:alert(1)']) {
    assert.equal(normalizeGroupReference(input), null, input);
  }
  for (const input of [null, undefined, 123456789012, {}, []]) assert.equal(normalizeGroupReference(input), null);
});
