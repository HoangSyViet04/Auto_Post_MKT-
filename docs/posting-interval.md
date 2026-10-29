# Khoảng nghỉ khi đăng nhiều nhóm

Mở **Đăng nhóm → Lịch đăng → Khoảng nghỉ giữa các nhóm**. Trên desktop ở cột phải, bên dưới Bắt đầu ngay/Hẹn giờ; trên mobile cuộn xuống sau phần Xem trước.

1. Nhập **Tối thiểu (giây)** và **Tối đa (giây)**, ví dụ `90` và `180`.
2. Xem lại máy, tài khoản, nhóm và nội dung; xác nhận đăng thật nếu đang dùng chế độ thật.
3. Bấm **Duyệt và xếp lịch**. Sau khi xử lý lần gửi của một nhóm kết thúc, app nghỉ một số giây nguyên được rút trong khoảng đã chọn trước khi nhận việc tiếp theo của tài khoản đó.

Mặc định form là 60–120 giây. Hai số bằng nhau là nghỉ cố định. Chấp nhận số nguyên từ 0 đến 86400, tối thiểu không lớn hơn tối đa; 0–0 nghĩa là không thêm khoảng nghỉ. Giá trị sai chặn duyệt và lưu cấu hình. Đây là chính sách vận hành do người dùng chọn, không bảo đảm tài khoản không bị hạn chế.

## Cách áp dụng

- Khoảng nghỉ áp dụng cho **lượt duyệt mới**, được lưu cùng từng job. Bài đã xếp giữ chính sách đã có; đổi ô nhập không sửa hàng chờ cũ.
- Lưu/áp dụng **Cấu hình đăng thường dùng** giữ cả min–max. Đổi khoảng nghỉ yêu cầu xác nhận đăng thật lại và dùng mã yêu cầu mới. Bấm lại cùng nội dung không tạo thêm job hoặc rút lại thời gian.
- Bài đầu chạy theo giờ bắt đầu và tình trạng hàng chờ tài khoản. Sau bài trước, khoảng đã rút là thời gian tối thiểu phải chờ; tác vụ đang bận, giờ hẹn trong tương lai hoặc chu kỳ kiểm tra của worker có thể khiến lần xử lý sau muộn hơn.
- Thời hạn nghỉ được lưu trong SQLite, nên mở lại app vẫn phải chờ đủ. Tạm dừng/tiếp tục hoặc Chạy ngay không xóa thời hạn này. Thời gian nghỉ của tài khoản này không chặn tài khoản khác.
- Khi đã qua mốc gửi, kể cả kết quả lỗi/không rõ/chờ admin duyệt, vẫn bắt đầu khoảng nghỉ sau khi lần xử lý kết thúc. Không chờ admin duyệt xong mới nghỉ. Lỗi hoặc hủy trước mốc gửi không tạo khoảng nghỉ của lần gửi chưa xảy ra.
- Worker chết sau mốc gửi: khôi phục về `unknown`, bắt đầu nghỉ từ lúc khôi phục và không tự gửi lại bài đó. Chết trước mốc gửi: tạm dừng, không giả rằng đã gửi.
- Sau mỗi lần gửi, giờ sớm nhất của các job còn chờ trong cùng lô được đẩy đến hết khoảng nghỉ, giữ nguyên các giờ hẹn xa hơn. Nhờ vậy lô dài không tự bị coi là quá hạn chỉ vì người dùng chọn nghỉ. Nếu app tắt quá lâu so với giờ hẹn đã điều chỉnh, quy tắc lịch quá hạn vẫn yêu cầu người dùng xem lại.
- `APM_MIN_GAP_SECONDS` tiếp tục là chính sách dự phòng cho lần gửi **không lưu khoảng nghỉ riêng**, gồm job cũ. Khoảng nghỉ của các lượt Đăng nhóm mới do hai ô trên giao diện quyết định.

## Lưu trữ và kiểm tra

Migration `0007_posting_intervals.sql` thêm bảng độc lập, không sửa migration cũ. Lưu min/max, số giây đã rút một lần lúc xếp job và thời hạn nghỉ được ghi trong cùng transaction kết thúc/phục hồi lần gửi. API danh sách job cung cấp chính sách và thời hạn nghỉ; giao diện hàng chờ hiển thị thời điểm sớm nhất khi tài khoản còn nghỉ.

Kiểm tra bằng DB/ảnh/tài khoản giả, không mở Facebook thật: API validation/idempotency, lưu cấu hình, UI chọn 30 nhóm, nghỉ sau khi xử lý xong, kết nối DB mới, bấm Chạy ngay, lô nghỉ dài hơn 15 phút, unknown và phục hồi worker chết. Có ảnh [desktop](design/posting-interval-20261029/ui-implemented-desktop.png) và [mobile](design/posting-interval-20261029/ui-implemented-mobile.png). Nhãn ĐĂNG THẬT trong ảnh chỉ là fixture kiểm tra bước xác nhận.

Sau cập nhật, đóng/mở lại `Auto-Post-MKT.cmd` rồi Ctrl+F5 để server/worker/UI cùng nhận phiên bản mới. Launcher áp dụng migration theo quy trình khởi động hiện có.
