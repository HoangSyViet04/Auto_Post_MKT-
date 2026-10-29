# Tìm nhóm theo từ khóa và gửi yêu cầu tham gia (P06.3)

Mục đích: tìm nhóm mới trên Facebook bằng từ khóa, tick chọn và gửi yêu cầu tham gia với **số lượng do bạn kiểm soát**, để tránh tham gia quá nhiều nhóm trong thời gian ngắn.

> **Trạng thái trung thực:** phần **tìm (chỉ đọc)** đã chạy thật một lần ngày 29/10/2026 trên nick phụ `phu1` (từ khóa "mua bán điện thoại", 3 vòng cuộn: 38 nhóm, 35 có ID số) và bộ đọc đã được chỉnh theo giao diện thật. Phần **gửi yêu cầu tham gia chưa chạy thật lần nào**: chỉ kiểm thử với Facebook giả (Edge ngầm, chặn mọi yêu cầu ra ngoài); nút trên **trang nhóm**, hộp thoại câu hỏi và thông báo hạn chế vẫn là suy từ nhãn truy cập (vi/en).

## Luồng sử dụng

1. **Quét nhóm → Nhóm đã tham gia**, chọn tài khoản ở bộ lọc phía trên. Tài khoản phải đã đăng nhập, xác nhận danh tính, không tạm dừng. Ứng dụng phải ở chế độ THẬT (`APM_INTEGRATIONS=live`, `APM_BROWSER=real`).
2. Ở khung **Tìm nhóm theo từ khóa và gửi yêu cầu tham gia**: nhập từ khóa, số kết quả tối đa (1–200), bấm **Tìm nhóm**. Việc tìm chỉ đọc; có thể **Dừng tìm**, kết quả đã đọc vẫn giữ.
3. Danh sách kết quả hiện tên, công khai/riêng tư, số thành viên, trạng thái (có thể tham gia / đã là thành viên / đã gửi yêu cầu / chưa rõ). Trường không đọc được hiển thị “chưa rõ”, không đoán.
4. Nhập **Số nhóm muốn gửi yêu cầu** rồi tick tay, hoặc bấm **Chọn tự động N nhóm đầu**. Số tick không được vượt số bạn nhập và không được vượt hạn mức còn lại; vượt thì nút gửi bị khóa kèm lý do.
5. Tick ô xác nhận **GỬI THẬT** rồi bấm **Gửi yêu cầu tham gia**. Các yêu cầu được xếp hàng; theo dõi ở bảng “Yêu cầu tham gia gần đây”. Có thể **Hủy** từng yêu cầu chờ hoặc **Hủy các yêu cầu đang chờ**.
6. Yêu cầu thành công chỉ có nghĩa **đã gửi, chờ quản trị viên duyệt**. Khi được duyệt, quét lại “Nhóm đã tham gia”, kiểm tra nội quy và tự đặt “Được đăng”. Tìm thấy hay đã tham gia **không** tự cấp quyền đăng.

## Cách kiểm soát số lượng (chống tham gia quá nhiều)

| Lớp | Quy tắc |
| --- | --- |
| Mỗi lượt | Số tick ≤ số bạn nhập (tối đa 30). Server cũng từ chối, không chỉ giao diện. |
| Mỗi tài khoản / 24 giờ | Hạn mức mặc định **5**, chỉnh được 1–30 (mục “Hạn mức và khoảng cách”). Tính theo 24 giờ gần nhất, không theo ngày lịch. Yêu cầu đã xếp mà chưa gửi cũng chiếm chỗ. |
| Giãn cách | Mặc định **3–6 phút** ngẫu nhiên giữa hai lần gửi của cùng tài khoản (chỉnh 1–60 / 1–120 phút). Yêu cầu đầu chạy ngay hoặc sau khoảng tối thiểu kể từ lần gửi gần nhất. |
| Ba lần kiểm tra | Hạn mức được kiểm tra lúc xếp, lúc worker nhận việc và **ngay trước khi bấm**. Nếu bạn hạ hạn mức sau khi xếp, các yêu cầu chờ bị bỏ qua (`daily_cap`), không bấm. |
| Không trùng | Một nhóm chỉ có một yêu cầu đang chờ/đã gửi/chưa rõ cho mỗi tài khoản; xếp lại bị từ chối. |
| Chỉ một cái một lúc | Mỗi yêu cầu mở hồ sơ riêng, gửi rồi đóng; không bấm dồn. |

Những con số này giảm rủi ro nhưng **không bảo đảm** Facebook không hạn chế tài khoản; ngưỡng của Facebook không công khai. Nên dùng nick phụ và tăng dần.

## Khi gặp vấn đề

- **Nhóm có câu hỏi/điều khoản** (biểu mẫu hiện sau khi bấm Tham gia). Cách xử lý do bạn chọn trong mục “Hạn mức và khoảng cách”:
  - **Tự tick đồng ý nội quy** (mặc định bật): tick các ô có nhãn nhắc tới nội quy/quy định/điều khoản/đồng ý.
  - **Câu trả lời mặc định** (mặc định trống): điền vào mọi câu hỏi viết tay; trống thì nhóm có câu hỏi viết tay bị bỏ qua. Cùng một câu cho mọi nhóm nên chỉ nên viết câu chung chung, đúng sự thật.
  - **Không bao giờ trả lời hộ** câu chọn đáp án (trắc nghiệm, danh sách chọn) hay ô tick không phải đồng ý nội quy.
  - Chỉ làm khi trả lời được **toàn bộ** biểu mẫu và có đúng một nút gửi; ngược lại không đụng gì, đóng lại, ghi “cần tự làm tay”. Nút Gửi chỉ bấm một lần.
  - Nhận diện biểu mẫu theo **nội dung** (hộp thoại mới xuất hiện sau khi bấm và có ô nhập/ô tick/lựa chọn), không theo `role="dialog"`: Facebook luôn có sẵn hộp thoại (bảng thông báo), nên lần thử thật đầu đã nhầm.
  - **Chưa kiểm chứng trên Facebook thật:** cả bốn nhóm công khai điện thoại đã thử (29/10/2026) đều cho vào thẳng, **chưa gặp biểu mẫu thật nào**; cấu trúc biểu mẫu mới chỉ thử với Facebook giả dựng theo nhãn truy cập. Gặp nhóm có biểu mẫu thật, kết quả có thể là bỏ qua hoặc “chưa rõ”: hãy báo lại để chỉnh.
- **Facebook báo hạn chế/đã đạt giới hạn** (thông báo trong hộp thoại/cảnh báo): đánh dấu `action_blocked` và **bỏ qua mọi yêu cầu còn chờ** của tài khoản đó. Chữ tương tự nằm trong bài của nhóm không bị coi là hạn chế (chỉ đọc hộp thoại/cảnh báo).
- **Phiên hết hạn / checkpoint / sai danh tính:** dừng, bỏ qua các yêu cầu còn chờ, cập nhật trạng thái tài khoản. Không tự giải CAPTCHA.
- **Bấm nhưng không thấy xác nhận:** `unknown` (“Chưa rõ kết quả”); tính vào hạn mức; **không bao giờ bấm lại**. Hãy mở Facebook xem.
- **Worker mất giữa chừng:** sau mốc gửi → `unknown`; trước mốc gửi → lỗi chưa gửi.
- **Trang mở ra không đúng nhóm / không đúng một nút Tham gia:** dừng trước khi bấm (`wrong_group`, `ui_changed`).
- **Tài khoản bị tạm dừng/đổi danh tính sau khi xếp:** yêu cầu chờ bị hủy, không gửi.

## Cách làm kỹ thuật

- Tìm dùng lại `scan_runs` (`mode='keyword'`, một lượt đang chờ/chạy mỗi tài khoản), kết quả lưu ở bảng riêng `group_search_results`. **Không tạo nhóm đích** (`destinations`) cho kết quả tìm: một nhóm chỉ thành đích sau khi vào được và quét ở “Nhóm đã tham gia”.
- Yêu cầu tham gia ở bảng `group_join_requests` (migration `0008_group_search_join.sql`), hạn mức/giãn cách ở `group_join_settings`. Ghi mốc gửi (`send_started_at`) ngay trước khi bấm, trong transaction cùng việc kiểm tra hạn mức.
- Server chỉ ghi yêu cầu; worker (`apps/worker/src/group-discovery.ts`) giữ khóa hồ sơ dùng chung với đăng bài/đăng nhập/quét và điều khiển trình duyệt (`#browser`: `group-search.ts`, `group-join.ts`). API gửi yêu cầu cần chế độ THẬT, worker có trình duyệt và `confirmReal: true`.
- Nhận diện theo **nhãn truy cập** (vai trò + tên), không theo class CSS. Thẻ kết quả: đi lên tầng nhỏ nhất có nút; nếu tầng đó chứa liên kết của nhiều nhóm thì coi là khung chung và **không** gán trạng thái (tránh gán nhầm nút của nhóm khác). Trạng thái ở trang tìm chỉ để tham khảo: trước khi gửi, bộ gửi mở lại **chính trang nhóm**, kiểm tra đúng nhóm, chưa là thành viên, có **đúng một** nút “Tham gia”.

## Kiểm chứng

Test Facebook giả (không có kết nối thật): đọc kết quả, trạng thái từng thẻ, thẻ không có nút không mượn nút nhóm khác, loại trùng, giới hạn, hủy, giao diện đổi, sai danh tính/checkpoint; gửi một lần, ghi mốc trước khi bấm, đã là thành viên/đã gửi → không bấm, hai nút/không nút/sai nhóm → không bấm, hộp thoại câu hỏi → không gửi, thông báo hạn chế → dừng, chữ cảnh báo trong bài không làm dừng, bấm mà không xác nhận → `unknown`; hạn mức/giãn cách/trùng/hủy/worker mất ở kho dữ liệu; API (xác nhận, giới hạn, chế độ mô phỏng không gửi); logic chọn số lượng ở giao diện.

## Thử thật theo từng bước

1. **Chỉ đọc — ĐÃ LÀM 29/10/2026.** Facebook thật: mỗi thẻ kết quả có tên, dòng "Công khai · 578K thành viên · 90+ bài viết/ngày", "N người bạn là thành viên" và một nút có nhãn **"Tham gia nhóm &lt;tên nhóm&gt;"** (nhãn có kèm tên). Bộ đọc ban đầu đoán nhãn là "Tham gia nhóm" trơn và dòng loại là "Nhóm công khai" nên đọc sai; đã sửa và kiểm lại offline trên 38 thẻ thật: 38/38 đọc được, 38 "có thể tham gia", 37 công khai + 1 riêng tư, 38 có số thành viên, 3 thẻ không có ID số (bị bỏ qua khi lưu). Script: `node spikes/fb-groups-search.ts --label=<nhãn> --keyword="..." --confirm-real` (chỉ đọc, ghi bằng chứng vào thư mục dữ liệu, ngoài repo).
2. **Gửi đúng MỘT yêu cầu — ĐÃ LÀM 29/10/2026** (nick `phu1`, nhóm công khai "MUA BÁN ĐIỆN THOẠI CŨ HÀ NỘI", ID 260059431033894, 578K thành viên, người dùng cho phép và để ứng dụng chọn nhóm). Kết quả thật: trang nhóm có 2 nút "Tham gia nhóm" (đầu trang và thanh dính) nhưng chỉ 1 nút hiển thị/truy cập được nên bộ gửi nhận ra đúng một nút; sau khi bấm, nhóm **cho vào ngay** (đầu trang đổi thành "Mời" + "Đã tham gia") và hiện một hộp thoại. **Lỗi đã tìm ra và sửa:** bộ gửi coi mọi hộp thoại là câu hỏi nên ghi sai "bỏ qua" dù nick đã vào; nay trạng thái đã đổi (đã vào/đã gửi yêu cầu) được ưu tiên hơn hộp thoại, có test hồi quy. **Chưa thấy thật:** nhóm bắt duyệt (nút "Hủy yêu cầu"), nhóm có câu hỏi bắt buộc, thông báo Facebook hạn chế. Nick `phu1` hiện **là thành viên** nhóm này (lượt thử không rời nhóm; bạn tự rời nếu không muốn). Bản ghi ở bảng `group_join_requests` không có vì lượt thử chạy ngoài ứng dụng (script `spikes/fb-group-join.ts`, dùng đúng `createGroupJoiner`) vào một nhóm bạn chọn, có bạn xem trên màn hình; đối chiếu kết quả “đã gửi, chờ duyệt”.
3. Chỉ khi bước 1–2 đúng mới tăng số lượng; giữ hạn mức thấp những ngày đầu.
