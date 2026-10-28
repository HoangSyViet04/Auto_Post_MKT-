# Review nhanh UI/UX — 28/10/2026

**Kết luận:** luồng chính dùng được trong phạm vi test; giao diện desktop rõ và nhất quán hơn. Mobile không tràn ngang, menu hoạt động, nhưng trang Đăng nhóm còn dài. Có một lỗi readiness khi tải nhóm thất bại đã được tái hiện và sửa. Chưa kết luận toàn ứng dụng không còn lỗi.

## Lỗi đã sửa

**Mức vừa — duyệt khi chưa tải được danh sách nhóm để xem lại.** Bản nháp có 30 nhóm, chuyển trang quay lại và GET groups trả 500: trước sửa, tick xác nhận làm nút duyệt bật dù bảng nhóm trống. Backend vẫn kiểm tra quyền/dữ liệu, nhưng người dùng không xem lại được đích ở UI. Test trên trình duyệt đã thất bại tại đúng kiểm tra này (`true !== false`).

Đã sửa `PostGroupPage.tsx`: nút duyệt chỉ bật khi đủ các nhóm đã chọn được tải và còn đủ điều kiện cho đúng tài khoản. Lỗi tải nhóm được giữ riêng và xóa khi tải lại thành công/đổi tài khoản. `GroupComposerView.tsx` có nút **Tải lại danh sách**, tải lại bỏ xác nhận thật cũ. Test xác nhận lỗi → bị chặn → tải lại → xác nhận lại → luồng phục hồi; không tạo thêm job trong nhánh lỗi.

## Những gì đã thử qua UI

- Quét 40 nhóm giả, chọn 30, xem/chỉnh riêng caption, hẹn giờ và lưu cấu hình.
- Số 0 / 101 / 1,5 bị từ chối; yêu cầu 60 khi chỉ có 40 thì chọn đúng 40.
- Lọc không thấy kết quả không tự làm mất 30 nhóm đã chọn.
- Đổi trang giữ bản nháp và caption; sửa nội dung cần xác nhận lại.
- Duyệt tạo đúng 30 job; bấm duyệt lại không tạo trùng.
- Menu mobile, các trang máy/nhóm/TCN/fanpage/lịch sử/đơn hàng; không pageerror, không tràn khung ở 1440px, 1024px và 390px.
- Lỗi API danh sách nhóm và khôi phục sau lỗi.

Chạy Edge headless với server/Vite thật, DB/ảnh giả, chặn mạng ngoài và không chạy publisher. Không đăng/quét Facebook thật. Trang fanpage chỉ kiểm tra hiển thị trạng thái chưa có kết nối; chưa kiểm trọn luồng đăng Page trong lượt review này.

## Đánh giá và việc còn nên chỉnh

| Ưu tiên | Quan sát | Đề xuất |
| --- | --- | --- |
| Vừa | Desktop 1440×1000: nút duyệt ở dưới nếp gấp; mobile trang khoảng 2,4 nghìn px, cần cuộn gần 3 màn | Thanh hành động gọn bám đáy hoặc nút dẫn nhanh tới Duyệt, có khoảng đệm để không che nội dung |
| Nhỏ | Một số chữ phụ và thao tác bảng chỉ khoảng 10–11px | Tăng chữ phụ quan trọng; giữ nhãn chính rõ và giảm nội dung hướng dẫn lặp |
| Nhỏ | Trang máy/lịch sử/fanpage còn form/bảng cũ, badge mã Pxx và hướng dẫn dài | Đồng bộ chi tiết với composer; thay mã phát triển bằng nhãn nghiệp vụ |
| Nhỏ | Khi tải nhóm lỗi vẫn có mã nhóm nội bộ trong preview và badge “30 đã chọn / 0 đủ điều kiện” | Hiển thị “Chờ tải danh sách để đối chiếu”; thông báo lỗi nên nổi bật hơn màu thông tin hiện tại. Nút gửi đã được chặn |

## Ảnh đã chụp và xem

- [Desktop — đúng viewport 1440×1000](ui-review-desktop-viewport.png)
- [Desktop — toàn trang](ui-implemented-desktop.png)
- [Màn 1024px](ui-review-compact.png)
- [Mobile — viewport 390×844](ui-review-mobile-viewport.png)
- [Mobile — toàn trang](ui-implemented-mobile.png)
- [Chưa chọn dữ liệu](ui-implemented-empty.png)
- [Nhánh tải nhóm lỗi, đã chặn gửi](ui-review-load-error.png)
- [Quản lý máy](ui-review-products.png) · [Hàng chờ](ui-review-queue.png) · [Fanpage chưa kết nối](ui-review-post-page.png)

Nhãn ĐĂNG THẬT trong ảnh thuộc tình huống kiểm thử luồng xác nhận với nguồn giả, không phải bằng chứng đã đăng lên Facebook.

## Kết quả kiểm tra cuối

Target UI + post-plan + selection: **10/10 đạt**. Sau chỉnh ảnh chụp và xóa lỗi cũ khi đổi tài khoản, chạy lại UI: **1/1 đạt** (~12 giây). Typecheck, lint 195 file, build:web 51 module đều đạt. Không chạy lại toàn bộ gate 320 test vì lượt này là review nhanh và sửa frontend có test UI trực tiếp.
