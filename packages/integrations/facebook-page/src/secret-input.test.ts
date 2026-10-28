import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applySecretChunk, removeEnvKeys } from './secret-input.ts';

const ESC = String.fromCharCode(27);

test('dán nhiều ký tự một lượt: nhận đủ, Enter kết thúc, phần sau Enter bị bỏ', () => {
  assert.deepEqual(applySecretChunk('', 'EAAabc123'), { buffer: 'EAAabc123', done: null });
  assert.deepEqual(applySecretChunk('EAA', 'abc\r'), { buffer: 'EAAabc', done: 'enter' });
  assert.deepEqual(applySecretChunk('', 'abc\nrác-phía-sau'), { buffer: 'abc', done: 'enter' });
});

test('đánh dấu dán của terminal (bracketed paste) và các chuỗi điều khiển không lọt vào bí mật', () => {
  assert.deepEqual(applySecretChunk('', `${ESC}[200~EAAtoken123${ESC}[201~`), { buffer: 'EAAtoken123', done: null });
  assert.deepEqual(applySecretChunk('', `${ESC}[200~EAAtoken123${ESC}[201~\r`), { buffer: 'EAAtoken123', done: 'enter' });
  assert.deepEqual(applySecretChunk('ab', `${ESC}[A${ESC}[Cxy`), { buffer: 'abxy', done: null }); // phím mũi tên bị bỏ
  assert.deepEqual(applySecretChunk('', 'a\u0001b\u0016c'), { buffer: 'abc', done: null }); // ký tự điều khiển khác bị bỏ
});

test('xóa lùi và Ctrl+C', () => {
  assert.deepEqual(applySecretChunk('abc', '\u007f\u007f'), { buffer: 'a', done: null });
  assert.deepEqual(applySecretChunk('', '\u007f'), { buffer: '', done: null });
  assert.deepEqual(applySecretChunk('abc', '\b'), { buffer: 'ab', done: null });
  assert.deepEqual(applySecretChunk('abc', '\u0003'), { buffer: 'abc', done: 'cancel' });
});

test('dọn .env: bỏ đúng các dòng khóa bí mật, giữ nguyên dòng khác, chú thích và kiểu xuống dòng; không trả giá trị đã bỏ', () => {
  const before = '# cấu hình\r\nAPM_INTEGRATIONS=fake\r\nAPM_META_APP_SECRET=bi-mat-1\r\n  export APM_META_USER_TOKEN = "EAAxyz"\r\nAPM_META_APP_SECRET_KHAC=giu\r\nAPM_SERVER_PORT=4317';
  const result = removeEnvKeys(before, ['APM_META_APP_SECRET', 'APM_META_USER_TOKEN']);
  assert.equal(result.removed, 2);
  assert.equal(result.content, '# cấu hình\r\nAPM_INTEGRATIONS=fake\r\nAPM_META_APP_SECRET_KHAC=giu\r\nAPM_SERVER_PORT=4317'); // khóa tên gần giống không bị xóa
  assert.equal(result.content.includes('bi-mat-1') || result.content.includes('EAAxyz'), false);
  assert.deepEqual(removeEnvKeys('A=1\nB=2\n', ['KHONG_CO']), { content: 'A=1\nB=2\n', removed: 0 });
  assert.deepEqual(removeEnvKeys('', ['X']), { content: '', removed: 0 });
});
