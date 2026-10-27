import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { JobListItem } from '#domain';
import { describeJobResult, formatVn, jobActions, parseVnLocal } from './job-view.ts';

const base: JobListItem = {
  id: 'j', status: 'queued', scheduledAt: 0, createdAt: 0, channel: 'group', mode: 'fake', destination: { id: 'd', name: 'Nhóm', externalId: '1' },
  account: { id: 'a', label: 'Nick A' }, productName: 'iPhone', attempts: 0, sendStarted: false, stopRequested: false, overdue: false, lastObservation: null,
};

test('giờ hẹn theo giờ Việt Nam (UTC+7, không có giờ mùa hè); ngày không tồn tại bị từ chối', () => {
  assert.equal(parseVnLocal('2026-10-27T14:30'), Date.UTC(2026, 9, 27, 7, 30));
  assert.equal(parseVnLocal('2026-01-01T00:00'), Date.UTC(2025, 11, 31, 17, 0));
  assert.equal(parseVnLocal('2026-02-31T10:00'), null);
  assert.equal(parseVnLocal('27/10/2026 14:30'), null);
  assert.match(formatVn(Date.UTC(2026, 9, 27, 7, 30)), /14:30/u);
});

test('thao tác theo trạng thái: job đã có mốc gửi không được hủy/chạy lại; quá hạn chỉ cho chạy ngay hoặc bỏ; đang chạy chỉ cho yêu cầu dừng', () => {
  assert.deepEqual(jobActions(base), ['pause', 'run_now', 'cancel']);
  assert.deepEqual(jobActions({ ...base, overdue: true }), ['run_now', 'skip']);
  assert.deepEqual(jobActions({ ...base, status: 'paused' }), ['resume', 'cancel']);
  assert.deepEqual(jobActions({ ...base, status: 'blocked' }), ['resume', 'cancel']);
  assert.deepEqual(jobActions({ ...base, status: 'running' }), ['stop']);
  assert.deepEqual(jobActions({ ...base, status: 'running', stopRequested: true }), []);
  for (const status of ['published', 'failed', 'cancelled', 'pending_approval'] as const) assert.deepEqual(jobActions({ ...base, status }), []);
  assert.deepEqual(jobActions({ ...base, status: 'unknown', sendStarted: true }), []); // có thể đã gửi: không hủy, không chạy lại
  assert.deepEqual(jobActions({ ...base, status: 'paused', sendStarted: true }), []);
});

test('mô tả kết quả: mô phỏng nói rõ chưa đăng thật; unknown cảnh báo đối chiếu; lỗi có lý do', () => {
  assert.match(describeJobResult({ ...base, status: 'published' }), /Mô phỏng/u);
  assert.match(describeJobResult({ ...base, status: 'unknown', sendStarted: true }), /đối chiếu/u);
  assert.match(describeJobResult({ ...base, status: 'failed', lastObservation: { outcome: 'failed', reasonCode: 'media_invalid', remoteId: null, observedAt: 1 } }), /ảnh mất/u);
  assert.match(describeJobResult({ ...base, overdue: true }), /quá giờ hẹn/u);
});
