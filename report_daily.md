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

## 2026-10-26 23:33 — P00.6: cấu hình dev/test/local, adapter giả mặc định

- **Đã làm:**
  - Đầu phiên: `git pull` (đã mới nhất), `node_modules` có sẵn, lockfile không đổi nên không chạy `npm ci`. `npm run typecheck` đạt, `npm test` 15/15 trước khi sửa.
  - `#domain`: thêm `channels.ts` (`CHANNELS` profile/group/page, `IntegrationMode` fake/live); `HealthResponse` có thêm `integrations`.
  - `#config`: `getIntegrationMode()` đọc `APM_INTEGRATIONS`, mặc định `fake`, `live` bị cấm khi `APM_ENV=test`. `APM_ENV=test` không có `APM_DATA_DIR` thì dùng `<tmpdir>/AutoPostMKT-test`, không đụng `%LOCALAPPDATA%`. Giá trị rỗng coi như chưa đặt.
  - `#contracts`: giao ước `Publisher` bản phác thảo (capabilities/prepare/submit/verify/stop; kết quả published/pending_approval/unknown/failed) và `createFakePublisher()` chạy trong bộ nhớ, có kịch bản kết quả tùy chọn. P02.6 sẽ hoàn thiện cùng schema job và thêm scanner.
  - Worker: `apps/worker/src/publishers.ts` chọn adapter theo chế độ; `live` báo "Chưa có adapter Facebook thật" thay vì lặng lẽ dùng adapter giả. Worker in rõ chế độ và "chưa có scheduler, không tự đăng bài".
  - Server: health trả `integrations`. Web: dải vàng "Chế độ mô phỏng…" và nhãn ở góc health.
  - npm scripts: `dev:server`, `dev:worker`, `db:migrate` thêm `--env-file-if-exists=.env`; `test` thêm `--env-file=tests/test.env` (APM_ENV=test, APM_INTEGRATIONS=fake).
  - Tài liệu: `docs/environment.md` (bảng biến, cách bảo đảm không tự đăng), `.env.example` viết lại đủ biến.
- **Kiểm tra:**
  - `npm run typecheck` → đạt. `npm test` → 27/27 đạt (thêm test config, adapter giả với `fetch` bị thay bằng hàm ném lỗi, worker chọn adapter, spawn tiến trình worker thật ở chế độ mặc định và với `live` trong test).
  - `npm run build:web` → đạt.
  - Chạy thật với `APM_DATA_DIR` ở scratchpad: worker mặc định in `integrations=fake (mô phỏng…)`, exit 0; `APM_INTEGRATIONS=live` → worker lỗi "Chưa có adapter Facebook thật"; server với `APM_ENV=test APM_INTEGRATIONS=live` → lỗi "bị cấm". Server mặc định: `GET /api/health` → `{"status":"ok","env":"development","schemaVersion":1,"integrations":"fake",...}`. `npm run db:migrate` → "Không có migration mới". Tạo `.env` tạm (`APM_ENV=test`) → worker nhận `env=test`, đã xóa file sau đó. Đã tắt server.
  - Chưa xem dải "Chế độ mô phỏng" trên trình duyệt thật (chưa có Playwright, P01); mới kiểm qua typecheck/build.
- **Tồn đọng / lưu ý:**
  - Khi không có `.env`, Node in dòng ".env not found. Continuing without it." — vô hại.
  - Giao ước publisher chỉ là phác thảo; chưa có scanner contract, chưa nối với DB/job (P02.6, P07).
- **Tiếp theo:** P00.7 — typecheck/lint/build và kiểm tra nghiệp vụ; log có lọc bí mật từ đầu (định dạng log dễ đọc, redact đầy đủ).

## 2026-10-26 23:46 — P00.7: cổng kiểm tra và log lọc bí mật

- **Đã làm:**
  - Đọc CLAUDE → nhật ký (kỹ các mục cuối) → plan → README → ADR → môi trường; `git pull` đã mới nhất. Baseline typecheck đạt, test 27/27 đạt.
  - Thêm `npm run lint` (Biome, warning cũng thất bại), `npm run check` chạy tuần tự typecheck → lint → test → build:web. Giữ nguyên Node 24 type stripping, `erasableSyntaxOnly`, alias nội bộ; thêm `#logging`.
  - Logger chung cho Fastify (request/error/child), worker và migration, kể cả lỗi startup. Development dùng pretty; test/production JSON. Lọc tại destination sau serializer/bindings/format args/toJSON, trước khi ghi stdout/pretty; lỗi lọc chỉ ghi thông báo cố định.
  - `redactSecrets`: lọc đệ quy object/array, cookie/token/authorization/password/proxy pass/API key (hoa thường/camel/snake/header), toàn bộ headers/body/rawBody/payload, Error/cause/stack, URL userinfo, query percent-encode, JSON/form/Bearer/Basic, header name-value; không sửa input, xử lý vòng tham chiếu/getter/giới hạn độ sâu.
  - Thêm 7 test (6 logger + 1 Fastify); bổ sung khẳng định verify unknown/pending chỉ đọc, không tự gửi lại. Sửa non-null assertions cũ bằng kiểu tuple nav/guard; chỉ sửa migration runner, không sửa file SQL migration đã có.
  - Cập nhật README, CLAUDE, môi trường, checkbox/bảng tiến độ; ADR 0003 ghi công cụ, dependency, lý do và giới hạn.
- **Cách làm / file chính:** `biome.json`, `package.json`/lockfile; `packages/logging/src/{index,redact,logging.test}.ts`; server/worker/migration entrypoints và test API. Log không tạo file vận hành trong repo.
- **Kiểm tra:**
  - PowerShell chặn `npm.ps1`; dùng `npm.cmd` (không đổi ExecutionPolicy). Lần kiểm tra đầu đã xác nhận 27/27; trong quá trình làm từng gặp lỗi cấu hình Biome, type logger và cách capture pretty, đã sửa rồi chạy lại.
  - `npm.cmd run check` → typecheck đạt cả Node/web; lint 36 file không lỗi/cảnh báo; `npm test` 34/34 đạt; build:web đạt. `git diff --check` sạch.
  - Test kiểm tra đầu ra JSON/pretty thật, Fastify inject query/header/body/nested/Error, child, format args và toJSON không có sentinel bí mật; spawn server/worker/migration với cấu hình lỗi chứa sentinel → exit 1, không lộ sentinel qua stdout/stderr.
  - Probe lint bằng mã sai tạm → chặn đủ noEnum/noNamespace/noParameterProperties/useImportExtensions. Thử stdin ban đầu không xuất đủ diagnostic; đã đổi sang file tạm với import tới file tồn tại, xác nhận rồi xóa probe.
  - Smoke `node _tmp_p007_verify.mjs` → worker development có INFO dễ đọc, fake, exit 0; migration DB tạm phiên bản 1; server thật loopback health HTTP 200/schemaVersion=1/integrations=fake. Đã dừng server, xóa DB tạm và script probe.
  - `npm install` báo audit 0 vulnerabilities (91 package). Chưa xem UI trên trình duyệt, không mở Facebook/đăng thật. Kiểm tra nghiệp vụ chỉ áp dụng phần đã có: config/fake publisher/DB, chưa nghiệm thu P02–P12.
- **Quyết định:** [ADR 0003](docs/adr/0003-quality-gate-safe-logging.md). Khóa chính xác `@biomejs/biome@2.6.3` (dev: lint TS/TSX, parser riêng); `pino@10.4.0` (khai báo trực tiếp vì import trực tiếp, trước có gián tiếp qua Fastify); `pino-pretty@13.2.0` (runtime để development chạy trực tiếp Node có pretty).
- **Tồn đọng / lưu ý:** Filter cố ý che dư từ nhạy cảm và toàn bộ headers/body; không nhận diện được bí mật trần không có tên/ngữ cảnh, không đưa loại dữ liệu này vào message/metadata. `APM_INTEGRATIONS` vẫn mặc định fake. Chưa triển khai log rotation/lưu/xuất nhật ký P11. Commit/push thực hiện ngay sau mục này; kết quả chỉ xác nhận khi git trả thành công.
- **Tiếp theo:** P00.8 — origin/CSRF và cơ chế truy cập cục bộ cho request thay đổi dữ liệu; không bắt đầu Facebook thật trong lượt P00.7.

## 2026-10-27 07:58 — P00.8: bảo vệ API cục bộ và client web

- **Đã làm:** Điều phối 3 subagent theo yêu cầu; hai nhánh server/client hoàn tất P00.8, nhánh khác chuẩn bị tooling offline riêng. P00.1–P00.8 đã hoàn thành.
- **Cách làm / file chính:** `apps/server/src/local-access.ts` root onRequest chặn IP/Host/Origin/Fetch Metadata/header trùng trước parse body/handler; `GET /api/session` cấp token 32byte trong bộ nhớ, no-store; mutation cần Origin đúng + X-APM-Token + JSON. Không trust forwarded headers, không CORS, lỗi403/404 cố định không echo URL/header. `apps/web/src/api.ts` bootstrap lazy/dùng chung promise, chỉ đường dẫn /api cùng origin, không redirect hoặc tự retry mutation, không lưu token ra file/localStorage. Vite dev/preview chỉ127.0.0.1:5173 strictPort, giữHost qua proxy. Root tsconfig kiểm tra thêm test client phía Node.
- **Kiểm tra:**
  - Đầu lượt `git pull` mới nhất; `npm.cmd run check` baseline34/34 đạt.
  - `node --env-file=tests/test.env --test "{apps,packages/config,packages/integrations,packages/logging,packages/storage,tests/e2e}/**/*.test.ts"` → **50/50 đạt** cho baseline + P00.8. Gồm11 server tests,7 client tests,1 kiểm tra request thật server+Vite (các test nền khác vẫn đạt).
  - `npm.cmd run check` tích hợp worktree → typecheck/lint/build đạt;63/63 test đạt (có thêm5 harness offline và8 caption đang được chốt thành phần riêng sau P00.8). `git diff --check` sạch.
  - Request thật qua Vite: health200 fake, bootstrap200/no-store, mutation hợp lệ tới API chưa có trả404, thiếu bảo vệ403, Origin lạ403/không CORS, raw HTTP Host lạ/trùng bị chặn; token thật không xuất trong log. DB/cache test tách thư mục tạm, server/Vite đã dừng và dữ liệu tạm đã xóa.
  - Test ban đầu vướng cache Vite ngoài workspace nên đã chuyển cache vào thư mục tạm riêng; Node fetch chuẩn hóa Host nên kiểm tra Host được đổi sang node:http raw header. Không coi hai lần lỗi thử này là kết quả đạt.
- **Quyết định:** [ADR0004](docs/adr/0004-local-api-security.md), không thêm dependency. Production chỉ origin server; chưa có hosting web production. Bảo vệ này không chống tiến trình độc hại dưới cùng tài khoản Windows hoặc XSS trên origin được phép.
- **Tồn đọng / lưu ý:** Không có API nghiệp vụ mutation mới; route đếm ghi chỉ trong test. P02 upload cần thiết kế content type riêng. Token cũ mất hiệu lực khi restart; client không phát lại thao tác cũ. APM_INTEGRATIONS vẫn fake, không mở Facebook/đăng thật. Commit/push ngay sau mục này, chỉ xác nhận thành công sau kết quả git.
- **Tiếp theo:** P01.1 tooling offline và bảng khả thi; các phần dữ liệu/caption độc lập có thể làm khi chờ đầu vào kiểm chứng thật, không đánh dấu tích hợp thật đạt.

## 2026-10-27 08:06 — P01.1: chuẩn bị công cụ mô phỏng chủ động và ma trận khả thi

- **Đã làm:** Thêm CLI `npm run spike:offline -- --scenario=...` với7 scenario published/pending_approval/unknown/stop/expired/checkpoint/ambiguous_selector, chọn channel profile/group/page. Chỉ chạy fake, từ chối live; thiếu scenario không tạo adapter hay gửi. Không khởi chạy từ app startup, không browser/network/file evidence. Thêm `docs/feasibility.md` liệt kê riêng từng khả năng và đầu vào cần cho thử thật.
- **Cách làm / file chính:** `spikes/run.ts`, `spikes/scenarios.ts`, `spikes/README.md`, `tests/spikes/offline.test.ts`; CLI dùng #logging và reason code cố định, không echo argv/env/error thô. Fixture cảnh báo/selector chỉ là quyết định điều khiển giả, không có detector browser.
- **Kiểm tra:** `node --env-file=tests/test.env --test tests/spikes/offline.test.ts` →5/5 đạt. `npm.cmd run spike:offline -- --scenario=unknown` chạy thật → simulated=true,realCapability=not_tested,submittedCount=1,verified=unknown. Test chặn fetch, CLI mặc định không chạy, live bị từ chối, sentinel bí mật không echo, verify unknown không submit lại, stop/block không submit. Typecheck/lint/build toàn worktree cũng đạt ở cổng kiểm tra tích hợp trước đó.
- **Quyết định:** Không thêm dependency hoặc Playwright khi chưa có phạm vi thử thật; chưa tạo profile hoặc driver Facebook. Giữ P01.1 checkbox mở do công cụ hiện chỉ offline, P01.2–P01.10 chưa nghiệm thu thật.
- **Tồn đọng / lưu ý:** P01 cần tài khoản/đích/phạm vi cụ thể cho lượt thử, proxy nếu dùng và quyền App/Page hợp lệ khi thử Page. Không cần gửi cookie/password vào chat/Git. Kết quả fixture không chứng minh khả thi Facebook. Commit/push ngay sau mục này.
- **Tiếp theo:** Tiếp tục schema/migration và quy tắc caption offline độc lập theo plan; thêm driver thật sau khi có đầu vào thử được chọn rõ.

## 2026-10-27 08:10 — P05.4: chuẩn bị quy tắc caption domain offline

- **Đã làm:** Thêm `generateProductCaption` thuần qua #domain; chỉ dùng tên/tình trạng và optional do người dùng cung cấp, không LLM hoặc network. Optional thiếu/null không có dòng, không tự thêm giá0, pin, nguyên zin, bảo hành hoặc ưu đãi. Tên hiển thị chuẩn hóa khoảng trắng, giữ nội dung/ngắt dòng tình trạng nguồn; input không bị sửa.
- **Cách làm / file chính:** `packages/domain/src/caption.ts`, `caption.test.ts`, export từ index. `CaptionValidationError.field` báo trường sai bằng thông báo cố định không echo dữ liệu; giá/dung lượng nguyên dương, pin0..100 hữu hạn (0 explicit giữ nguyên), bảo hành phải text nếu có.
- **Kiểm tra:** `node --env-file=tests/test.env --test packages/domain/src/caption.test.ts` →8/8 đạt; `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd run build:web` đều exit0. Cổng tích hợp trước đó63/63 đạt. Test T01 và ví dụ dữ liệu thiếu optional xác nhận caption không bịa thông tin.
- **Quyết định:** Không thêm dependency; domain không dùng API Node và dùng được cả web/server. Đây là bước offline độc lập khi P01 thật còn thiếu đầu vào.
- **Tồn đọng / lưu ý:** Chưa có luồng tạo máy với ảnh, media validation, lưu revision, UI xem trước/chỉnh tay hay schedule. Giữ P05.4 checkbox mở; không gọi toàn P05 hoàn tất. Commit/push ngay sau mục này.
- **Tiếp theo:** P02.1–P02.2 schema/migration đang được agent triển khai và agent khác review, sau đó giao ước publisher/scanner P02.6 và nối các luồng offline.

## 2026-10-27 08:20 — P02.1–P02.2: schema offline v2 và kiểm tra nâng cấp/backup/restore

- **Đã làm:** Thêm migration0002 với26 bảng STRICT đủ nhóm dữ liệu mục4: secret reference/proxy/account/identity/profile/destination/Page, product/revision/media/content/approval/revocation, request/job/attempt/observation, lease, scan/preset/activity. Không sửa0001, không seed tài khoản/secret/job, không chạy migration vào DBvận hành.
- **Cách làm / file chính:** `packages/storage/migrations/0002_offline_core.sql`, `schema.test.ts`, `db.ts`/`db.test.ts`/`migrate.test.ts`; health unit/e2e kỳ vọng schemaVersion2. Composite FK buộc account identity–destination–content–Page đúng tuple; media sở hữu/thứ tự, approval snapshot bất biến; jobs qua approval, request-target dedup; send/finish marker write-once, observation append-only có provenance; lease fence không giảm/xóa reset. `openDatabase` bật thêm recursive_triggers để REPLACE cũng phải qua no_delete triggers. Tài liệu `docs/data-model.md`, ADR0005.
- **Kiểm tra:** `node --env-file=tests/test.env --test packages/storage/src/db.test.ts packages/storage/src/migrate.test.ts packages/storage/src/schema.test.ts` →29/29 đạt; reviewer độc lập chạy lại29/29 đạt. `npm.cmd run check` worktree tích hợp →typecheck/lint50file/build đạt,94/94 test đạt (bao gồm contracts chuẩn bị commit riêng). `git diff --check` sạch.
- **Bằng chứng chính:** DBv1 có sentinel trong WAL, node:sqlite.backup online tạo snapshot; nâng DBhiện tại v2 còn sentinel; restore snapshot ra file khác đọc được v1/sentinel rồi upgrade v2. Migration lỗi rollback giữ dữ liệu cũ. Negative tests chặn lệch account/Page/content/destination/media, approval ảnh rỗng/chưa ready/thứ tự hổng, tài khoản active vượt2, xóa/REPLACE mất send marker/observation/request/fence. DO NOTHING vẫn giữ payload cũ và conditional lease UPSERT giữ expiry/fence. Server thật qua Vite báo schemaVersion2, fake.
- **Quyết định:** [ADR0005](docs/adr/0005-offline-data-model.md). Reviewer đã bắt lỗi xóa lịch sử và scan identity mutable, đã sửa. Root chọn recursive_triggersON + native no_delete thay18 preinsert duplicate guards để không phá SQLite DO NOTHING/UPSERT hợp lệ. Tất cả connection phải qua helper; không tự tạo connection bỏ PRAGMA.
- **Tồn đọng / lưu ý:** Chưa repository/claim nghiệp vụ P02.3, MediaStore/path safety P02.4/P02.7, bảo vệ secrets P02.5, fixture dùng lại P02.8 hay scheduler/P06. DB không chứng minh file vật lý/quyền/danh tính Facebook thật. URL-only destination enrichment/merge cần thiết kế P06, không sửa identity lịch sử. Backup/restore test không đồng nghĩa có tính năng restore production P11. Commit/push ngay sau mục này.
- **Tiếp theo:** Chốt P02.6 contract/fake publisher/scanner, sau đó P02.3 repository/transaction và P02.4 media; P01 thật còn chờ tài khoản/đích/phạm vi được chọn.
