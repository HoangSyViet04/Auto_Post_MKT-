# ADR 0009 — Secrets bằng Windows DPAPI CurrentUser

> Vị trí dữ liệu cập nhật theo [ADR 0012](0012-project-local-data.md): secrets nằm trong `<project>/data/secrets/` bị Git bỏ qua. DPAPI CurrentUser và ACL giữ nguyên; quy định vị trí ngoài repo trước đây được thay thế.

- Ngày: 2026-10-27
- Trạng thái: Đã chấp nhận
- Phạm vi: P02.5, thư viện nội bộ; không có HTTP endpoint trả plaintext

## Quyết định

- Dùng DPAPI `ProtectedData.Protect/Unprotect` với `CurrentUser`, thêm context UUID theo từng ciphertext. Windows quản lý khóa theo tài khoản, không tạo key cạnh ciphertext hoặc trong repo. Chuyển máy/tài khoản hoặc mất khả năng giải mã cần kết nối lại; không hứa ciphertext luôn di chuyển được giữa hai máy. [Microsoft DPAPI](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.protecteddata).
- Gọi Windows PowerShell/.NET có sẵn, không dependency native mới. Script tin cậy được truyền cố định qua EncodedCommand, dữ liệu qua stdin JSON/base64 UTF8; không ghép secret vào shell/argv, không ghi plaintext tạm. Tiến trình ẩn, timeout15s, output giới hạn và lỗi cố định. Không sửa ExecutionPolicy toàn máy.
- Kho tại `<dataDir>/secrets/<UUID>.dpapi` ngoài repo. ACL **chỉ thư mục secrets chuyên dụng**: tắt kế thừa, cho tài khoản Windows hiện tại và SYSTEM full control; file mới kế thừa từ đó. Không đổi ACL thư mục cha/toàn máy, không có cấu hình hệ thống hoặc key file cần sao lưu. [Microsoft ACL](https://learn.microsoft.com/en-us/dotnet/api/system.security.accesscontrol.filesystemsecurity?view=netframework-4.8.1).
- `#storage.createSecretStore`: put tạo ciphertext rồi mới secret_refs.available; get chỉ nội bộ và không log/HTTP; revoke đánh dấu revoked trước xóa ciphertext. DB chỉ lưu provider/reference/status/time. Không ghi đè hoặc trả plaintext từ API trạng thái.
- File mất/hỏng/không giải mã được đánh dấu lost, báo `secret_lost: Cần kết nối lại`; không fallback plaintext. Giới hạn plaintext64KiB. Non-Windows fail closed; không có chế độ giả tự coi là bảo vệ thật.

## Giới hạn và kiểm chứng

DPAPI/ACL không bảo vệ trước mã độc đã chạy dưới cùng tài khoản Windows, hoặc người có quyền chiếm tài khoản/máy. Chuỗi plaintext chỉ tồn tại trong bộ nhớ consumer/pipe lúc dùng; caller phải tránh log hoặc đưa vào caption/LLM. Chưa bảo vệ profile browser bằng ACL riêng; P03 quản lý vòng đời profile.

Hai test Windows thật kiểm Unicode round-trip, file/DB không chứa plaintext, ACL được helper xác minh, revoke và ciphertext mất/hỏng thành lost. Test trong sandbox bị chặn ACL; chạy lại đúng hai test ngoài sandbox đã đạt. Chưa thử đổi tài khoản Windows/máy thật; failure test dùng ciphertext hỏng và file mất. Không dùng secrets vận hành.
