import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BrowserCommandSummary } from '#domain';
import { describeCommand } from './browser-labels.ts';

const base: BrowserCommandSummary = { id: 'c', kind: 'login', status: 'queued', resultCode: null, requestedAt: 1, finishedAt: null, cancelRequestedAt: null };

test('trạng thái lệnh trình duyệt: đang chờ/đang chạy là active; kết quả có lời hướng dẫn; mã lạ vẫn hiển thị an toàn', () => {
  assert.deepEqual(describeCommand(null), { active: false, tone: 'none', text: '' });
  assert.equal(describeCommand(base).active, true);
  const running = describeCommand({ ...base, status: 'running' });
  assert.ok(running.active && running.text.includes('cửa sổ Edge'));
  assert.ok(describeCommand({ ...base, kind: 'verify', status: 'running' }).text.includes('Kiểm tra phiên: đang chạy.'));
  assert.ok(describeCommand({ ...base, status: 'running', cancelRequestedAt: 5 }).text.includes('Đang hủy'));

  const ok = describeCommand({ ...base, kind: 'verify', status: 'succeeded', resultCode: 'match' });
  assert.deepEqual([ok.active, ok.tone], [false, 'ok']);
  const verification = describeCommand({ ...base, status: 'failed', resultCode: 'verification_required' });
  assert.ok(verification.tone === 'warn' && verification.text.includes('tự xử lý'));
  assert.ok(describeCommand({ ...base, status: 'failed', resultCode: 'identity_mismatch' }).text.includes('Sai nick'));
  assert.ok(describeCommand({ ...base, status: 'failed', resultCode: 'ma_la' }).text.includes('ma_la'));
});
