/** Giao diện điều khiển trình duyệt cho worker. Tách khỏi Playwright để chạy thử bằng driver giả; chỉ worker được dùng driver thật. */

export type DriverFailure =
  | 'login_required'
  | 'verification_required'
  | 'network_error'
  | 'timeout'
  | 'window_closed'
  | 'identity_unreadable'
  | 'cancelled'
  | 'profile_in_use'
  | 'unknown';

export type DriverResult = { ok: true; identityRef: string } | { ok: false; code: DriverFailure };

export interface DriverInput {
  /** Thư mục hồ sơ trình duyệt riêng của tài khoản (ngoài repo). */
  profileDir: string;
  /** Gọi định kỳ khi đang chờ; ném lỗi nếu worker mất quyền (driver phải dừng và đóng trình duyệt). */
  onTick(): void;
  /** true khi người dùng yêu cầu hủy; driver dừng thao tác và trả `cancelled`. */
  shouldCancel(): boolean;
}

export interface BrowserDriver {
  /** Mở cửa sổ để NGƯỜI DÙNG tự đăng nhập (kể cả 2FA/xác minh); driver chỉ chờ, không nhập gì, không đọc mật khẩu. */
  login(input: DriverInput & { timeoutMs: number }): Promise<DriverResult>;
  /** Mở lại hồ sơ, xác nhận còn đăng nhập và đọc danh tính. Không thao tác nào ngoài đọc. */
  verify(input: DriverInput): Promise<DriverResult>;
}

/** Lỗi điều hướng do mạng (mất mạng, DNS, kết nối bị từ chối/hết giờ) khác với trang yêu cầu đăng nhập/xác minh. */
export function classifyNavigationError(message: string): 'network_error' | 'unknown' {
  return /net::ERR_(INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|NETWORK_CHANGED|CONNECTION_(REFUSED|RESET|CLOSED|TIMED_OUT)|TIMED_OUT|PROXY_|ADDRESS_UNREACHABLE|NETWORK_ACCESS_DENIED)/u.test(message)
    ? 'network_error'
    : 'unknown';
}
