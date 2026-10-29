# Kiểm chứng khả năng tích hợp — P01

Lập 27/10/2026, **viết lại 29/10/2026** theo bằng chứng thật đã có (bản đầu chỉ có công cụ mô phỏng nên ghi "chưa có khả năng thật nào đạt"; điều đó không còn đúng).

Quy ước: **Đạt** = đã chạy thật, có bằng chứng, có nêu điều kiện. **Một phần** = chạy thật nhưng còn thiếu trường hợp ghi rõ. **Chưa** = chưa thử thật. **Hoãn** = người dùng hoãn. Bằng chứng nằm ở `report_daily.md` (lệnh + kết quả) và thư mục dữ liệu `data/spikes/evidence` (ngoài Git; chỉ có băm danh tính, không cookie/token).

Phạm vi chung của mọi kết luận: **một nick phụ `phu1`**, giao diện Facebook **tiếng Việt**, Edge trên Windows, tháng 10/2026. Facebook đổi giao diện không báo trước; mọi nhận diện bên dưới theo **tên truy cập** (vai trò + nhãn), không theo class CSS, và **dừng** khi không nhận ra.

## Công cụ thử (P01.1)

| Công cụ | Làm gì | Ghi chú an toàn |
| --- | --- | --- |
| `spikes/run.ts` (`npm run spike:offline`) | 7 kịch bản với nhà đăng giả | chỉ mô phỏng, từ chối chế độ thật |
| `spikes/fb-session.ts` | đăng nhập tay, kiểm tra lại danh tính | lưu băm danh tính; khóa hồ sơ |
| `spikes/fb-group-post.ts`, `fb-profile-post.ts`, `fb-adapter-prepare.ts` | đăng thử nhóm/TCN, chuẩn bị đăng | cần xác nhận rõ tài khoản + đích |
| `spikes/fb-groups-read.ts` | đọc "Nhóm đã tham gia" | chỉ đọc |
| `spikes/fb-groups-search.ts` | tìm nhóm theo từ khóa | chỉ đọc |
| `spikes/fb-group-join.ts`, `fb-group-join-dialog.ts` | gửi đúng một yêu cầu tham gia / chụp hộp thoại | giới hạn cứng một / ba lần bấm |

Mọi công cụ thật cần cờ xác nhận riêng, log qua bộ lọc bí mật chung, không cookie/token/ảnh chụp trang trong repo.

## Ma trận khả năng

| Khả năng | Kết luận | Bằng chứng thật | Còn thiếu / điều kiện |
| --- | --- | --- | --- |
| Đăng nhập tay + xác nhận danh tính (P01.2) | **Một phần** | `phu1` đăng nhập tay (Facebook đòi xác minh giữa chừng, người dùng tự xử lý); mở lại bằng tiến trình mới nhiều lần trong ba ngày 27–29/10, gồm cả khi khởi động lại ứng dụng: danh tính khớp. Đăng nhập nhầm nick bị từ chối (test) | **Chưa có profile thứ hai** (tài khoản `test1` đã gỡ). Một tài khoản chưa chứng minh được "không lẫn phiên giữa hai tài khoản" ngoài test giả |
| Proxy (P01.3) | **Hoãn** | — | Người dùng hoãn P04; chưa kết luận giao thức nào |
| Trang cá nhân (P01.4) | **Đạt** (công khai, chữ + 2 ảnh) | 27/10: bài chữ qua hai bước Tiếp/Đăng, đọc đúng đối tượng ở cả hai bước. 28/10 qua ứng dụng: bài công khai 2 ảnh, đọc được ID bài (1549103153905018), người dùng xác nhận đúng nội dung/ảnh/người đăng | Đối tượng khác "Công khai" không thử; ID bài của nick thường chưa kiểm |
| Nhóm: đăng (P01.5) | **Một phần** | Nick quản trị nhóm `1357510931662685`: bài chữ và chữ + 2 ảnh đăng được, nhận `published` + ID bài + số ảnh đúng đáp án thật; qua ứng dụng 28/10 (ID 2307259096687859) người dùng xác nhận | **Chưa gặp "chờ duyệt"/"từ chối"** (cần nhóm bật duyệt + nick thường); ID bài của nick không phải quản trị chưa đọc được. Không suy "chờ duyệt" từ chữ chung trên trang (đã từng nhầm) |
| Đọc nhóm đã tham gia (P01.6a) | **Đạt một phần** | 27/10: 130 nhóm (81 có ID số, 49 chỉ tên rút gọn), dừng khi 3 vòng không thêm | Chưa đối chiếu tổng số thật; nhóm ẩn/lưu trữ chưa kiểm. Luôn ghi "một phần". Chưa chạy qua nút trong ứng dụng |
| Tìm nhóm theo từ khóa (P01.6b) | **Đạt (chỉ đọc)** | 29/10: từ khóa "mua bán điện thoại", 3 vòng: 38 nhóm, 35 có ID số; 38/38 đọc được tên, công khai/riêng tư, số thành viên, nút tham gia | Một từ khóa, một lần. Tìm thấy ≠ đã tham gia ≠ được đăng |
| Gửi yêu cầu tham gia nhóm | **Một phần** | 29/10: 4 nhóm công khai đều **cho vào thẳng** (kiểm tra chỉ đọc sau đó: "Mời" + "Đã tham gia"). Phát hiện và sửa 2 lỗi nhận hộp thoại | **Chưa gặp nhóm bắt duyệt ("Hủy yêu cầu") hay biểu mẫu câu hỏi/nội quy thật**; phần xử lý biểu mẫu mới thử với Facebook giả |
| Fanpage qua Graph API (P01.7) | **Đạt một phần** | 28/10: ứng dụng Meta loại Kinh doanh, chế độ Phát triển, người dùng là quản trị: kết nối Page, kiểm tra quyền, Graph `v23.0`, đăng bài công khai 2 ảnh lên Page "Góc Nghiện Đồ Hay" (~14 giây, ID `107892312229541_1104216589257690`), người dùng xác nhận đúng ảnh/thứ tự | Một ảnh riêng lẻ và giới hạn số ảnh chưa thử (thiết kế luôn có ít nhất một ảnh, tối đa 10 là ước lượng); thời hạn token Page chưa rõ. Chi tiết: `docs/fanpage.md` |
| Dừng trước gửi, phiên hết hạn, cảnh báo (P01.8) | **Đạt bằng mô phỏng** (đúng yêu cầu: không cố gây vi phạm) | Facebook giả trên Edge ngầm: hết phiên, checkpoint, sai danh tính, đổi giao diện, hạn chế khi tham gia nhóm đều dừng trước gửi hoặc ghi `unknown`; stop trước mốc gửi không gửi. Thật: gặp `verification_required` một lần lúc đăng nhập và xử lý đúng (không giải hộ) | Checkpoint giữa lúc đang gửi thật chưa từng gặp |
| Selector/UI/dấu hiệu xác nhận (P01.9) | **Đạt (đã ghi)** | Bảng bên dưới | Chỉ tiếng Việt thật; tiếng Anh dựa trên nhãn dự phòng, chưa thử thật |

## Selector, giao diện và dấu hiệu xác nhận (P01.9)

| Việc | Cách nhận ra | Khi không chắc |
| --- | --- | --- |
| Đã đăng nhập | cookie phiên tồn tại (không đọc giá trị) và không có form đăng nhập; đường dẫn `/checkpoint`, `/login`... = cần xác minh/đăng nhập | dừng, ghi trạng thái |
| Danh tính | mở `/me`, đọc tham chiếu từ URL (`vanity:`/`id:`), so với bản đã lưu | khác hoặc không đọc được → dừng |
| Đúng nhóm | URL còn `/groups/<ID số>` hoặc trang có liên kết chứa ID đó | dừng (`wrong_group`/`destination_not_allowed`) |
| Ô soạn bài | nút tên "Bạn viết gì đi…" / "Write something…"; hộp soạn theo vai trò textbox | không đúng một ô → dừng |
| Đăng | nút "Đăng"/"Post" (trang cá nhân: "Tiếp"/"Next" rồi "Đăng"); đọc đối tượng ở bước cuối | nhiều nút mơ hồ → không bấm |
| Bài đã lên | đoạn đầu caption xuất hiện thêm trong feed; ID bài từ liên kết `/post_insights/<ID>`, `set=pcb.<ID>`, `/posts/`, `/permalink/` (chỉ tin khi tầng đó có đúng một ID) | không chắc → `unknown`, không gửi lại |
| Kết quả tìm nhóm | liên kết `/groups/<ID>` trong `[role=main]`; thẻ = tầng nhỏ nhất có nút; dòng "Công khai · 578K thành viên · 90+ bài viết/ngày"; nút nhãn **"Tham gia nhóm <tên nhóm>"** (kèm tên) | tầng chứa nhiều nhóm = khung chung → không gán trạng thái |
| Tham gia | đúng **một** nút "Tham gia nhóm"/"Join group" hiển thị; xác nhận bằng nút "Đã tham gia"/"Hủy yêu cầu" (trạng thái đổi ưu tiên hơn hộp thoại) | không đúng một nút → dừng (`ui_changed`) |
| Biểu mẫu câu hỏi | hộp thoại **mới sau khi bấm** có ô nhập/ô tick/lựa chọn. `role="dialog"` không đủ: Facebook luôn có sẵn bảng thông báo | không trả lời được toàn bộ → đóng, bỏ qua |
| Hạn chế/cảnh báo | chữ trong `role=alert` hoặc hộp thoại mới (không đọc cả trang) | dừng cả lượt của tài khoản |

Các nhãn tiếng Anh (Write something, Post, Next, Join group, Cancel request, Joined) có trong mã nhưng **chưa thử thật**.

## Kết luận theo kênh (điều kiện chuyển bước)

- **Trang cá nhân:** làm được (công khai); giữ nguyên.
- **Nhóm:** đăng được với tài khoản quản trị; với nick thường **chưa biết** (chờ duyệt/từ chối chưa thấy). Kết quả không chắc luôn là `unknown`.
- **Fanpage:** làm được bằng API chính thức ở chế độ Phát triển với người dùng là quản trị; không cần App Review cho đúng cấu hình này.
- **Quét nhóm đã tham gia / tìm theo từ khóa:** làm được ở mức một phần; luôn ghi một phần.
- **Tham gia nhóm:** làm được với nhóm mở; nhóm bắt duyệt/có biểu mẫu chưa kiểm chứng.
- **Proxy:** hoãn, chưa kết luận.

Đánh giá dựa trên **một nick, vài ngày, một lần cho mỗi khả năng mới (fanpage, tìm từ khóa, tham gia nhóm)**; không coi là đã ổn định lâu dài. Cần thử lại sau khi Facebook/Meta thay đổi và khi có nhóm bắt duyệt, nick thường, tài khoản thứ hai.
