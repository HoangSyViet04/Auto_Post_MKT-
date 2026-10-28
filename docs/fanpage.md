# Đăng fanpage qua Graph API (P09)

Fanpage đăng bằng **API chính thức của Meta**, độc lập với trình duyệt. Tài liệu này mô tả cách làm, cách xử lý lỗi và, quan trọng, **điều đã và chưa được đối chiếu với Meta** (P09.8).

## Cách hoạt động

1. **Kết nối** (`npm run page:connect`, chạy tay trên máy): đổi token người dùng ngắn hạn sang dài hạn, liệt kê Page bạn quản lý (`me/accounts`), kiểm tra token Page (chỉ đọc), lưu **token Page mã hóa theo Windows (DPAPI)**. App Secret và token người dùng **không được lưu**. Không có route HTTP nào nhận hoặc trả token.
2. **Xếp bài** (trang "Đăng fanpage" → `POST /api/page-posts`): tạo bản caption riêng cho đích Page, duyệt theo **kết nối Page** (không cần tài khoản trình duyệt), xếp **một job**. Chống bấm hai lần theo mã yêu cầu. Bị chặn nếu Page chưa đủ quyền/token mất/hết hạn, hoặc máy đã bán.
3. **Worker đăng** (`PagePublisher`, cùng hợp đồng với adapter nhóm/TCN):
   - `prepare` (chưa ai thấy gì): kiểm tra token đúng Page (chỉ đọc), đọc và kiểm tra **tất cả** ảnh (nhận dạng bằng chữ ký file), rồi tải từng ảnh lên Page ở trạng thái **chưa xuất bản** (`published=false`) theo đúng thứ tự. Lỗi ở bước này → dừng **trước khi gửi**, ảnh đã tải được xóa, không có bài nào.
   - `submit`: tạo bài **đúng một lần** (`POST /{page-id}/feed` với `message` và các ảnh đính kèm theo thứ tự). Thành công → `published` kèm ID và liên kết bài (nguồn bằng chứng `api_response`).
   - **Không rõ kết quả** (mất kết nối, quá giờ, lỗi tạm thời của Meta, phản hồi lạ) → `unknown`, **không bao giờ gửi lại**; người dùng kiểm tra trên Page rồi đối chiếu thủ công như các kênh khác.
   - Meta trả lỗi rõ ràng → `failed` với mã đúng; token hết hạn/bị thu hồi hoặc bị từ chối quyền → kết nối được đánh dấu để các job sau bị chặn thay vì thử mãi.
   - `verify` chỉ đọc các bài gần đây của Page, tìm bài trùng caption. Không thấy **không** có nghĩa được phép gửi lại.
4. **Gỡ Page**: thu hồi token, lưu trữ kết nối, hủy job chưa gửi, yêu cầu dừng job đang chạy; không bao giờ chuyển sang Page khác.

## Giới hạn thiết kế

- Bài fanpage **luôn có ảnh** (hợp đồng đăng yêu cầu ít nhất một ảnh, đúng với quy tắc mỗi máy có ít nhất một ảnh). Tối đa **10 ảnh** mỗi bài: giới hạn thận trọng do ứng dụng đặt, chưa đối chiếu với giới hạn của Meta.
- Bài đăng lên fanpage **công khai**.
- Chưa có mã lý do riêng cho "giới hạn tần suất": gộp vào lỗi mạng (câu chữ báo rõ hơn).
- Phiên bản Graph API mặc định `v23.0`, đổi bằng `APM_GRAPH_VERSION`.

## Đã đối chiếu với Meta (đọc trang chính thức ngày 28/10/2026)

- Quyền cho Pages API: `pages_manage_posts`, `pages_read_engagement`, `pages_show_list`, `pages_manage_metadata` (và `pages_manage_engagement`, `pages_read_user_engagement` ở trang Posts).
- Đăng cần **Page access token** và người dùng có tác vụ `CREATE_CONTENT` (và `MANAGE`, `MODERATE`) trên Page.
- Lấy token Page bằng `GET /me/accounts` với token người dùng; kết quả có `tasks` và `access_token` của từng Page.
- Bài chữ: `POST /{page-id}/feed` với `message`. Ảnh: `POST /{page-id}/photos`.
- **Thực nghiệm (28/10/2026):** ứng dụng Meta loại Kinh doanh, chế độ Phát triển, người dùng là quản trị: `me/accounts` trả đúng Page thử với đủ `tasks`; `npm run page:connect` kết nối thành công (chỉ đọc).

## CHƯA đối chiếu hoặc chưa thử (không được coi là đã chắc chắn)

| Điều chưa biết | Vì sao quan trọng | Cách xác minh |
| --- | --- | --- |
| Chế độ Phát triển có **đăng** được mà không cần App Review không | Nếu cần duyệt, việc đăng bị Meta từ chối dù đọc được | Bài thử thật đầu tiên |
| Đính **nhiều ảnh** vào một bài bằng `attached_media[i]={"media_fbid":...}` sau khi tải ảnh `published=false` | Là cách ứng dụng đang dùng; chưa thấy trong trang tài liệu đã đọc | Bài thử thật 1 ảnh rồi 2 ảnh |
| Tải ảnh bằng **dữ liệu file** (`source`, multipart) thay vì `url` | Tài liệu đã đọc chỉ nêu `url`; ứng dụng cố ý không dùng link công khai | Bài thử thật |
| Giới hạn số ảnh, dung lượng ảnh mỗi bài | Giới hạn 10 ảnh là ước lượng thận trọng | Thử thật / đọc tài liệu |
| Thời hạn thật của token Page lấy từ token người dùng dài hạn | Một số nguồn bên thứ ba nói "không hết hạn"; chưa xác minh | Theo dõi; ứng dụng xử lý hết hạn/thu hồi như lỗi thường gặp |
| Phiên bản `v23.0` còn được hỗ trợ | Meta ngừng dần phiên bản cũ | `APM_GRAPH_VERSION` |
| `POST /feed` có khóa chống trùng (idempotency) không | Không có thì mạng đứt sau khi gửi có thể đã tạo bài | Ứng dụng coi là `unknown` và không gửi lại |

## Bí mật

Token Page chỉ nằm trong kho bí mật (DPAPI) và trong bộ nhớ lúc đăng; không bao giờ có trong URL, log, thông báo lỗi, bằng chứng hay phản hồi API (đều có test). Nếu lỡ lộ token, tạo lại token mới ở Graph API Explorer rồi chạy lại `npm run page:connect`; kết nối lại sẽ thu hồi token cũ.
