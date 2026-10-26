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
