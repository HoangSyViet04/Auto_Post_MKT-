import type { BrowserCommandSummary } from '#domain';

/** Mã kết quả cố định của lệnh trình duyệt → câu tiếng Việt cho người vận hành. */
const RESULT_LABEL: Record<string, string> = {
  identity_saved: 'Đã đăng nhập và lưu danh tính.',
  identity_confirmed: 'Đăng nhập lại, danh tính khớp.',
  match: 'Phiên còn hiệu lực, danh tính khớp.',
  identity_mismatch: 'Sai nick: danh tính khác bản đã lưu. Đã dừng, không đổi danh tính.',
  no_identity_baseline: 'Chưa đăng nhập lần nào: hãy bấm "Đăng nhập" trước.',
  login_required: 'Cần đăng nhập lại.',
  verification_required: 'Facebook yêu cầu xác minh. Hãy tự xử lý trong cửa sổ trình duyệt rồi bấm "Kiểm tra phiên".',
  network_error: 'Lỗi mạng khi mở Facebook.',
  timeout: 'Hết thời gian chờ đăng nhập.',
  window_closed: 'Cửa sổ trình duyệt đã bị đóng trước khi đăng nhập xong.',
  identity_unreadable: 'Đã đăng nhập nhưng không đọc được danh tính.',
  cancelled: 'Đã hủy.',
  cancelled_before_start: 'Đã hủy trước khi chạy.',
  account_removed: 'Tài khoản đã được gỡ.',
  profile_in_use: 'Hồ sơ trình duyệt đang được dùng bởi tiến trình khác.',
  worker_lost: 'Worker đã dừng giữa chừng.',
  driver_error: 'Lỗi khi điều khiển trình duyệt.',
};

export interface CommandView {
  /** Đang chờ hoặc đang chạy: chưa cho tạo lệnh mới, cho phép hủy. */
  active: boolean;
  tone: 'none' | 'info' | 'ok' | 'warn';
  text: string;
}

export function describeCommand(command: BrowserCommandSummary | null): CommandView {
  if (!command) return { active: false, tone: 'none', text: '' };
  const what = command.kind === 'login' ? 'Đăng nhập' : 'Kiểm tra phiên';
  if (command.status === 'queued') return { active: true, tone: 'info', text: `${what}: đang chờ worker nhận lệnh…` };
  if (command.status === 'running') {
    const extra = command.cancelRequestedAt ? ' Đang hủy…' : command.kind === 'login' ? ' Hãy tự đăng nhập trong cửa sổ Edge vừa mở (kể cả 2FA).' : '';
    return { active: true, tone: 'info', text: `${what}: đang chạy.${extra}` };
  }
  const result = command.resultCode ? (RESULT_LABEL[command.resultCode] ?? `Mã kết quả: ${command.resultCode}.`) : '';
  return { active: false, tone: command.status === 'succeeded' ? 'ok' : 'warn', text: `${what}: ${result}` };
}
