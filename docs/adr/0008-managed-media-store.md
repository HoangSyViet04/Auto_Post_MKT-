# ADR 0008 — MediaStore theo UUID, kiểm ảnh thật và hoàn tất theo giai đoạn

- Ngày: 2026-10-27
- Trạng thái: Đã chấp nhận
- Phạm vi: P02.4, thư viện nội bộ; chưa upload API/UI hoặc thumbnail

> Vị trí dữ liệu cập nhật theo [ADR 0012](0012-project-local-data.md): cho phép `<project>/data/` bị Git bỏ qua; vẫn chặn các thư mục mã nguồn và `.git`. Quy định từ chối mọi đường dẫn trong repo bên dưới là lịch sử.

## Quyết định

- Thêm dependency runtime **sharp 0.35.5**, khóa chính xác. Dùng bộ giải mã ảnh để kiểm pixel thật, không chỉ tin đuôi file/header. Bản này yêu cầu Node>=20.9, phù hợp Node24 của dự án; đã chạy thực tế trên Windows hiện tại. Máy khác chạy `npm ci` sau pull. Không viết parser ảnh riêng. [Constructor/giới hạn giải mã sharp](https://sharp.pixelplumbing.com/api-constructor/).
- `#storage.createMediaStore(db,{dataDir?})` mặc định dùng #config dataDir; file nằm tại `<dataDir>/media/staging/<UUID>.part` và `objects/<UUID>.blob`. Từ chối dataDir trong repo. UUID do app sinh, không dùng tên/đuôi file nguồn hoặc path từ metadata client; không lưu path nguồn vào DB. `importFile` chỉ dành cho caller nội bộ với file nguồn do người dùng chọn; không được đưa API nhận đường dẫn file tùy ý ra web.
- Bản đầu hỗ trợ JPEG/PNG/WebP một frame; kiểm magic bytes trước decoder, metadata và full pixel decode. Từ chối ảnh lỗi/format khác/multi-frame được decoder nhận diện. Mặc định tối đa20MiB và25triệu pixel, cấu hình nội bộ có thể thay đổi; đây không phải giới hạn Facebook. Chưa có GIF/HEIC/video hoặc chuyển định dạng.
- Chép có đếm byte vào file tạm mở độc quyền, sync nội dung, giải mã bản đã chép, tính SHA256/bytes/MIME. Commit row state staging, rename cùng kho, rồi commit ready. Giữ nguyên bytes ảnh nguồn, không tự tối ưu/đổi EXIF hoặc dedup sản phẩm theo hash. Không giữ DB transaction qua I/O/giải mã.
- Lỗi được bắt giữa chừng: row đã có chuyển failed; dọn đúng leaf UUID riêng trong kho; không di chuyển/xóa nguồn và không thông báo ready. Nếu DB/cleanup cũng lỗi thì báo media_io cố định. Không log exception/path thô. Không sửa migration0001/0002.
- `verify(id)` kiểm UUID, thư mục kho, regular file không symlink/hardlink, dung lượng và SHA256. Mất file chuyển missing, bytes đổi chuyển failed. Lỗi quyền I/O không bị diễn giải thành mất ảnh. `resolveForPublish(ids)` giữ đúng thứ tự, kiểm tất cả và không trả danh sách thiếu ảnh; repository sẽ chặn media không ready ở lần kiểm nghiệp vụ tiếp theo.

## Giới hạn

DB và filesystem không phải một transaction nguyên tử. Tắt tiến trình/mất điện có thể để lại part/blob orphan hoặc row staging; chúng chưa được coi là media ready. Chưa tự quét/xóa staging vì có thể còn import hoạt động ở tiến trình khác; đối chiếu/dọn orphan có điều phối thuộc vận hành/phục hồi sau. File ready mất sau crash vẫn bị verify chặn trước sử dụng.

Worker thật phải gọi resolveForPublish ngay trước chuẩn bị gửi, rồi kiểm lại claim/marker; hiện chưa nối scheduler hoặc browser. Kiểm path không thay thế ACL Windows/chống tiến trình độc hại cùng tài khoản; bảo vệ thư mục/secrets thuộc P02.5. Upload limits/MIME response/pagination/API access P02.7 và thumbnail P05.2 chưa được nghiệm thu bởi thư viện này.

## Kiểm tra

Chỉ thêm4test theo luồng: nhập3định dạng thật và source độc lập; từ chối file giả/hỏng/giới hạn; lỗi finalize sau rename dọn file và giữ source; file mất/hỏng chặn batch và trạng thái DB. Dữ liệu ảnh2x2/DB/thư mục đều tạm. Không thử Facebook và không dùng ảnh thật của người dùng.
