# Quét nhóm đã tham gia và chọn số nhóm muốn đăng

## Luồng sử dụng

1. Ở **Quản lý tài khoản**, đăng nhập và kiểm tra đúng tài khoản. Tài khoản không được tạm dừng.
2. Mở **Quét nhóm → Nhóm đã tham gia**, chọn một tài khoản ở bộ lọc phía trên.
3. Nhập **Giới hạn số nhóm đọc** (1–1000, mặc định 200), bấm **Quét nhóm đã tham gia**. Cần server và worker cùng chạy chế độ `APM_INTEGRATIONS=live`, worker có `APM_BROWSER=real`. Chế độ mô phỏng không mở Facebook để quét.
4. Theo dõi số nhóm có ID số đã lưu và số nhóm chỉ có tên rút gọn bị bỏ qua. Có thể **Dừng quét**; kết quả đã lưu vẫn còn. Quét lại không nhân bản nhóm đã có cùng ID.
5. Kiểm tra nội quy, đặt **Quyền đăng → Được đăng** cho nhóm phù hợp. Quét chỉ xác nhận đã tham gia, không tự xác nhận được đăng bán hàng. Nhóm đã có quyền/nội quy/ưu tiên vẫn giữ nguyên sau quét.
6. Vào **Chức năng đăng bài → Đăng bài viết nhóm**, chọn tài khoản và máy. Có thể lọc theo tên/ID/khu vực/nội quy trước khi chọn.
7. Nhập **Số nhóm muốn đăng**, ví dụ `30`, bấm **Chọn theo số lượng**. App thay danh sách chọn hiện tại bằng tối đa 30 nhóm đủ điều kiện trong bộ lọc hiện tại, ưu tiên nhóm đánh dấu “Ưu tiên”, sau đó theo tên và mã nhóm để thứ tự ổn định.
8. Nếu chỉ có 23 nhóm đủ điều kiện thì thông báo **23/30**, không tự lấy nhóm của tài khoản khác hoặc nhóm chưa được đăng để bù.
9. Xem trước caption, ảnh, tài khoản, từng nhóm và lịch. Xác nhận đăng thật nếu đang ở chế độ thật, rồi bấm **Duyệt và xếp lịch**. Quét và chọn theo số lượng không tự tạo tác vụ đăng.
10. Theo dõi kết quả từng nhóm ở hàng chờ. Số nhóm được chọn là số lượt đăng được duyệt, không phải cam kết từng ấy bài sẽ xuất hiện: có thể có chờ duyệt, lỗi hoặc kết quả chưa rõ.

## Phạm vi và giới hạn

- Mỗi lượt xếp tối đa 100 nhóm. Giới hạn quét khác số nhóm muốn đăng: quét 200 nhóm có thể chỉ chọn 30 nhóm để đăng.
- Chỉ đọc nhóm đã tham gia từ giao diện Facebook; chưa tìm nhóm bằng từ khóa, chưa tự tham gia/rời nhóm, chưa áp dụng cho fanpage.
- Kết quả luôn ghi **một phần**, kể cả khi không thấy nhóm mới. Dừng khi đạt giới hạn, không thấy nhóm mới ba lượt, đạt 60 lượt cuộn, mất phiên, cảnh báo, yêu cầu dừng hoặc lỗi.
- Nhóm vắng trong lượt quét không bị đánh dấu đã rời, không xóa dữ liệu cũ. Chỉ lưu nhóm có ID số; nhóm có tên rút gọn được đếm riêng, chưa làm giàu ID tự động.
- Worker dùng chung khóa trình duyệt với đăng bài/đăng nhập. Quét chờ khi hồ sơ đang bận; dừng và đóng hồ sơ nếu mất quyền xử lý. Không tiếp tục scan cũ của worker đã mất; người dùng chủ động quét lại.
- Quét không tự mở khi khởi động ứng dụng; cần người dùng bấm. Máy và worker cần hoạt động trong lúc quét/đăng.

## Kiểm chứng

Các kiểm thử dùng DB tạm và Facebook giả trên Edge headless, chặn mọi yêu cầu ra Facebook thật. Bao phủ lưu tiến độ, hủy, mất worker, chia khóa hồ sơ, kiểm tra danh tính, giữ quyền/nội quy, loại trùng, chọn đúng tài khoản và luồng giao diện quét 40 nhóm → chọn 30 → duyệt 30 tác vụ.

Lượt triển khai này chưa chạy quét trên tài khoản Facebook thật bằng giao diện mới, chưa đăng thật 30 nhóm. Cần nghiệm thu đọc nhóm thật trên tài khoản được chọn và đối chiếu mẫu trước khi tuyên bố phần tích hợp đã đạt thực tế.
