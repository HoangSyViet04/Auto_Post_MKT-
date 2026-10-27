# Môi trường chạy và cấu hình

Cấu hình đọc từ biến môi trường (`packages/config`). `npm run dev:server`, `dev:worker`, `db:migrate` tự nạp file `.env` ở gốc repo nếu có (chép từ `.env.example`). `npm test` nạp `tests/test.env`. Biến đã đặt sẵn trong shell được ưu tiên hơn file. Giá trị rỗng coi như chưa đặt.

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `APM_ENV` | `development` | `development` / `test` / `production`. Mỗi môi trường một DB: `<dataDir>/db/<APM_ENV>.sqlite`. |
| `APM_DATA_DIR` | `%LOCALAPPDATA%\AutoPostMKT`; riêng `test` là `<thư mục tạm>\AutoPostMKT-test` | DB, media, log, browser profiles. Không bao giờ đặt trong repo. |
| `APM_SERVER_PORT` | `4317` | Server chỉ nghe `127.0.0.1`; Vite proxy `/api` dùng cùng cổng. |
| `APM_INTEGRATIONS` | `fake` | `fake`: adapter giả, không gọi Facebook/LLM. `live`: adapter thật — chưa có (P08/P09), worker từ chối chạy. `live` bị cấm khi `APM_ENV=test`. |

## Bảo đảm "mở app không tự đăng Facebook"

- Mặc định ở mọi môi trường là `APM_INTEGRATIONS=fake`; muốn dùng adapter thật phải đặt rõ ràng.
- Chưa có adapter thật thì `live` báo lỗi khi khởi động, không lặng lẽ quay về adapter giả.
- Worker chưa có scheduler (P07): khởi động worker không tạo hay gửi job nào.
- `GET /api/health` trả `integrations`; UI hiện dải "Chế độ mô phỏng" khi là `fake`.
- Adapter giả (`#contracts` → `createFakePublisher`) chạy trong bộ nhớ; test thay `fetch` bằng hàm ném lỗi để chắc chắn không gọi mạng.

Không ghi cookie, token, mật khẩu proxy, API key vào `.env.example`, `tests/test.env` hay bất kỳ file nào trong Git.

## Kiểm tra trước khi commit (P00.7)

```sh
npm run check
```

Lệnh chạy tuần tự `typecheck` → `lint` → `test` → `build:web`, dừng nếu có lỗi. Có thể chạy từng script riêng. PowerShell chặn `npm.ps1` thì dùng `npm.cmd run check`, không cần đổi ExecutionPolicy. Sau khi pull có lockfile thay đổi, chạy `npm ci` trước.

Lint dùng Biome 2.6.3, bao gồm TS/TSX phía Node và web; warning cũng làm thất bại. Typecheck giữ `erasableSyntaxOnly`, không build/transpile server/worker. Test nghiệp vụ hiện chạy offline bằng fake publisher và SQLite tạm; chưa nghiệm thu nghiệp vụ các phần chưa triển khai.

Log qua `#logging`: development dễ đọc, test/production là JSON. Bộ lọc chung che bí mật lồng nhau và toàn bộ headers/body/payload trước đầu ra, kể cả request/Error/child logger. Không dùng `console` hoặc log bí mật trong message tự do. Chi tiết và giới hạn ở [ADR 0003](adr/0003-quality-gate-safe-logging.md).

## Truy cập API cục bộ (P00.8)

- Mở web dev tại **http://127.0.0.1:5173**, API tại **http://127.0.0.1:4317** (hoặc `APM_SERVER_PORT`). Vite dev/preview cố định cổng 5173, strictPort, chỉ nghe loopback và giữ Host qua proxy. Dùng đúng địa chỉ `127.0.0.1`; alias `localhost` không nằm trong allowlist API.
- Server chặn IP không phải loopback, Host/Origin không thuộc exact allowlist, header bảo mật trùng và Fetch Metadata cross-site trước parse body/handler. Không tin forwarded headers và không bật CORS. Development chấp nhận origin server và Vite; test/production chỉ chấp nhận origin server.
- GET health không cần token. Client web `apiFetch` tự lấy `GET /api/session` khi có thao tác thay đổi dữ liệu đầu tiên. Phiên trả token ngẫu nhiên giữ trong bộ nhớ, `Cache-Control: no-store`; không ghi file, env, cookie, localStorage hoặc URL.
- Mutation phải có Origin hợp lệ, `X-APM-Token` và `Content-Type: application/json`. Thiếu/sai nhận 403 `local_access_denied`. CLI cục bộ muốn mutation cũng phải gửi đủ các header này; bootstrap không có Origin vẫn được phép nếu Host/IP đúng. P02 media upload sẽ bổ sung chính sách content type riêng.
- Client không tự phát lại mutation khi mất mạng hoặc bị 403. Sau server restart, thao tác cũ có thể bị từ chối; lần thao tác chủ động sau lấy phiên mới. Kết quả chưa rõ phải kiểm tra trước khi chủ động gửi lại.
- `vite preview` chỉ phục vụ kiểm tra cục bộ với server development. Chưa có cơ chế phục vụ web production; sau này phải cùng origin server hoặc thiết kế lại boundary có kiểm tra.

Lớp này giảm rủi ro CSRF/DNS rebinding từ website khác, không chống tiến trình độc hại chạy dưới cùng tài khoản Windows hoặc XSS trên origin được phép. Xem [ADR 0004](adr/0004-local-api-security.md).

## Công cụ thử offline P01

```sh
npm run spike:offline -- --scenario=unknown --channel=group
```

Phải chọn rõ scenario; không có lựa chọn thì không chạy. Chỉ fake, không network/browser/profile/Graph API. Các kết quả đều gắn `simulated: true`, `realCapability: not_tested`; không dùng làm bằng chứng Facebook thật. Xem [spikes/README.md](../spikes/README.md) và [ma trận khả thi](feasibility.md).
