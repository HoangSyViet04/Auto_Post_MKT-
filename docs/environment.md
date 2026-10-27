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
