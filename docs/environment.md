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

## Schema DB v2 — nền offline P02

`db:migrate` hoặc server startup áp dụng migration0002 qua migration runner có checksum; không cần xóa DBv1. Không sửa file migration đã áp dụng. DBv2 không tự tạo tài khoản, secrets hay job thử. Xem [mô hình dữ liệu](data-model.md) và [ADR0005](adr/0005-offline-data-model.md).

Mọi connection phải dùng `#storage.openDatabase`: WAL, foreign_keys và recursive_triggers đều bật; không tắt hai PRAGMA trong repository/migration. Recursive triggers bảo đảm SQLite REPLACE không xóa qua các ràng buộc giữ lịch sử. Các snapshot được duyệt không sửa tại chỗ; tạo phiên bản mới. Test đã backup/restore vào DBtạm riêng, chưa có công cụ phục hồi DBvận hành hoặc UI P11.

Test tích hợp web hiện cần cổng5173 trống, mở server/Vite riêng với dữ liệu/cache tạm rồi tự đóng. Không chạy đồng thời một Vite dev khác trên5173 khi gọi `npm test`.

## Publisher/scanner fake (P02.6)

`#contracts` cung cấp `createFakePublisher`/`createFakeScanner`, chỉ bộ nhớ và luôn gắn nguồn mô phỏng. Consumer scheduler/live tương lai phải dùng `ApprovedPublishRequest` qua runtime validator; request cũ thiếu context chỉ phục vụ fixture fake. TCN/Page phải đúng identity đích. Verify sai snapshot trả unknown, không cấp quyền retry; stop không thu hồi bài đã gửi.

Scanner phân biệt joined/keyword, giới hạn1..1000 kết quả, nguồn/thời điểm/account, trạng thái unknown/partial và stop. Không suy đã tham gia/quyền đăng/không kiểm duyệt từ kết quả tìm kiếm. Chưa nối DB hoặc UI, chưa có driver thật; xem [ADR0006](adr/0006-integration-contracts.md).

## MediaStore (P02.4)

Sau pull lockfile mới, chạy `npm ci` để cài `sharp@0.35.5` và binary phù hợp máy. Thư viện `#storage.createMediaStore` dùng dataDir cấu hình, lưu file trong `media/staging` và `media/objects` ngoài repo. Nhập JPEG/PNG/WebP tĩnh, mặc định20MiB/25MP, giữ nguyên bytes và SHA256. Chưa có màn hình/upload API hoặc thumbnail.

Caller nội bộ dùng `importFile(pathĐãChọn)` lấy media ID; trước sử dụng gọi `resolveForPublish(idsTheoThứTự)`. Không nhận đường dẫn hệ thống tùy ý từ web, không tự bỏ qua ảnh lỗi. Mất/hỏng file chuyển missing/failed và chặn thao tác. Crash có thể còn staging/orphan không được coi ready; chưa tự quét/dọn khi có tiến trình khác có thể đang import. Xem [ADR0008](adr/0008-managed-media-store.md).

## Kho secrets Windows (P02.5)

`#storage.createSecretStore` dùng DPAPI CurrentUser và ACL riêng cho `<dataDir>/secrets` (user hiện tại + SYSTEM). Không có file khóa cạnh ciphertext; DB chỉ giữ reference. Không gọi get từ HTTP hoặc log giá trị trả về. Nếu nhận `secret_lost`, người dùng cần kết nối lại; sao chép ciphertext sang máy khác không bảo đảm giải mã được. Thu hồi secret đánh dấu revoked và xóa file mã hóa.

Helper chỉ chạy trên Windows, không thay đổi ExecutionPolicy/ACL thư mục cha. Test DPAPI/ACL thật cần quyền Windows user bình thường; sandbox hạn chế ACL có thể chặn, khi đó phải chạy đúng test đó ngoài sandbox và ghi kết quả thật. Xem [ADR0009](adr/0009-windows-dpapi-secrets.md).

## API nền P02.7

| Method/path | Đầu vào/kết quả |
| --- | --- |
| POST /api/media | Raw bytes JPEG/PNG/WebP, Content-Type tương ứng, tối đa20MiB; trả id/mimeType/byteSize/hash/state |
| GET /api/media/:id | UUID hợp lệ, verify file; trả ảnh với nosniff/no-store; không nhận filesystem path |
| POST /api/products | JSON name/condition/mediaIds và optional facts; kiểm ảnh vật lý trước lưu product/revision |
| GET /api/products?page=1&pageSize=20 | Page1..1triệu, pageSize1..100; trả items/total/page/pageSize, không path/secrets |

Mutation vẫn cần Origin đúng + X-APM-Token; chỉ POST/media được dùng image Content-Type thay JSON. apiFetch hỗ trợ ngoại lệ này. Sai schema/field dư/payload lớn bị chặn; không echo payload trong lỗi. Chưa có UI, delete file API hoặc endpoint đọc plaintext secrets. Xem [ADR0010](adr/0010-data-api-validation.md).
