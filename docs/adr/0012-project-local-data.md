# ADR 0012 — Dữ liệu vận hành nằm trong thư mục dự án

- Ngày: 2026-10-28.
- Trạng thái: Đã chấp nhận theo yêu cầu trực tiếp của người dùng: muốn code và dữ liệu trong một thư mục dành cho dự án.
- Thay thế quy định vị trí dữ liệu ở ADR 0001 mục 6, ADR 0008 và ADR 0009. Cơ chế UUID, kiểm ảnh, DPAPI và ACL vẫn giữ.

## Quyết định

- Mặc định `<project>/data/` chứa DB, media, hồ sơ Edge, secrets, log, cache Vite, bằng chứng thử và bản sao lưu. Suy project root từ vị trí module, không phụ thuộc thư mục cửa sổ lệnh.
- `APM_DATA_DIR` vẫn ghi đè được; đường dẫn tương đối được tính từ project root. Nếu nằm trong repo thì chỉ cho `data/` và thư mục con, tiếp tục từ chối root, mã nguồn, `.git` hoặc tên gần giống `data-other`.
- MediaStore và SecretStore kiểm tra cả đường dẫn cấu hình và đường dẫn thực sau resolve/realpath; giữ kiểm tra symlink, UUID/hash và quyền thư mục như trước.
- `data/`, `local-backups/`, vùng chuyển dữ liệu tạm và các thư mục `data.restoring-*` / `data.before-restore-*` khi phục hồi đều bị Git bỏ qua. Backup mặc định vào `data/backups/`; không đưa DB, ảnh, hồ sơ hoặc bí mật lên GitHub.
- Test runner tiếp tục ép test/fake và dataDir tạm. Không dùng dữ liệu bán hàng thật làm fixture.

## Chuyển dữ liệu máy hiện tại

Chỉ chuyển khi server/worker/hồ sơ trình duyệt của dự án đã đóng. Sao chép AppData vào vùng tạm trong project, so sánh danh sách và SHA-256 toàn bộ file, kiểm SQLite integrity/FK và số dòng các bảng nghiệp vụ, rồi đổi sang `data/`. Giữ bản gốc đã đối chiếu tại `local-backups/pre-relocation-<thời điểm>/` trước khi dọn vị trí AppData cũ. Không đăng nhập hoặc gửi bài trong quá trình chuyển.

Sau này di chuyển cả folder dự án trên cùng máy cần đóng app trước để giữ DB/WAL và hồ sơ nhất quán. Sang máy Windows khác, secrets DPAPI và phiên Facebook có thể cần kết nối/đăng nhập lại. Bản sao lưu thông thường vẫn loại profiles/secrets/log như trước.
