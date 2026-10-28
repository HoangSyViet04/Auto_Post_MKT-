# Giao diện đã triển khai từ bản tham khảo v1

Tinh chỉnh phản hồi và chuyển động 29/10/2026: [motion-20261029/motion.md](motion-20261029/motion.md).

Review nhanh tiếp theo, gồm lỗi tải nhóm đã sửa và ảnh nhiều kích thước: [review-20261028/review.md](review-20261028/review.md).

Đã áp dụng vào React/CSS, tập trung màn **Đăng nhóm** và giao diện khung chung. Không dùng ảnh mockup làm nền hay thay thế thao tác thật bằng ảnh.

## Những phần đã áp dụng

- Sidebar navy, icon SVG, điều hướng trực tiếp tới tài khoản, máy, nhóm, đăng nhóm, TCN, fanpage, lịch sử và đơn hàng. Tính năng chưa có (proxy/tìm nhóm theo từ khóa) vẫn hiện rõ trạng thái. Fanpage giữ nguyên trang chức năng vừa được bổ sung ở phiên khác.
- Header, breadcrumb, nhãn mô phỏng/thật và trạng thái kết nối; bảng/biểu mẫu dùng màu, nút và khoảng cách thống nhất.
- Màn Đăng nhóm chia vùng chọn máy/tài khoản/nhóm và cột preview/lịch. Thanh bốn bước dẫn tới các vùng trong cùng trang, không bắt người dùng thao tác wizard hoặc tự gửi bài.
- Chọn số lượng 1–100; bảng cuộn, lọc tên và chỉ nhóm đủ điều kiện; ưu tiên theo dữ liệu thật, không hiển thị thống kê bịa.
- Bảng quét mở ngay trong Đăng nhóm, dùng nguyên API/worker/khóa hồ sơ và quyền đăng đã có. Vẫn có trang Nhóm đã tham gia để quản lý chi tiết.
- Preview một nhóm tại một thời điểm (dropdown giữ đủ các nhóm đã chọn), nội dung và ảnh có thứ tự, chỉnh caption riêng hoặc caption chung. Không còn dàn 30 ô caption liên tiếp gây dài màn hình.
- Cấu hình đăng thường dùng thu gọn; nút Lưu cấu hình mở đúng form hiện có. Lịch đăng ngay/hẹn giờ, kiểm tra điều kiện, xác nhận thật và kết quả từng nhóm được giữ.
- Đổi caption/tài khoản/máy/nhóm/lịch phải xác nhận đăng thật lại. Chưa đọc được chế độ kết nối thì không bật nút duyệt. Đổi nhanh máy/tài khoản không nhận kết quả tải cũ vào bản nháp mới.
- Responsive: hai cột trên desktop; màn vừa chuyển cột preview xuống dưới; màn nhỏ có menu thu gọn và các vùng thao tác xếp dọc. Vùng ảnh dùng contain để không cắt mất ảnh máy. Thanh duyệt nằm dưới nội dung, không che bảng/lịch.

## Ảnh giao diện thật

- [Desktop](ui-implemented-desktop.png)
- [Mobile](ui-implemented-mobile.png)
- [Chưa chọn máy/tài khoản](ui-implemented-empty.png)

Ảnh chụp từ trình duyệt chạy ứng dụng thật trên DB/ảnh/tài khoản giả. Test dùng chế độ API live để kiểm chứng bước xác nhận, nhưng scanner được thay bằng nguồn giả, chặn mạng ngoài và không chạy publisher; **không có bài đăng Facebook thật**. Nhãn “ĐĂNG THẬT” trong ảnh là trạng thái kiểm thử luồng xác nhận, không phải bằng chứng đã gửi bài.

## Kiểm chứng

`tests/e2e/group-count.test.ts`: quét 40 → chọn 30 → preview/chỉnh riêng → bắt xác nhận lại → hẹn giờ → lưu cấu hình → đổi trang vẫn giữ bản nháp → mobile menu/no-overflow → duyệt đúng 30 job và caption đã sửa, không gửi Facebook. Mở kiểm tra các trang máy/nhóm/TCN/fanpage/lịch sử/đơn hàng, không pageerror hoặc tràn khung desktop.

Tái tạo ảnh bằng PowerShell:

```powershell
$env:APM_UI_SCREENSHOTS = Join-Path $PWD 'docs\design'
npm.cmd test -- tests/e2e/group-count.test.ts
```

App dùng bản UI đã build: mở `Auto-Post-MKT.cmd` hoặc `npm.cmd start`, vào Đăng nhóm. Nếu ứng dụng đang mở, dừng/mở lại rồi tải lại trang (Ctrl+F5) để nhận bundle mới. Không đổi chế độ mô phỏng/thật hay dữ liệu vận hành trong lượt chỉnh giao diện này.
