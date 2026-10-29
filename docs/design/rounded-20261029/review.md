# Tinh chỉnh hình dáng khung và nút — 29/10/2026

Người dùng phản hồi box và button còn vuông, trông cứng. Đợt này sửa hình dáng, khoảng đệm, viền và bóng trong CSS dùng chung.

- Card chính: góc 24 px, đệm 22 px trên desktop/16 px trên mobile; bóng khuếch tán nhẹ.
- Ô nhập, dropdown, tìm kiếm: góc 14 px. Khung bảng/ảnh/fieldset: 18 px.
- Nút thao tác: bo tròn hai đầu; badge cũng dùng dạng viên. Link chữ và tab giữ cấu trúc phù hợp.
- Viền xanh xám nhạt hơn, nền trang và banner nhẹ hơn. Ô chọn máy có nền/viền bo tròn đồng bộ với ô chọn tài khoản.
- Chỉ sửa `apps/web/src/styles.css`; dùng biến CSS để các trang chia sẻ cùng mức bo góc. Không đổi logic hay thêm thư viện.

Ảnh đối chiếu: [trước](../motion-20261029/ui-implemented-desktop.png) · [sau desktop](ui-implemented-desktop.png) · [sau mobile](ui-implemented-mobile.png).

Đã xem ảnh desktop/mobile; không cắt chữ hay tràn ngang ở các viewport kiểm tra 1440, 1024, 390 px. Trên mobile, nút quét được xuống dòng khi thiếu chỗ. Test UI offline hiện có đạt: chọn 30 nhóm, preview, sửa caption, lưu cấu hình, menu, xếp đúng 30 job, chống bấm hai lần và hồi phục lỗi tải. Typecheck/lint 196 file/build web 52 module đạt.

Ảnh là ứng dụng chạy với DB/ảnh/tài khoản giả; nhãn ĐĂNG THẬT chỉ dùng thử bước xác nhận. Không mở Facebook thật hoặc gửi bài trong lượt này. Ảnh tĩnh tắt animation để chụp trạng thái ổn định.

Mở lại `Auto-Post-MKT.cmd` và Ctrl+F5 để nhận bản giao diện mới.

Gate toàn dự án: `npm.cmd run check` đạt 319/320 test, dừng vì ca fanpage 2 ảnh trả `network_error` tại fixture localhost (timeout cấu hình 800 ms). Chạy lại riêng `page-publisher.test.ts` đạt 11/11; nguyên nhân khi chạy chung chưa xác định chắc. Không sửa phần fanpage trong lượt CSS; build web riêng đã đạt. Không coi đây là full gate xanh.
