# ADR 0004 — Truy cập API cục bộ qua Host, Origin và token trong bộ nhớ

- Ngày: 2026-10-27
- Trạng thái: Đã chấp nhận
- Phạm vi: P00.8

## Bối cảnh

Server chỉ nghe `127.0.0.1` nhưng trình duyệt có thể gửi request từ một website khác tới loopback. DNS rebinding và CSRF cần được chặn trước khi có API thay đổi dữ liệu. Đây là ứng dụng cho một người vận hành trên một máy, chưa có tài khoản đăng nhập hay truy cập từ xa.

## Quyết định

1. Giữ listener `127.0.0.1`, không bật trust proxy, không dùng forwarded headers để xác định quyền. Root `onRequest` kiểm tra IP loopback và `Host` theo allowlist chính xác: `127.0.0.1:<serverPort>`; development thêm `127.0.0.1:<webPort>` vì Vite proxy giữ Host. Mặc định 4317/5173. Không chấp nhận domain tùy ý, alias localhost, port khác hoặc biến thể số của loopback. Kiểm tra `rawHeaders` để chặn Host/Origin/Fetch Metadata/token/content type trùng lặp, kể cả khi Node đã bỏ hoặc ghép giá trị.
2. `Origin` nếu có phải đúng origin HTTP trong allowlist, không chuẩn hóa từ URL khác. Origin `null`, credentials, hậu tố domain, HTTPS hoặc path đều không hợp lệ. Với mutation (mọi method ngoài GET/HEAD/OPTIONS), bắt buộc phải có Origin hợp lệ. GET/HEAD cho phép thiếu Origin để hỗ trợ health/CLI cục bộ.
3. `Sec-Fetch-Site: cross-site` hoặc giá trị không biết bị từ chối trên mọi route, bao gồm health và bootstrap. Chấp nhận same-origin/same-site/none hoặc header vắng để hỗ trợ client không có Fetch Metadata, đồng thời vẫn thực thi Host/Origin/token.
4. Mỗi lần tạo server sinh token ngẫu nhiên 32 byte, giữ trong closure bộ nhớ. `GET /api/session` trả `{token}` qua cùng boundary và `Cache-Control: no-store`, không cookie, không CORS. Token không nằm trong URL, file, env hay log. Website khác không được đọc token qua same-origin policy; request cross-site hiện đại còn bị Fetch Metadata từ chối.
5. Mutation yêu cầu `X-APM-Token`, so sánh token hợp lệ bằng `timingSafeEqual`, và `Content-Type: application/json` (cho phép tham số charset). Hook chạy trước parse body và handler nghiệp vụ. P02 media upload phải bổ sung thiết kế content type riêng, không gỡ boundary này.
6. Lỗi từ chối dùng 403 với mã `local_access_denied` và thông báo cố định; không echo Host/Origin/token. API 404 cũng không echo URL đầu vào. Không thêm dependency.

## Giới hạn

- Đây là boundary trình duyệt/mạng cho API loopback, không phải xác thực chống một tiến trình độc hại đã chạy dưới cùng tài khoản Windows. Tiến trình cục bộ có thể đọc bootstrap và tự đặt header. XSS trên origin được phép cũng nằm ngoài lớp này.
- Server restart làm token cũ hết hiệu lực. Client giữ token trong bộ nhớ và không tự phát lại mutation bị từ chối: phát lại có thể gây tác vụ trùng khi trạng thái chưa rõ.
- Production hiện chỉ cho origin server; cách phục vụ web production phải cùng origin hoặc được thiết kế lại có kiểm chứng. Chưa hỗ trợ remote access, cookie session, TLS hay phân quyền đa người dùng.
- Test mutation dùng route chỉ tồn tại trong test; P00.8 không tạo API đăng bài hay thao tác Facebook thật.

## Tài liệu tham chiếu

- [Fastify onRequest hooks](https://fastify.dev/docs/latest/Reference/Hooks/): chặn request trước parse body/handler.
- [MDN Sec-Fetch-Site](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Sec-Fetch-Site): ngữ cảnh same-origin/same-site/cross-site/none và forbidden request header.
- [MDN Fetch Metadata](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Fetch_metadata): áp dụng metadata để giảm CSRF và rò rỉ cross-origin.
- [OWASP CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html): kết hợp token, Origin/Fetch Metadata và custom request header.
- [Vite server options](https://vite.dev/config/server-options): dev server loopback/port và reverse proxy cho API.
