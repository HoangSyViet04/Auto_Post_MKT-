# Nhật ký làm việc — Auto Post MKT

File bàn giao giữa các lượt/agent. Mỗi việc xong thêm **một mục mới ở cuối file** (mới nhất ở dưới cùng). Agent mới vào: đọc mục cuối cùng trước, rồi `CLAUDE.md`, `plan.md`.

Mẫu một mục:

```markdown
## YYYY-MM-DD HH:MM — Pxx: <tên việc ngắn>

- **Đã làm:** ...
- **Cách làm / file chính:** ...
- **Kiểm tra:** lệnh đã chạy → kết quả thật (đạt/lỗi). Ghi rõ phần chưa chạy hoặc chỉ mô phỏng.
- **Quyết định:** (nếu có, link ADR)
- **Tồn đọng / lưu ý:** ...
- **Tiếp theo:** ...
```

---

## 2026-10-26 22:40 — Tài liệu: rà soát README + plan

- **Đã làm:** Đọc README.md và plan.md, kiểm tra môi trường máy: Node v24.16.0, npm 11.13.0, git 2.54, chưa có pnpm, ổ D trống 84GB.
- **Kết luận:** Kế hoạch dùng được. Các điểm cần lưu ý đã chốt:
  - Chỉ **worker** được điều khiển Playwright. Server gửi lệnh qua DB (bảng `commands`) để không tranh profile.
  - SQLite dùng chung cho hai tiến trình → bật WAL + `busy_timeout` (P00.4).
  - Chromium không hỗ trợ SOCKS5 có user/password → chú ý ở P01.3/P04.1.
  - Fanpage: nếu người dùng là admin cả Meta App và Page, chế độ Development có thể đăng mà không cần App Review → xác nhận ở P01.7.
  - Bảo vệ secrets trên Windows (DPAPI) cần module native hoặc PowerShell → quyết định ở P02.5.
- **Quyết định người dùng:** Giữ dự án trong OneDrive (làm việc trên 2 máy). Chọn package manager tối ưu. `report_daily.md` là nhật ký bàn giao có thời gian.
- **Tiếp theo:** P00.2 + P00.3.

## 2026-10-26 22:53 — P00.2 + P00.3: git, cấu trúc thư mục, khung TypeScript

- **Đã làm:**
  - `git init -b main` (chưa commit).
  - Tạo `.gitignore` (chặn node_modules, dist, DB, log, profiles, media, .env, key, spikes/output), `.gitattributes` (LF; .cmd/.bat/.ps1 dùng CRLF), `.editorconfig`, `.node-version` (24), `.npmrc` (`engine-strict`, `save-exact`), `.env.example`.
  - Cấu trúc: `apps/{server,worker,web}`, `packages/{domain,config,storage(+migrations)}`, `packages/integrations/{contracts,browser,facebook-profile,facebook-group,facebook-page}`, `spikes/`, `scripts/`, `tests/e2e/`, `docs/adr/`.
  - Một `package.json` (npm, không workspaces); alias nội bộ qua `imports`: `#domain`, `#config`, `#storage`, `#contracts`, `#browser`, `#fb-profile`, `#fb-group`, `#fb-page`.
  - `tsconfig.base.json` (strict, `erasableSyntaxOnly`, `allowImportingTsExtensions`, noEmit) + `tsconfig.json` (Node) + `apps/web/tsconfig.json` (DOM, React JSX).
  - Mã đã có: `packages/domain` (`JOB_STATUSES` theo plan 4.2), `packages/config` (`getAppEnv`, `getDataDir` → `%LOCALAPPDATA%\AutoPostMKT` hoặc `APM_DATA_DIR`), server/worker in dòng khởi động, web là trang React tối thiểu (Vite, chỉ 127.0.0.1, cache Vite ngoài OneDrive). Các package khác là stub có ghi chú trách nhiệm/Pxx.
  - Dependencies (khóa chính xác, có `package-lock.json`): typescript 7.0.2, @types/node 24, vite 8.3.5, @vitejs/plugin-react 6.1.2, react/react-dom 19.3.1, @types/react(-dom) 19.3.0.
  - `CLAUDE.md` (hướng dẫn agent), ADR `docs/adr/0001-onedrive-single-package.md`.
- **Quyết định:** ADR 0001. OneDrive đồng bộ nội dung đích của junction/symlink, nên không dùng pnpm và npm workspaces. Dùng npm, một package, chạy TS trực tiếp bằng Node 24 (không build server/worker).
- **Kiểm tra:**
  - `npm run typecheck` → đạt (exit 0).
  - `node apps/server/src/index.ts` → `[server] env=development dataDir=C:\Users\VIET_HS\AppData\Local\AutoPostMKT jobStatuses=10`.
  - `node apps/worker/src/index.ts` → `[worker] env=development jobStatuses=10`.
  - `npm run build:web` → build được `apps/web/dist` (JS 219.86 kB).
  - Thử chèn lỗi cố ý vào domain (sai kiểu + `import 'node:fs'`) → typecheck báo cả hai lỗi, phía web chặn được `node:fs`. Đã gỡ file thử, typecheck sạch lại.
  - `node_modules`: 78MB, 1.055 file, không có symlink/junction.
- **Tồn đọng / lưu ý:**
  - Chưa commit lần đầu (chờ người dùng đồng ý).
  - Chưa có lint/format/test (P00.7), SQLite (P00.4), Fastify + health + 4 mục UI (P00.5), cấu hình dev/test + adapter giả (P00.6), kiểm tra origin/CSRF (P00.8).
  - Máy thứ 2: cài Node 24 cùng dòng rồi chạy `npm ci`; chỉ làm trên một máy tại một thời điểm.
- **Tiếp theo:** P00.4 — chọn và thử SQLite driver trên Windows (better-sqlite3 hoặc `node:sqlite`), bật WAL, migration tối thiểu.

## 2026-10-26 22:55 — Commit lần đầu

- **Đã làm:** `git commit` c543dfa "chore: khởi tạo dự án (P00.1–P00.3)", 35 file.
- **Lưu ý:** Git trên máy này đang ghi tác giả là `HoangSyViet04 <hoangsyviet2k4@gmail.com>`. Nếu muốn dùng email khác, người dùng tự đổi `git config`.

## 2026-10-26 22:59 — P00.4: SQLite driver, WAL, migration tối thiểu

- **Đã làm:**
  - Chọn `node:sqlite` có sẵn trong Node 24 (SQLite 3.53.0), không có dependency và không có module native. Lý do ở ADR 0002.
  - `packages/storage/src/db.ts`:
    - `openDatabase(path, { busyTimeoutMs })` bật WAL, `synchronous=NORMAL`, `foreign_keys=ON`, `busy_timeout=5000` và tự tạo thư mục cha.
    - `transaction(db, fn)` dùng `BEGIN IMMEDIATE`, rollback khi lỗi, chặn hàm async và transaction lồng nhau.
  - `packages/storage/src/migrate.ts`:
    - `loadMigrations()` đọc `packages/storage/migrations/NNNN_ten.sql`, bắt buộc phiên bản liên tục.
    - `defineMigration()` tính checksum sha256 sau khi chuẩn hóa CRLF thành LF.
    - `migrate(db)` dùng bảng `schema_migrations`, mỗi file một transaction. Dừng nếu file đã chạy bị sửa hoặc DB mới hơn mã nguồn.
  - Migration `0001_init.sql`: bảng `app_meta` (STRICT) và dòng `created_at`. Đã xóa file placeholder `README.sql`.
  - `packages/config`: thêm `getDatabasePath()` → `<dataDir>/db/<APM_ENV>.sqlite`.
  - `scripts/db-migrate.ts` và các lệnh npm `db:migrate`, `test` (`node --test "{apps,packages,tests}/**/*.test.ts"`).
  - Test: `packages/storage/src/db.test.ts`, `migrate.test.ts`, và fixture tiến trình con `test-fixtures/claim-loop.ts`.
- **Kiểm tra:**
  - `npm run typecheck` → đạt.
  - `npm test` → 13/13 đạt, chạy lại thêm 3 lần đều 13/13. Gồm:
    - WAL, foreign_keys, busy_timeout được bật.
    - Dữ liệu còn sau khi đóng/mở lại DB.
    - Rollback khi lỗi.
    - Kết nối thứ hai báo bận khi kết nối đầu đang giữ khóa ghi, nhưng vẫn đọc được (WAL).
    - **4 tiến trình Node cùng nhận 2.000 job bằng UPDATE có điều kiện → mỗi job được nhận đúng 1 lần** (T04).
    - Migration chạy lại không áp dụng lần hai; migration lỗi được rollback; checksum lệch và DB mới hơn mã nguồn đều bị từ chối; CRLF/LF cho cùng checksum; thiếu phiên bản hoặc tên file sai báo lỗi.
  - Test dùng thư mục tạm có khoảng trắng và dấu tiếng Việt (`apm dữ liệu …`).
  - `APM_DATA_DIR="<scratchpad>/apm data thử" npm run db:migrate` hai lần → lần 1 "Đã áp dụng: 1", lần 2 "Không có migration mới". Sau khi đóng DB không còn file -wal/-shm.
  - Chưa chạy `db:migrate` vào thư mục dữ liệu thật `%LOCALAPPDATA%\AutoPostMKT` (chưa cần).
- **Quyết định:** ADR 0002 (node:sqlite, SQL thuần, STRICT, node:test).
- **Tồn đọng / lưu ý:**
  - Schema nghiệp vụ thuộc P02.
  - Backup trực tuyến (`node:sqlite` `backup()`) thuộc P11.5, chưa thử.
  - Migration dựng lại bảng có FK cần tắt `foreign_keys` ngoài transaction, sẽ xử lý khi gặp ở P02.
- **Tiếp theo:** P00.5 — Fastify trên 127.0.0.1 với `GET /api/health` (kèm phiên bản DB), UI bốn mục điều hướng; các hành động chưa có ghi "chưa triển khai".

## 2026-10-26 23:07 — P00.5 (đang làm): Fastify health + UI 4 mục — BỊ CHẶN bởi lỗi OneDrive trong node_modules

- **Đã làm (chưa commit):**
  - Cài `fastify@5.12.7`.
  - `apps/server/src/app.ts`: `buildApp({ db, env, logger })` với `GET /api/health` trả `{status, env, schemaVersion, startedAt}`, và 404 dạng JSON. Log Fastify/pino có `redact` cho authorization, cookie, x-apm-token.
  - `apps/server/src/index.ts`: mở DB, chạy migrate, listen `127.0.0.1:${APM_SERVER_PORT|4317}`, đóng gọn khi nhận SIGINT/SIGTERM.
  - `packages/config`: thêm `getServerPort()`.
  - `packages/domain/src/api.ts`: kiểu `HealthResponse`, `ApiError` dùng chung cho server và web.
  - Web:
    - `apps/web/src/nav.ts`: bốn mục điều hướng; "Chức năng đăng bài" và "Quét nhóm" thu gọn/mở ra được.
    - `App.tsx`: điều hướng bằng hash; mỗi trang là khung "Chưa triển khai · Pxx", nút thao tác bị disable.
    - `useHealth.ts`: polling 10 giây.
    - `styles.css`.
    - Vite proxy `/api` → server.
  - Test: `apps/server/src/app.test.ts` (health và 404 qua `inject`).
- **Kiểm tra:**
  - `npm run typecheck` → đạt.
  - `npm test` → 15/15 đạt.
  - Vite dev chạy được ở `127.0.0.1:5173`, chỉ nghe trên loopback.
  - **Server thật KHÔNG chạy được:** `Cannot find module 'pino-std-serializers'`. Test vẫn đạt vì test tắt logger.
- **Nguyên nhân:** OneDrive Files On-Demand. Mọi thư mục trong `node_modules` đều là reparse point của OneDrive (75/75). Riêng `node_modules/pino-std-serializers` có reparse tag hỏng ("The tag present in the reparse point buffer is invalid"): không đọc, không xóa (`Remove-Item`, `rmdir`), không gỡ reparse (`fsutil reparsepoint delete`) và không đổi tên được. Các package khác đọc bình thường.
- **Chưa làm:** không khởi động lại OneDrive, không xóa toàn bộ `node_modules`. Chờ người dùng quyết định.
- **Tiếp theo:** người dùng chọn cách xử lý OneDrive (xem câu hỏi trong phiên), sửa `node_modules`, chạy lại kiểm tra server thật + proxy, rồi commit P00.5.

## 2026-10-26 23:18 — Hạ tầng: chuyển repo ra khỏi OneDrive + hoàn tất P00.5

- **Đã làm:**
  - Người dùng quyết định bỏ OneDrive. Đã chép dự án (gồm `.git` và thay đổi chưa commit, bỏ `node_modules`/`dist`) bằng `robocopy` sang **`D:\Project\Auto_Post_MKT`**: 164 file, 0 lỗi.
  - Chạy `npm ci` sạch ở vị trí mới: `pino-std-serializers` có đủ.
  - Cập nhật ADR 0001 (trạng thái: thay thế một phần), `CLAUDE.md` (quy trình git pull/push đầu và cuối phiên), `plan.md` (P00.5 xong, đường dẫn mới).
  - Thư mục cũ `D:\OneDrive - EDUPIA\Auto_Post_MKT` **vẫn còn, chưa xóa**. Trong đó `node_modules/pino-std-serializers` bị hỏng và agent không xóa được; người dùng tự xóa thư mục cũ sau khi kiểm tra.
- **Kiểm tra (tại D:\Project\Auto_Post_MKT):**
  - `npm run typecheck` → đạt. `npm test` → 15/15 đạt.
  - Server thật (`node apps/server/src/index.ts`, `APM_DATA_DIR` trỏ vào scratchpad):
    - `GET http://127.0.0.1:4317/api/health` → `{"status":"ok","env":"development","schemaVersion":1,...}`.
    - Gọi qua Vite proxy `http://127.0.0.1:5173/api/health` → cùng kết quả.
    - `POST /api/posts` → 404 JSON.
    - `netstat`: 4317 và 5173 chỉ LISTEN trên 127.0.0.1. Trang web trả `<title>Auto Post MKT</title>`.
  - Đã tắt server/Vite sau khi thử, cổng đã giải phóng.
  - Chưa xem giao diện bằng trình duyệt thật (chưa cài Playwright, thuộc P01). Mới kiểm tra build/typecheck và HTML trả về.
- **Tồn đọng:**
  - Chưa có remote GitHub: máy chưa cài `gh`, cần người dùng tạo repo rỗng hoặc cài `gh`.
  - Log pino hiện in JSON thô; định dạng dễ đọc và redact đầy đủ thuộc P00.7.
- **Tiếp theo:** gắn remote GitHub và push; sau đó P00.6 (cấu hình dev/test, adapter giả mặc định).

## 2026-10-26 23:24 — Hạ tầng: gắn GitHub remote và push

- **Đã làm:** `git remote add origin https://github.com/HoangSyViet04/Auto_Post_MKT-.git` (tên repo có dấu "-" ở cuối, do người dùng tạo), rồi `git push -u origin main`. Nhánh `main` theo dõi `origin/main`.
- **Kiểm tra:** push thành công, 3 commit (c543dfa, 7ce8f23, f04e525). Commit này được push ngay sau đó.
- **Máy thứ hai:** `git clone https://github.com/HoangSyViet04/Auto_Post_MKT-.git D:\Project\Auto_Post_MKT` → cài Node 24 → `npm ci` → `npm test`.
- **Tiếp theo:** P00.6 — cấu hình dev/test/local, adapter giả mặc định, không tự đăng Facebook khi mở app.
