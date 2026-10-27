const MESSAGES = {
  invalid_input: 'Dữ liệu nghiệp vụ không hợp lệ.',
  not_found: 'Không tìm thấy dữ liệu nghiệp vụ.',
  conflict: 'Dữ liệu đã thay đổi hoặc vi phạm ràng buộc.',
  not_ready: 'Dữ liệu hoặc kết nối chưa đủ điều kiện.',
  stale_approval: 'Phiên bản đã duyệt cần được kiểm tra lại.',
  idempotency_conflict: 'Mã yêu cầu đã được dùng cho nội dung khác.',
  claim_lost: 'Quyền xử lý tác vụ đã hết hạn hoặc thay đổi.',
  invalid_transition: 'Không thể chuyển trạng thái tác vụ theo yêu cầu.',
  mode_mismatch: 'Chế độ tác vụ không khớp chế độ đang xử lý.',
  media_invalid: 'Ảnh không hợp lệ, bị hỏng hoặc có định dạng chưa hỗ trợ.',
  media_too_large: 'Ảnh vượt giới hạn dung lượng hoặc số điểm ảnh.',
  media_missing: 'Ảnh trong kho không còn tồn tại.',
  media_io: 'Không thể đọc hoặc ghi ảnh trong kho.',
} as const;

export type BusinessErrorCode = keyof typeof MESSAGES;

/** Stable codes shared by Node/web. Never echo payloads or database errors. */
export class BusinessError extends Error {
  readonly code: BusinessErrorCode;
  constructor(code: BusinessErrorCode) {
    super(MESSAGES[code]);
    this.name = 'BusinessError';
    this.code = code;
  }
}
