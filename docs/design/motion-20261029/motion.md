# Tinh chỉnh chuyển động giao diện — 29/10/2026

Đã bổ sung phản hồi khi bấm và chuyển vùng, tập trung khung ứng dụng và màn Đăng nhóm.

| Thao tác | Phản hồi |
| --- | --- |
| Rê/bấm nút, đổi mục sidebar | Đổi màu, bóng nhẹ, nhấn xuống; 150–180 ms |
| Chuyển trang, đổi preview, thông báo | Hiện dần và dịch 5 px; 180 ms |
| Mở caption, cấu hình, quét nhóm, hẹn giờ, menu mobile | Mở/thu chiều cao và độ trong; tối đa 240 ms |
| Chuyển Nội dung/Ảnh | Gạch chân trượt; 220 ms |
| Chọn nhóm | Đổi nền dòng và phản hồi số nhóm đã chọn |
| Tải lại danh sách, duyệt | Biểu tượng đang xử lý, nhãn và trạng thái nút tương ứng |

Không thêm thời gian chờ vào yêu cầu API hoặc xếp lịch. Panel đóng bị loại khỏi thao tác bàn phím ngay bằng `inert`; cấu hình đang nhập được giữ khi thu gọn. Hủy callback cũ khi bấm liên tiếp. Phản hồi tải nhóm chỉ cập nhật cho yêu cầu mới nhất của đúng tài khoản.

`prefers-reduced-motion: reduce` tắt animation/transition và cuộn mượt, cập nhật cả khi đổi tùy chọn lúc app đang mở.

## Kiểm chứng

- Target UI/post-plan/group-selection: **10/10 đạt**. Kiểm tra bấm đóng/mở nhanh, vùng đóng không nhận focus, giữ caption/tên cấu hình, chế độ giảm chuyển động và yêu cầu tải danh sách đang chờ.
- `npm.cmd run check`: typecheck, lint **196 file**, **320/320 test**, 28 suite, không skip; build web **52 module** đạt.
- Đã xem [desktop](ui-implemented-desktop.png) và [mobile](ui-implemented-mobile.png). Test kiểm tra thêm viewport 1024 px, menu mobile, không tràn ngang và các trang điều hướng hiện có.
- Ảnh tĩnh tắt animation để chụp trạng thái ổn định; cảm giác chuyển động cần xem trực tiếp trên app. Đây là ảnh ứng dụng với DB/ảnh/tài khoản giả. Nhãn ĐĂNG THẬT dùng để thử bước xác nhận; không mở Facebook thật hoặc gửi bài trong lượt kiểm tra này.

Mở lại app bằng `Auto-Post-MKT.cmd`, tải lại trình duyệt bằng Ctrl+F5 để dùng bundle mới.
