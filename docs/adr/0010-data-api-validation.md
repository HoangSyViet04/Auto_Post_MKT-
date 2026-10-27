# ADR 0010 — API nền strict validation và upload bytes

- Ngày: 2026-10-27
- Trạng thái: Đã chấp nhận
- Phạm vi: P02.7, chưa UI sản phẩm hoặc lịch đăng

## Quyết định

- Dùng Fastify/AJV có sẵn: reject additional properties, schema UUID/required/type/length/bounds. BusinessError trả code/message cố định; lỗi schema/JSON không echo payload. Lỗi chưa biết log mã internal_error, không dump exception/body thô.
- `POST /api/media` nhận raw JPEG/PNG/WebP bytes, body limit mặc định20MiB, chuyển qua MediaStore importBytes. Không thêm multipart dependency, không nhận tên file/path của client. MIME thật do decoder xác nhận; DTO không trả storage key hoặc đường dẫn. `GET /api/media/:id` validate UUID, verify size/hash, trả image MIME + nosniff/no-store.
- Bổ sung ngoại lệ Content-Type duy nhất cho POST đúng /api/media: image/jpeg/png/webp. **Host/Origin/Fetch Metadata/token vẫn giữ nguyên**, không CORS. Mutation khác vẫn JSON. Client apiFetch giữ image Content-Type chỉ ở endpoint này, token trong bộ nhớ và không tự retry upload.
- `POST /api/products` nhận tên/tình trạng/media ID + optional facts, kiểm file thật rồi gọi repository transaction. `GET /api/products` phân trang page>=1, pageSize1..100, page<=1triệu; SQL tham số hóa, DTO không có path/secrets. Chưa edit/delete, tránh đưa thao tác xóa file/history chưa có quy tắc P05.8 ra API.
- File source từ HTTP chỉ là bytes. Internal importFile vẫn dành caller chọn file cục bộ; không expose endpoint nhận đường dẫn đọc/xóa file. Upload tạm cũng trong managed staging, dọn sau import. Không sửa migration hoặc thêm dependency.

## Giới hạn/kiểm tra

Đây là API nền, không nghiệm thu UI/thumbnail/quyền đăng/adapter thật. Checksum verify trước đọc không phải cơ chế chống mã độc cùng tài khoản đổi file đồng thời; ACL/DPAPI không thay thế bảo vệ OS. Upload POST chưa có idempotency riêng: lỗi mạng cần xem lại media trước gửi lại, không tự retry.

Ba test API chính: ảnh thật→đọc→product→pagination→missing; validation/body limit; CSRF/path traversal/JSONpath không truy cập file ngoài. Client có một test binary transport; cổng tổng cuối lượt kiểm cùng các phần còn lại. Không có API reveal secret.
