# ADR 0011 — Cột ưu tiên/ghi chú cho đích nhóm (migration 0003)

- Ngày: 2026-10-27
- Trạng thái: Đã chấp nhận

## Bối cảnh

P06 cần người dùng đánh dấu nhóm là ưu tiên hoặc không phù hợp và ghi chú riêng. Bảng `destinations` chưa có chỗ cho hai thông tin này.

## Quyết định

1. Thêm migration `0003_group_curation.sql` (không sửa 0001/0002, theo ADR 0002): `destinations.curation` (`normal|preferred|unsuitable`, mặc định `normal`) và `destinations.user_note`.
2. Hai cột này không thuộc danh tính bất biến nên trigger `destinations_identity_no_update` không chặn. ID số và link nhóm vẫn không sửa được.
3. "Ngừng dùng" dùng `archived_at` có sẵn (readiness đã chặn đích đã lưu trữ), không xóa nhóm vì lịch sử còn tham chiếu.
4. Quan hệ tài khoản–nhóm do người dùng nhập lưu với `source='manual'`; giao diện ghi rõ đây là khai báo chưa kiểm chứng.

## Giới hạn đã biết

- `curation='unsuitable'` hiện chỉ được kiểm tra khi chuyển nhóm sang trang Đăng nhóm (P06.7), chưa nằm trong `readiness` lúc duyệt/nhận job. Khi làm duyệt cho nhóm (P05.5/P10) cần thêm kiểm tra này hoặc dùng "Ngừng dùng".
- Link chỉ có tên rút gọn lưu với `external_id=NULL` và không đăng được. Trigger không cho điền ID sau, nên nếu muốn đăng phải nhập lại bằng link/ID số (tạo đích mới); việc gộp hai bản ghi cùng nhóm chưa được thiết kế.
