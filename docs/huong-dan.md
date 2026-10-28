# Hướng dẫn sử dụng Auto Post MKT (Windows)

Dành cho người vận hành đăng bài bán điện thoại lên Facebook bằng một hoặc hai tài khoản của chính bạn. Ứng dụng chạy trên máy của bạn, dữ liệu nằm trên máy, và **không tự đăng gì khi bạn chưa duyệt và xếp lịch**.

## 1. Cài đặt lần đầu

1. Cài **Node.js 24 LTS** (nodejs.org), **Git for Windows** và **Microsoft Edge**.
2. Tải mã nguồn vào một thư mục thường (ví dụ `D:\Project\Auto_Post_MKT`). **Đừng đặt trong OneDrive/Dropbox**: dịch vụ đồng bộ làm hỏng thư mục `node_modules`.
3. Mở cửa sổ lệnh tại thư mục đó và chạy `npm ci` một lần.
4. Dữ liệu của bạn (cơ sở dữ liệu, ảnh, hồ sơ đăng nhập Facebook, bản sao lưu) nằm ngoài mã nguồn, tại `%LOCALAPPDATA%\AutoPostMKT`. Muốn đổi chỗ, đặt `APM_DATA_DIR` trong file `.env`.

Đường dẫn có dấu tiếng Việt hoặc khoảng trắng đều dùng được.

## 2. Khởi động và dừng

- **Khởi động:** nhấp đúp `Auto-Post-MKT.cmd` (hoặc `npm start`). Cửa sổ sẽ kiểm tra môi trường, bật máy chủ và worker rồi mở trình duyệt tại `http://127.0.0.1:4317/`. Lần đầu có thể mất vài giây để dựng giao diện.
- **Giữ cửa sổ này mở.** Lịch đăng chạy **trong cửa sổ này**: máy phải bật, không ngủ, có mạng và cửa sổ đang mở thì lịch mới chạy. Đóng cửa sổ (hoặc Ctrl+C) là dừng nhận việc. Ứng dụng không cam kết chạy khi máy tắt.
- **Mở lại sau khi tắt:** các bài hẹn đã trễ quá 15 phút **không tự đăng dồn**; chúng hiện là "quá hạn" ở Hàng chờ đăng để bạn chọn chạy ngay hoặc bỏ. Bài đã bấm gửi mà chưa rõ kết quả hiện là "Chưa rõ kết quả" (xem mục 6).
- Nếu launcher báo `[LỖI]`, đọc dòng gợi ý ngay bên dưới (thiếu Node, chưa `npm ci`, cổng bị chiếm, đã có bản khác đang chạy…). Chạy `Auto-Post-MKT.cmd --check` để chỉ kiểm tra.

### Chế độ MÔ PHỎNG và chế độ THẬT

Mặc định là **MÔ PHỎNG**: mọi thứ chạy nhưng **không gửi gì tới Facebook** (banner vàng ở đầu trang). Để đăng thật, tạo file `.env` cạnh `package.json` và thêm dòng:

```
APM_INTEGRATIONS=live
```

Khi đó cửa sổ hiện "Chế độ: THẬT" và trang có banner đỏ. Mỗi lần xếp lịch ở chế độ thật, bạn phải tick ô xác nhận "ĐĂNG THẬT". **Không bao giờ ghi mật khẩu Facebook, proxy hay khóa API vào `.env`** — bạn đăng nhập Facebook bằng tay trong trình duyệt.

Các biến thường dùng (đều tùy chọn, ghi trong `.env`):

| Biến | Ý nghĩa |
| --- | --- |
| `APM_INTEGRATIONS` | `fake` (mặc định, mô phỏng) hoặc `live` (đăng thật) |
| `APM_SERVER_PORT` | Cổng, mặc định 4317 |
| `APM_DATA_DIR` | Nơi lưu dữ liệu |
| `APM_MIN_GAP_SECONDS` | Giãn cách tối thiểu giữa hai lần đăng của cùng một tài khoản (mặc định 60) |
| `APM_OVERDUE_MINUTES` | Quá bao nhiêu phút thì bài hẹn không tự chạy (mặc định 15) |
| `APM_PROFILE_AUDIENCE` | Bắt buộc đối tượng bài ở TCN (ví dụ `Công khai`); khác thì worker dừng, không đăng |
| `APM_LOG_LEVEL` | `warn` (mặc định khi chạy bằng launcher), `info` hoặc `debug` khi cần chẩn đoán |
| `APM_DIAG_CAPTURE` | `on` để lưu ảnh chụp màn hình khi đăng thật bị lỗi (mặc định tắt, xem mục 8) |

## 3. Tài khoản (tối đa hai)

Trang **Quản lý tài khoản**:

1. **Thêm tài khoản** và đặt nhãn (ví dụ "Nick phụ").
2. **Đăng nhập**: Edge mở ra để **bạn tự đăng nhập** (kể cả mã xác minh). Ứng dụng chỉ chờ, không nhập gì, không đọc mật khẩu.
3. **Kiểm tra phiên** để xác nhận còn đăng nhập và đọc danh tính. Phiên hết hạn hoặc Facebook yêu cầu xác minh thì bài của tài khoản đó **dừng**, bạn xử lý trực tiếp trên Facebook rồi kiểm tra lại.
4. **Tạm dừng/Tiếp tục** từng tài khoản hoặc tất cả; **Gỡ** tài khoản (việc chờ bị hủy).

Phiên đăng nhập nằm trong hồ sơ trình duyệt riêng của từng tài khoản và **không** nằm trong bản sao lưu.

## 4. Máy và nhóm

**Quản lý máy:** tạo máy chỉ cần **ảnh, tên máy và tình trạng**; giá, dung lượng, pin, bảo hành, khu vực là tùy chọn. Ứng dụng chỉ đưa vào bài những gì bạn đã nhập, không tự thêm giá hay thông số. Thứ tự ảnh bạn sắp xếp là thứ tự đăng.

**Nhóm:** ở trang **Nhóm đã tham gia**, thêm nhóm bằng link hoặc ID số, ghi nội quy, khu vực, nhóm có duyệt bài hay không. Nhóm chưa có ID số, chưa tham gia, chưa xác nhận được phép đăng hoặc đã đánh dấu không phù hợp sẽ **bị khóa**, không đăng được. (Đọc tự động danh sách nhóm đã tham gia chưa nằm trong bản bàn giao này.)

## 5. Đăng bài

### Đăng nhóm — trang "Đăng bài viết nhóm"

1. Chọn **tài khoản** và **máy**; caption mẫu tự điền, bạn sửa được.
2. Tick các **nhóm** (nút "Chọn tất cả đủ điều kiện" nếu cần). Mỗi nhóm là một bài và một kết quả riêng.
3. **Lịch**: bắt đầu ngay, hoặc hẹn giờ (giờ Việt Nam).
4. **Xem trước từng nhóm**: ảnh theo thứ tự, caption (sửa riêng từng nhóm được), nội quy, cảnh báo nếu nhiều nhóm cùng một caption (dễ bị coi là lặp).
5. Bấm **Duyệt và xếp lịch**. Nếu có nhóm không đủ điều kiện, **không job nào được xếp**; bỏ chọn nhóm bị đánh dấu rồi bấm lại. Bấm hai lần không tạo bài trùng.

### Đăng trang cá nhân — trang "Đăng bài viết cá nhân"

Chọn một hoặc hai tài khoản, máy, caption (sửa riêng từng tài khoản được). Đích luôn là **trang cá nhân của chính tài khoản đó**; hai tài khoản là hai bài riêng. Ứng dụng cảnh báo nếu hai tài khoản dùng cùng caption.

### Cấu hình thường dùng

Ở trang đăng nhóm, ô **Cấu hình thường dùng** lưu lại cặp tài khoản–nhóm, mẫu caption (chỗ trống như `{ten}`, `{gia}`; dòng thiếu dữ kiện tự bỏ) và giờ hẹn hằng ngày. Áp dụng chỉ điền sẵn form; bạn vẫn xem trước và duyệt.

### Fanpage và proxy

- **Fanpage: chưa hỗ trợ** (cần ứng dụng Meta được cấp quyền). Trang "Đăng bài fanpage" mới là khung.
- **Proxy: chưa có** (hoãn có chủ đích). Ứng dụng dùng kết nối mạng trực tiếp của máy.

## 6. Hàng chờ và kết quả

Trang **Hàng chờ đăng** liệt kê từng bài theo từng nhóm. Lọc theo trạng thái, tài khoản, máy, khoảng giờ; bấm **Chi tiết** để xem caption và ảnh đã duyệt, các lần thử và nhật ký.

| Trạng thái | Nghĩa | Bạn làm gì |
| --- | --- | --- |
| Chờ đến giờ | Chưa tới giờ hẹn | Tạm dừng, chạy ngay hoặc hủy |
| Đã đăng | Thấy bài trên trang đích | — |
| Đã gửi, chờ admin duyệt | Nhóm kiểm duyệt | Khi admin duyệt/từ chối, ghi nhận ở Chi tiết |
| Chưa rõ kết quả | Đã bấm gửi nhưng không chắc | **Mở Facebook kiểm tra**, rồi chọn trong Chi tiết: đã đăng / chờ duyệt / chưa đăng (có xác nhận hai bước). **Ứng dụng không bao giờ tự gửi lại.** Muốn đăng lại thì tạo bài mới |
| Cần xem lại | Máy đã sửa sau khi duyệt | Chỉ hủy được; tạo bài mới với nội dung mới |
| Bị chặn / Lỗi | Phiên hết hạn, ảnh hỏng, giao diện Facebook đổi… | Đọc lý do, xử lý rồi tạo bài mới |
| Quá hạn | Hẹn đã trễ hơn ngưỡng | Chạy ngay hoặc bỏ |

**Sửa hoặc bán máy:** khi lưu bản sửa hay đánh dấu đã bán/ngừng bán, ứng dụng báo trước bao nhiêu bài sẽ bị ảnh hưởng (sửa → "Cần xem lại"; bán/ngừng bán → bị hủy) và hỏi xác nhận. Bài đã gửi không bị đổi.

## 7. Khách hỏi và đơn hàng

Trang **Khách hỏi và đơn hàng** để bạn **tự ghi** khách hỏi và đơn (kèm bài nguồn nếu biết, giá trị đơn tùy chọn) và xem tổng hợp theo máy và theo nơi đăng. Ứng dụng **không tự đọc** tin nhắn hay bình luận trên Facebook. Ghi nhầm thì "Hủy ghi nhận" (đánh dấu, không xóa).

## 8. Sao lưu, phục hồi, cập nhật, chẩn đoán

- **Sao lưu:** `npm run backup` (chạy được khi ứng dụng đang mở). Bản sao lưu gồm dữ liệu và ảnh, **không** gồm hồ sơ đăng nhập Facebook, khóa, log. Chép bản sao lưu sang ổ khác. Chi tiết: [backup.md](backup.md).
- **Phục hồi:** đóng ứng dụng rồi `npm run restore -- "<thư mục sao lưu>" --verify-only` để kiểm tra, sau đó bỏ `--verify-only` (thêm `--replace` nếu đang có dữ liệu; dữ liệu cũ được đổi tên, không xóa). Sau phục hồi các bài chờ ở trạng thái tạm dừng và bạn phải đăng nhập lại tài khoản.
- **Cập nhật:** đóng ứng dụng, chạy `Cap-nhat-Auto-Post-MKT.cmd` (hoặc `npm run update`). Nó sao lưu và kiểm tra trước, rồi tải bản mới, nâng cơ sở dữ liệu và dựng lại giao diện; dừng ngay khi có gì bất thường và in cách quay về. Hồ sơ đăng nhập, ảnh và dữ liệu giữ nguyên.
- **Chẩn đoán:** `npm run diagnostics` in báo cáo chỉ gồm số đếm và trạng thái (không có nội dung bài, tên, link hay bí mật) để gửi khi cần hỗ trợ.
- **Ảnh chụp màn hình khi lỗi** (tùy chọn): đặt `APM_DIAG_CAPTURE=on` thì mỗi lần đăng thật dừng vì lỗi sẽ lưu một ảnh vào `%LOCALAPPDATA%\AutoPostMKT\diagnostics`, giữ 24 giờ rồi tự xóa (`APM_DIAG_RETENTION_HOURS`). Ảnh có thể chứa thông tin cá nhân; không chia sẻ. Xóa ngay: `npm run diagnostics -- --purge-captures`.

## 9. Gặp sự cố

| Triệu chứng | Cách xử lý |
| --- | --- |
| "Cổng 4317 đang bị chương trình khác dùng" | Đóng chương trình đó hoặc đặt `APM_SERVER_PORT=4318` trong `.env` |
| "Đã có một worker đang chạy" | Đang mở một cửa sổ Auto Post MKT khác; đóng nó rồi chạy lại |
| "Worker chưa chạy" trên trang | Mở lại bằng `Auto-Post-MKT.cmd` |
| Facebook yêu cầu xác minh / hết phiên | Mở Edge của tài khoản (nút Đăng nhập), xử lý trên Facebook, rồi "Kiểm tra phiên" |
| Bài dừng vì "giao diện Facebook đã đổi" | Không đăng lại tự động. Báo để cập nhật ứng dụng; có thể bật ảnh chụp lỗi để gửi kèm |
| Lịch trễ sau khi máy ngủ/tắt | Bình thường: bài hiện "quá hạn", bạn quyết định |
| Máy chưa có Edge | Cài Microsoft Edge; ứng dụng vẫn mở nhưng không đăng nhập/đăng bài được |

## 10. Nguyên tắc an toàn

- Không bấm xác nhận "ĐĂNG THẬT" khi chưa kiểm tra đúng tài khoản, nhóm và nội dung.
- Ứng dụng giúp bớt thao tác, **không bảo đảm** tránh bị giới hạn hay khóa tài khoản. Đăng đều tay, nội dung khác nhau giữa các nhóm.
- Bài có kết quả chưa rõ phải kiểm tra bằng mắt trước khi tạo bài mới, kẻo đăng trùng.
