# ADR 0002 — SQLite bằng `node:sqlite` tích hợp sẵn, SQL thuần, test bằng `node:test`

- Ngày: 2026-10-26
- Trạng thái: Đã chấp nhận

## Bối cảnh

P00.4 cần một driver SQLite chạy được trên Windows, dùng chung DB cho hai tiến trình (server, worker), có backup trực tuyến (P11.5).
Theo ADR 0001, mã nằm trong OneDrive và hai máy dùng chung `node_modules`, nên module native (như `better-sqlite3`) phụ thuộc ABI Node đang dùng và làm đồng bộ phức tạp hơn.

## Quyết định

1. Dùng `node:sqlite` (`DatabaseSync`) có sẵn trong Node 24. Đã kiểm tra trên máy này: SQLite 3.53.0, không có cảnh báo experimental, có `backup()` và `isTransaction`. Không phải cài dependency.
2. `openDatabase()` luôn đặt `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`, `busy_timeout` (mặc định 5s).
3. Ghi dữ liệu qua `transaction()`, dùng `BEGIN IMMEDIATE` để giành khóa ghi ngay. Hàm bên trong phải đồng bộ.
4. Viết SQL thuần với bảng `STRICT`, chưa dùng ORM/query builder. Sẽ xem xét lại ở P02 nếu repository lặp nhiều.
5. Migration là file `packages/storage/migrations/NNNN_ten.sql`:
   - Phiên bản liên tục từ 1.
   - Checksum sha256 tính sau khi chuẩn hóa CRLF thành LF.
   - Mỗi file chạy trong một transaction và rollback nếu lỗi.
   - Dừng, không động vào DB, nếu file đã chạy bị sửa hoặc DB có phiên bản mới hơn mã nguồn.
   - File migration không được tự chứa BEGIN/COMMIT. `PRAGMA foreign_keys` không đổi được trong transaction, nên migration dựng lại bảng ở P02 phải xử lý riêng.
6. DB mỗi môi trường một file: `%LOCALAPPDATA%\AutoPostMKT\db\<APM_ENV>.sqlite`.
7. Test dùng `node:test` + `node:assert/strict` (`npm test`), không cần dependency. Sẽ cân nhắc thêm công cụ test UI ở P00.7/P00.5 khi cần.

## Bằng chứng

`npm test` đạt 13/13 qua 3 lần chạy liên tiếp, gồm test 4 tiến trình Node cùng nhận 2.000 job bằng `UPDATE ... WHERE status='queued'`: mỗi job được nhận đúng một lần (T04).

## Phương án dự phòng

Nếu `node:sqlite` thiếu tính năng hoặc có lỗi ở bản Node 24 dùng sau này, chuyển sang `better-sqlite3`. API đồng bộ tương tự, nên phạm vi sửa chủ yếu nằm trong `packages/storage/src/db.ts`.
