import type { JobListItem, JobStatus } from '#domain';

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  queued: 'Chờ đến giờ',
  running: 'Đang chạy',
  published: 'Đã đăng',
  pending_approval: 'Đã gửi, chờ admin duyệt',
  paused: 'Tạm dừng',
  blocked: 'Bị chặn',
  needs_review: 'Cần xem lại',
  unknown: 'Chưa rõ kết quả',
  failed: 'Lỗi',
  cancelled: 'Đã hủy',
};

const REASON_LABEL: Record<string, string> = {
  network_error: 'lỗi mạng',
  session_expired: 'phiên hết hạn',
  checkpoint: 'Facebook yêu cầu xác minh',
  identity_mismatch: 'sai danh tính',
  destination_not_allowed: 'đích không cho phép đăng',
  media_invalid: 'ảnh mất hoặc hỏng',
  ui_changed: 'giao diện Facebook đã đổi',
  unknown: 'không rõ nguyên nhân',
};

/** Lịch luôn hiển thị theo giờ Việt Nam (lưu UTC). */
export function formatVn(ms: number): string {
  return new Date(ms).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
}

/** "2026-10-27T14:30" nhập theo giờ Việt Nam → epoch UTC. Việt Nam không có giờ mùa hè nên luôn UTC+7. */
export function parseVnLocal(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/u.exec(value.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number) as [number, number, number, number, number, number];
  const utc = Date.UTC(year, month - 1, day, hour - 7, minute);
  const back = new Date(utc + 7 * 3_600_000);
  // Từ chối ngày không tồn tại (ví dụ 31/02) thay vì tự cuốn sang tháng khác.
  return back.getUTCFullYear() === year && back.getUTCMonth() === month - 1 && back.getUTCDate() === day ? utc : null;
}

export type JobAction = 'pause' | 'resume' | 'cancel' | 'stop' | 'run_now' | 'skip';

/** Thao tác hợp lệ theo trạng thái; job đã có mốc gửi không bao giờ được hủy hay chạy lại. */
export function jobActions(job: Pick<JobListItem, 'status' | 'sendStarted' | 'overdue' | 'stopRequested'>): JobAction[] {
  if (job.sendStarted && job.status !== 'running') return [];
  switch (job.status) {
    case 'queued': return job.overdue ? ['run_now', 'skip'] : ['pause', 'run_now', 'cancel'];
    case 'paused':
    case 'blocked': return ['resume', 'cancel'];
    case 'needs_review': return ['cancel'];
    case 'running': return job.stopRequested ? [] : ['stop'];
    default: return [];
  }
}

export function describeJobResult(job: JobListItem): string {
  const reason = job.lastObservation?.reasonCode ? ` (${REASON_LABEL[job.lastObservation.reasonCode] ?? job.lastObservation.reasonCode})` : '';
  switch (job.status) {
    case 'unknown': return 'Có thể đã gửi đến Facebook. Không tự gửi lại; cần đối chiếu bằng mắt.';
    case 'failed': return `Không đăng được${reason}.`;
    case 'blocked': return 'Điều kiện chưa đáp ứng (phiên, quyền hoặc tài khoản tạm dừng).';
    case 'needs_review': return 'Máy hoặc nội dung đã đổi sau khi duyệt.';
    case 'published': return job.mode === 'fake' ? 'Mô phỏng: chưa có bài thật nào được đăng.' : 'Đã đăng.';
    case 'pending_approval': return 'Bài đã gửi, đang chờ admin nhóm duyệt.';
    case 'running': return job.stopRequested ? 'Đã yêu cầu dừng; kết quả thực tế vẫn sẽ được ghi.' : '';
    default: return job.overdue ? 'Đã quá giờ hẹn, không tự chạy. Chọn chạy ngay hoặc bỏ.' : '';
  }
}

export type Resolution = 'published' | 'pending_approval' | 'not_published';

export const OBSERVATION_SOURCE_LABEL: Record<string, string> = {
  fake: 'mô phỏng',
  api_response: 'phản hồi API',
  ui_observation: 'quan sát từ trình duyệt',
  manual: 'xác nhận thủ công',
};

/**
 * Cách đối chiếu hợp lệ cho job chưa chắc kết quả. Luôn dựa trên việc người dùng đã tự kiểm tra trên Facebook;
 * không có lựa chọn nào đưa job về hàng chờ để gửi lại.
 */
export function reconcileChoices(job: Pick<JobListItem, 'status' | 'sendStarted'>): Array<{ resolution: Resolution; label: string }> {
  if (!job.sendStarted) return [];
  if (job.status === 'unknown') {
    return [
      { resolution: 'published', label: 'Tôi đã kiểm tra: bài ĐÃ đăng' },
      { resolution: 'pending_approval', label: 'Bài đang chờ admin duyệt' },
      { resolution: 'not_published', label: 'Tôi đã kiểm tra: bài CHƯA đăng' },
    ];
  }
  if (job.status === 'pending_approval') {
    return [
      { resolution: 'published', label: 'Admin đã duyệt (bài đã đăng)' },
      { resolution: 'not_published', label: 'Admin từ chối / không có bài' },
    ];
  }
  return [];
}

/** Máy đã sửa hoặc đã bán sau khi duyệt: thông báo rõ, bài đã duyệt vẫn giữ nguyên bản cũ. */
export function revisionNotice(job: Pick<JobListItem, 'approvedRevisionNo' | 'currentRevisionNo' | 'productStatus' | 'status'>): string | null {
  const parts: string[] = [];
  if (job.currentRevisionNo > job.approvedRevisionNo) parts.push(`Máy đã sửa sau khi duyệt (bản ${job.approvedRevisionNo} → ${job.currentRevisionNo}); bài này vẫn giữ nội dung bản ${job.approvedRevisionNo} đã duyệt`);
  if (job.productStatus !== 'selling') parts.push(job.productStatus === 'sold' ? 'Máy đã bán' : 'Máy đã ngừng bán');
  return parts.length ? `${parts.join('. ')}.` : null;
}
