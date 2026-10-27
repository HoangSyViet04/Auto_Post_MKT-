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

## 2026-10-27 08:23 — P02.6: giao ước publisher/scanner và adapter giả

- **Đã làm:** Hoàn thiện lõi contract/fake P02.6. Publisher có readonly approved context, runtime validator, reason codes, evidence source/time và stop result phân biệt dừng lượt sau với thu hồi bài từ xa. Request legacy chỉ cho fixture fake; scheduler/live tương lai phải qua approved boundary. Fake snapshot copy/freeze, verify đối chiếu job/đích/caption/media/context, mismatch trả unknown; không retry.
- **Cách làm / file chính:** `packages/integrations/contracts/src/{publisher,fake,scanner,fake-scanner}.ts` và tests/index; [ADR0006](docs/adr/0006-integration-contracts.md). Scanner joined/keyword giữ account/expected identity/scope/source/observedAt, unknown membership/quyền/duyệt bài, limit1..1000, partial/stop. Không suy quyền từ mode; account khác bị từ chối; fake luôn source simulated kể cả fixture cố gán nguồn thật. Stop không xóa kết quả cũ, không claim recall.
- **Kiểm tra:** `node --env-file=tests/test.env --test "packages/integrations/contracts/src/*.test.ts" "apps/worker/src/*.test.ts" tests/spikes/offline.test.ts` →27/27 đạt, trong đó18 contract tests. `npm.cmd run check` sau tích hợp schema/contract →typecheck đạt, lint50file sạch,94/94 test đạt, build:web đạt; `git diff --check` sạch.
- **Review/fix:** Root yêu cầu TCN/Page remoteId đích trùng expected identity (group được khác), freeze capabilities không thể đổi nhãn simulated, runtime reject scanner status/reasonCode ngoài enum. Đã thêm test và chạy lại đạt. Test chặn fetch, kiểm unknown/pending không tự gửi lại, callback lỗi lúc submit thành unknown, stop giữ kết quả, sai snapshot không xác nhận published, giới hạn/kết quả một phần/account isolation không gây suy membership.
- **Quyết định:** Không thêm dependency; không driver/network/DB side effect. Completed/scopeComplete chỉ phạm vi request mô phỏng, không có nghĩa đọc đủ nhóm Facebook. Không coi not_found là giấy phép gửi lại. Schema source và contract source sẽ được ánh xạ tại repository/adapter boundary, không tự lưu evidence bằng TypeScript types.
- **Tồn đọng / lưu ý:** Chưa DB wiring/claim/transactionP02.3, chuẩn hóa/lưu/dedup/UIscanP06, schedulerP07 hoặc identity/permission/selector/API thậtP01/P08/P09. P02 còn các mụcP02.3/P02.4/P02.5/P02.7/P02.8; P01 thật/P05UI vẫn chưa hoàn tất. Tất cả APM_INTEGRATIONS mặc địnhfake; không mở Facebook/đăng thật. Commit/push ngay sau mục này.
- **Tiếp theo:** P02.3 repository/transaction và P02.4 MediaStore, tiếp đó secrets/validation/fixtures trước khi nối luồng nhập máy/soạn bài offline. P01 thật cần tài khoản/đích/phạm vi được chọn rõ, không gửi bí mật vào chat/Git.

## 2026-10-27 08:41 — P02.3: repository phiên bản, nhận job và trạng thái an toàn

- **Đã làm:** Tự triển khai theo yêu cầu mới, không dùng subagent. Thêm BusinessError dùng chung; repository product/revision/content/approval và job trên schema v2, không thêm dependency hoặc sửa migration.
- **Cách làm / file chính:** `packages/domain/src/business-error.ts`; `packages/storage/src/{repository-common,content-repository,job-repository}.ts`, export qua #storage. Product sửa tạo revision mới/CAS expected revision, giữ media order và dữ kiện gốc; optional thiếu/rỗng là NULL. Cho lưu nháp chưa chọn đích nhưng không approve nó thành job. Sửa nguồn/sold/archived và revocation/invalidate/stop job cùng transaction.
- **Job:** Batch canonical fingerprint + request key trả job cũ khi replay, conflict khi payload khác, rollback toàn batch khi một đích lỗi. Claim queued đến hạn đúng mode bằng UPDATE có điều kiện + attempt trong BEGIN IMMEDIATE; receipt kiểm job/worker/generation/attempt/expiry. Tái kiểm readiness DB khi approve/enqueue/claim và trước marker. Marker commit trước side effect; finish ghi observation/attempt/job cùng transaction, kiểm source/mode. Recovery trước gửi thành paused, sau gửi unknown; không auto requeue. Pending/unknown/published không có đường đổi queued. Sold/stop sau marker vẫn lưu kết quả thật, không giả thu hồi bài.
- **Kiểm tra:** Đầu phiên git pull mới nhất và baseline `npm.cmd run check`94/94 đạt. Sau triển khai `npm.cmd run check` →typecheck Node/web đạt, lint57file sạch, **113/113 test đạt**, build:web đạt. `git diff --check` sạch; diff migration rỗng. Trong lúc làm gặp2 lỗi lint forEach return và đã sửa; targeted suite ban đầu15/15, mở rộng19test trước cổng tổng.
- **Bằng chứng:** `repository.test.ts` thêm19test gồm rollback/version/nháp/optional, idempotency/batch/multi-target, identity/media/permission đổi sau enqueue, source/mode, stop/sold trước/sau marker, expiry/receipt generation. Luồng DBsnapshot→approved contract→fake publisher→DBobservation giữ caption/ảnh/đích và nguồnfake. **3 tiến trình Node thật** cùng gọi repository trên SQLite nhận60job: mỗi job đúng1claim, attempt/observation/status còn khi mở lại DB. Các media/path/identity là fixture giả; không có file ảnh hoặc Facebook thật trong thử này.
- **Quyết định:** [ADR0007](docs/adr/0007-publishing-repositories.md). Đây là thao tác DB đồng bộ, không giữ transaction qua network/file/browser. Lỗi nghiệp vụ có code/message cố định, không echo raw payload/DBconstraint; reason code có allowlist. Giới hạn batch/media100 và claim lease tối đa5phút là bound kỹ thuật nội bộ, không phải giới hạn Facebook.
- **Tồn đọng / lưu ý:** Chưa nối API/UI/scheduler, heartbeat hay resource lease/profile mutex P03/P07. Claim hai job khác nhau cùng account chưa khóa browser; worker thật phải bổ sung khóa trước mở phiên/gửi. Media ready/secret available chỉ metadata, chưa kiểm file/thực giải mã hoặc quyền/danh tính phiên thật. Chưa reconciliation P11 hoặc retry unknown. Không seed/chạm DBvận hành, không mở Facebook/đăng bài, mặc địnhfake giữ nguyên. Commit/push thực hiện ngay sau mục này.
- **Tiếp theo:** P02.4 MediaStore (chép qua vùng tạm, kiểm byte/hash/file, hoàn tất metadata an toàn), rồi P02.5/P02.7/P02.8 trước khi nối nhập máy/soạn bài offline.

## 2026-10-27 08:55 — P02.4: MediaStore và kiểm tra luồng chính

- **Đã làm:** Tự triển khai, không subagent. MediaStore chép nguồn qua staging UUID, kiểm magic/metadata và giải mã pixel thật, SHA256/MIME/size, commit staging→rename→ready. Giữ nguyên nguồn/bytes, không dùng tên/đuôi gốc trong kho. Lỗi giữa chừng chuyển failed và dọn file riêng; verify missing/hash mismatch chuyển missing/failed. Resolve nhiều ảnh giữ thứ tự và chặn cả batch nếu một ảnh lỗi, không âm thầm bỏ ảnh.
- **Cách làm / file chính:** `packages/storage/src/media-store.ts`/`media-store.test.ts`, export #storage, BusinessError mã media cố định. Kho tại dataDir/media ngoài repo, path UUID và kiểm symlink/regular file; mặc định20MiB/25MP, JPEG/PNG/WebP một frame. Không sửa migration hoặc DBvận hành.
- **Dependency/quyết định:** `sharp@0.35.5` exact runtime để kiểm ảnh bằng decoder thật, không viết parser riêng; tương thích Node24 đã chạy trên Windows. `npm install` audit0vulnerabilities/94packages. [ADR0008](docs/adr/0008-managed-media-store.md). Máy khác pull xong chạy npm ci.
- **Kiểm tra (giữ gọn theo yêu cầu mới):** Chỉ thêm4test nhóm luồng chính, không thêm bộ test lặp. `npm.cmd run check` chạy1lần: typecheck/lint59file đạt; **115/117test đạt**,2test mới sai phân loại mã lỗi, build chưa chạy do test dừng. Sharp ném pixel-limit trước khi đọc kích thước nên đã tách metadata/pixel validation để trả media_too_large đúng; assertion lỗi DBfinalize sửa theo mã conflict chuẩn của helper. Sau sửa chỉ chạy lại `node --env-file=tests/test.env --test packages/storage/src/media-store.test.ts` → **4/4đạt**, typecheck và lint3file sửa đạt, `npm.cmd run build:web` đạt. **Không chạy lại full suite**;113test cũ đã đạt trong lượt tổng trước đó, không ghi nhận sai rằng lượt tổng117/117đã chạy sạch.
- **Bằng chứng:** Ảnh2x2 JPEG/PNG/WebP thật nhập từ file.dat vẫn nhận đúng MIME, bytes/hash không đổi, xóa nguồn vẫn đọc được bản kho và tạo product bằng ID. File giả/cắt hỏng/giới hạn bị chặn. Trigger test gây lỗi sau rename/trước ready →failed, kho/staging trống, nguồn còn. Ảnh kho mất/hỏng →missing/failed, resolve batch và product không coi ảnh đó hợp lệ. Tất cả file/DBtạm đã dọn; không dùng ảnh thật hoặc mở Facebook.
- **Tồn đọng / lưu ý:** Đây là thư viện nội bộ, chưa UI/upload API/thumbnail. Worker tương lai phải gọi resolveForPublish trước gửi; chưa nối scheduler. Mất điện/tắt tiến trình có thể còn staging/orphan không được coi ready; chưa tự quét/xóa vì cần điều phối import giữa tiến trình. ACL/secretsWindowsP02.5 và APIvalidationP02.7 còn riêng. Commit/push ngay sau mục này.
- **Tiếp theo:** P02.5 bảo vệ secrets Windows, sau đó P02.7/P02.8 và nối luồng nhập máy/soạn bài offline. Giữ APM_INTEGRATIONS mặc địnhfake.

## 2026-10-27 09:13 — P02.5: DPAPI và ACL kho secrets Windows

- **Đã làm:** Tự triển khai, không subagent. `createSecretStore` put/get/revoke, DPAPI CurrentUser + context UUID, ciphertext riêng ngoài repo; DB chỉ secret reference/status. Missing/corrupt/decrypt failure chuyển lost và báo cần kết nối lại, không fallback plaintext. Không thêm dependency hoặc sửa migration.
- **Cách làm / file chính:** `packages/storage/src/secret-store.ts`, `windows-secrets.ps1`, test và BusinessError. Script cố định qua EncodedCommand, payload qua stdin JSON/base64 UTF8, không secret argv/file tạm; child ẩn/timeout/output bound/lỗi cố định. ACL chỉ `<dataDir>/secrets`: user hiện tại + SYSTEM, tắt kế thừa; không đổi ACL cha hoặc ExecutionPolicy toàn máy. Không có key file cạnh ciphertext hay thay đổi cấu hình hệ thống cần backup.
- **Kiểm tra:** Typecheck toàn repo và lint2file mới đạt. Hai test ban đầu trong sandbox bị chặn thao tác ACL; chạy lại đúng `node --env-file=tests/test.env --test packages/storage/src/secret-store.test.ts` ngoài sandbox → **2/2đạt** trên Windows thật. Kiểm Unicode round-trip, disk/DB không plaintext/base64 plaintext, ACL helper read-back, revoke, ciphertext hỏng/file mất →lost. Không lặp full suite ở bước này; cổng tổng sẽ chạy cuối3mục.
- **Quyết định:** [ADR0009](docs/adr/0009-windows-dpapi-secrets.md). Khóa do Windows quản lý theo CurrentUser; chuyển máy/tài khoản hoặc không giải mã được cần kết nối lại. Không khẳng định đã thử đổi Windows user/máy thật; failure test dùng hỏng/mất file. Thêm UTF8 console encoding cho đường dẫn Unicode; cổng tổng cuối lượt kiểm tra lại cùng2case.
- **Tồn đọng / lưu ý:** Chưa có UI/HTTP quản lý kết nối hoặc profile browser ACL. get plaintext chỉ nội bộ consumer, không đưa vào log/caption/LLM. Test chỉ secrets giả và thư mục tạm, không chạm kho vận hành. Commit/push ngay sau mục này.
- **Tiếp theo:** P02.7 validation/pagination/upload/path guard; P02.8 runner/fixtures tách dữ liệu vận hành.

## 2026-10-27 09:20 — P02.7: validation, phân trang và API ảnh bằng ID

- **Đã làm:** API POST/media nhận bytes bounded qua MediaStore, GET/media/:id UUID+verify/nosniff/no-store, POST/products strict facts/mediaIDs + physical verify, GET/products pagination. Không endpoint nhận sourcepath hoặc xóa file; DTO không đường dẫn/storage key/secrets. Error handler dùng mã cố định, không echo raw schema/JSON/exception.
- **Cách làm / file chính:** `apps/server/src/data-api.ts`, app.ts, local-access.ts; MediaStore importBytes qua staging, content repository listProducts SQLtham số hóa; web apiFetch giữ image MIME chỉ POST/media. Chỉ nới Content-Type đúng endpointupload; Host/Origin/token/Fetch Metadata giữ nguyên, không CORS. Không dependency/migration mới.
- **Kiểm tra:** Chỉ thêm3test API chính: upload→read→product→pagination→missing, schema/body limit, CSRF/path/JSONpath không truy cập ngoài. Targeted `node --env-file=tests/test.env --test apps/server/src/data-api.test.ts` → **3/3đạt**, lint6file đạt. Typecheck ban đầu báo errorhandler unknown, đã narrow an toàn và chạy lại typecheck đạt. Thêm1client binary transport test, sẽ chạy cùng cổng tổng cuối P02.8; không lặp full suite ở bước này.
- **Quyết định:** [ADR0010](docs/adr/0010-data-api-validation.md), bổ sung note ADR0004. Raw upload tránh thêm multipart parser, 20MiB technical bound; pageSize1..100. Chưa API edit/delete hoặc UI/thumbnail; không tự retry upload khi mạng lỗi.
- **Tồn đọng / lưu ý:** Đây là backend nền, chưa hoàn tất P05 UI. Không endpointsecret reveal/đăng Facebook, chế độ fake giữ nguyên. Test dữ liệu ảnh/DBtạm. Commit/push ngay sau mục này.
- **Tiếp theo:** P02.8 ép test env/fake, thư mục DB/media tạm và fixture dùng lại; chạy cổng tổng một lần cuối3mục.

## 2026-10-27 09:32 — P02.8: runner test an toàn và fixture dùng lại

- **Đã làm:** Chốt P02.8 (phần code do agent trước viết, người dùng đã chạy cổng tổng). Runner `npm test` đi qua `scripts/test.ts`: ép `APM_ENV=test`, `APM_INTEGRATIONS=fake`, `APM_DATA_DIR` là thư mục tạm riêng cho mỗi lần chạy (xóa sau khi xong), kể cả khi shell đang đặt production/live/dữ liệu thật. Thêm `#test-support` (`tests/helpers`: `createTestWorkspace` DB+media riêng từng workspace, `seedOfflineScenario`) và `tests/fixtures`; fixture không tự seed, không chạy ở production. Chuyển fixture publishing cũ ra khỏi `packages/storage`.
- **Cách làm / file chính:** `scripts/test.ts`, `package.json` (script `test`, alias `#test-support`), `tests/helpers/{index,workspace}.ts`, `tests/fixtures/*`, `tests/runner-safety.test.ts`; sửa `data-api.test.ts`, `repository.test.ts`, `secret-store.test.ts` dùng helper chung.
- **Kiểm tra:**
  - Người dùng báo đã chạy cổng tổng: **125/125 test đạt**, gồm DPAPI thật với đường dẫn Unicode; typecheck/lint sạch. Tôi **không** chạy lại 125 test này.
  - Lượt này tôi chạy: `npm.cmd run typecheck` → đạt; `npm.cmd run lint` → 69 file sạch.
  - `npm.cmd run build:web` → **lỗi** `EPERM` khi `vite:prepare-out-dir` xóa `apps/web/dist/assets`. Nguyên nhân: file trong `dist` do tài khoản sandbox của Codex tạo, tài khoản hiện tại không xóa được (`Remove-Item`, cấp quyền bằng `icacls` đều bị từ chối; không leo thang quyền quản trị). Code build vẫn đúng: `vite build --outDir <thư mục tạm>` → đạt (JS 226.19 kB).
- **Quyết định:** không đổi ACL hệ thống. `dist` đã nằm trong `.gitignore`.
- **Tồn đọng / lưu ý:** `apps/web/dist` cần được xóa bằng quyền quản trị (hoặc takeown) một lần; sau đó `npm run build:web` chạy bình thường. Mục P02 còn lại không có việc mở: P02.1–P02.8 xong ở phạm vi offline, tích hợp Facebook thật vẫn chưa kiểm chứng.
- **Tiếp theo:** phần độc lập khi chờ đầu vào P01 thật: P03 (quản lý tài khoản, offline) hoặc P05 (nhập máy/soạn bài). P01 thật cần tài khoản/đích/phạm vi do người dùng chọn.

## 2026-10-27 09:42 — P05.1–P05.4: trang Quản lý máy (nhập máy, ảnh, caption mẫu)

- **Đã làm:** Đọc báo cáo trước khi làm (P02.8 đã chốt ở lượt trước). Làm UI nhập máy trên backend P02 có sẵn, chưa đụng Facebook/LLM.
  - Backend: `getProduct` (kèm ID ảnh theo thứ tự), `listProducts` thêm `firstMediaId`; API `GET/PUT /api/products/:id` (sửa = revision mới, `expectedRevisionId` cũ → 409), `POST /api/products/:id/status` (selling/sold/archived), `GET /api/media/:id?size=thumb` (sharp, 320px JPEG, tạo theo yêu cầu, không lưu thêm file). Schema Fastify dùng chung cho POST/PUT.
  - Domain: `generateProductCaption` nhận thêm `capacityText/batteryText/locationText` (chỉ dùng khi không có số cùng loại; trống thì bỏ dòng); kiểu API `ProductFacts/ProductDetail/ProductListResponse`.
  - Web: `apps/web/src/ProductsPage.tsx` (danh sách có thumbnail/phân trang, form thêm/sửa, ảnh ↑/↓/Bỏ, nút đã bán/ngừng bán/bán lại, xem trước caption và chỉnh tay), `product-form.ts` (validate, parse giá, caption, đổi thứ tự — thuần, có test), trang con "Quản lý máy" trong mục Chức năng đăng bài.
- **Kiểm tra:**
  - `npm.cmd run check`: typecheck đạt, lint 72 file sạch, **133/133 test đạt** (thêm 1 test API luồng P05, 3 test caption, 4 test form). `build:web` trong `check` vẫn lỗi EPERM do thư mục `apps/web/dist` cũ (xem mục P02.8); `vite build --outDir <tạm>` → đạt.
  - Chạy thật (dữ liệu tạm ở scratchpad, server + Vite, `APM_INTEGRATIONS=fake`): qua proxy 5173 tạo máy, sửa đổi thứ tự ảnh (200), sửa với revision cũ → 409, thumbnail trả image/jpeg. Edge headless điều khiển qua DevTools: bấm "Thêm máy" → lưu trống báo đủ 3 lỗi; chọn 2 ảnh PNG + 1 file .txt → 2 ảnh vào, .txt bị từ chối; đổi thứ tự ảnh; giá "9tr" bị từ chối nhưng tên/tình trạng được giữ; sửa giá → caption "Samsung S23 / Tình trạng… / Giá: 8.200.000 đ / Dung lượng: 256GB" không có dòng pin/bảo hành; lưu → danh sách có máy mới. Đã xem ảnh chụp danh sách và form. Đã tắt server/Vite.
  - Chưa thử: sửa máy trên UI (mới thử qua API), đổi trạng thái trên UI, phân trang >20 máy, trình duyệt khác Edge.
- **Quyết định:** không thêm dependency, không migration. Thumbnail tạo theo yêu cầu thay vì lưu file (đủ cho quy mô hai tài khoản; đổi sang cache nếu chậm). PUT là thay toàn bộ dữ kiện: trường tùy chọn không gửi sẽ thành null.
- **Tồn đọng / lưu ý:**
  - Caption chỉnh tay chưa được lưu và chưa gắn phiên bản/duyệt → P05.5. Mục này chưa được coi là có "phiên bản đã duyệt".
  - Ảnh tải lên mà người dùng bỏ form vẫn nằm trong kho (không gắn máy nào); dọn ảnh mồ côi thuộc P05.8.
  - Danh sách chưa có tìm kiếm/lọc theo trạng thái.
  - `apps/web/dist` vẫn cần xóa bằng quyền quản trị.
- **Tiếp theo:** P05.5 (lưu phiên bản caption/ảnh có thứ tự, duyệt gắn đúng phiên bản; cần API content-versions), rồi P05.7 và P05.8.

## 2026-10-27 09:48 — P05.5/P05.6 (một phần): lưu bản caption và cảnh báo giống nội dung

- **Đã làm:**
  - Backend: `listVersions` (repository), `POST/GET /api/products/:id/content-versions`. Bản caption luôn lấy ảnh theo thứ tự của đúng phiên bản máy hiện tại; chưa gắn đích. Phiên bản máy cũ → 409, máy đã bán/ngừng bán → 409, caption trống hoặc nguồn `llm` → 400.
  - Domain: `captionSimilarity`/`findSimilarCaptions` (so khớp từ, bỏ dấu/hoa thường/dấu câu, ngưỡng 80%, chỉ cảnh báo không chặn).
  - Web: nút "Lưu caption này" (chỉ bật khi form khớp phiên bản máy đã lưu — `isDirty`), danh sách bản đã lưu (đánh dấu bản của phiên bản cũ), cảnh báo giống nội dung theo thời gian thực.
- **Kiểm tra (theo yêu cầu: chỉ test phần mới, cổng tổng để cuối phase):**
  - `node scripts/test.ts apps/server/src/data-api.test.ts apps/web/src/product-form.test.ts` → 10/10 đạt (có test mới P05.5 và `isDirty`).
  - `node scripts/test.ts packages/domain/src/similarity.test.ts` → 2/2 đạt.
  - `npm.cmd run typecheck` và `npm.cmd run lint` (74 file) → đạt. **Không** chạy full suite/build lượt này.
  - Chạy thật (server + Vite + Edge headless, dữ liệu tạm): mở máy có sẵn, bấm "Lưu caption này" hai lần → 2 bản trong danh sách, cảnh báo "Giống 100%… Vẫn lưu được". Đã tắt server/Vite.
  - Chưa thử trên UI: lưu bản chỉnh tay, bản của phiên bản máy cũ hiển thị nhãn "cũ".
- **Quyết định:** không dependency/migration. `source` do client gửi (template nếu caption bằng caption mẫu, ngược lại manual); server không tự kiểm chứng vì chỉ phục vụ nhãn hiển thị.
- **Tồn đọng / lưu ý:** P05.5 chưa đóng vì chưa có duyệt (cần tài khoản/đích P03/P06); P05.6 chưa có phiên bản theo đích. Hai mục này mở lại khi có đích. `apps/web/dist` vẫn cần xóa bằng quyền admin.
- **Tiếp theo:** P05.8 (xóa ảnh an toàn/dọn ảnh mồ côi, ưu tiên ẩn thay vì mất bằng chứng), P05.7 (hiển thị bài/lịch cần kiểm tra khi máy sửa sau duyệt — phụ thuộc job, có thể chỉ làm phần repository đã có). Sau đó chạy cổng tổng một lần khi hết phase P05 offline.

## 2026-10-27 09:54 — P05.8 và cổng tổng cuối phase P05 (offline)

- **Đã làm:**
  - `createMediaStore().purgeUnreferenced(minAgeMs=24h)`: ảnh chưa gắn phiên bản máy hay bản caption nào (kể cả bản cũ) và đã tải lên đủ lâu thì được giải phóng file. Đổi `state` sang `missing` bằng câu lệnh có kiểm tra "không tham chiếu" **trước**, rồi mới xóa file, nên máy tạo đồng thời không thể trỏ vào file đã mất. Dòng media được giữ vì bảng có trigger cấm xóa (không cần migration).
  - `POST /api/media/cleanup` (ngưỡng cố định, không nhận ID/đường dẫn) và nút "Dọn ảnh chưa dùng" ở danh sách máy. UI không có thao tác xóa ảnh khỏi kho: "Bỏ" chỉ gỡ khỏi phiên bản máy mới.
- **Kiểm tra:**
  - Theo yêu cầu, chỉ test phần mới: `node scripts/test.ts packages/storage/src/media-store.test.ts` → 5/5 đạt (test mới: quá mới không dọn; ảnh gắn máy và ảnh chỉ còn ở bản cũ được giữ; ảnh mồ côi mất file → `media_missing`; chạy lại không đổi; tạo máy với ảnh đã dọn bị từ chối). `node scripts/test.ts apps/server/src/data-api.test.ts` → 6/6 đạt (thêm test cleanup: thiếu token 403, ảnh mới không bị dọn).
  - **Cổng tổng một lần ở cuối phase:** `npm.cmd test` → **139/139 đạt**; `npm.cmd run lint` (74 file) sạch; typecheck không báo lỗi; `vite build --outDir <tạm>` đạt. `npm run build:web` mặc định vẫn vướng `apps/web/dist` cũ (xem mục P02.8).
  - Chưa thử nút "Dọn ảnh chưa dùng" trên UI thật; chưa thử dọn ảnh đã quá 24 giờ trên DB thật (test dùng ngưỡng 0).
- **Quyết định:** không migration, không dependency. Chọn "giải phóng file + giữ dòng" thay vì thêm trạng thái `archived` cho media (cần dựng lại bảng, ADR 0002).
- **Tồn đọng / lưu ý:** P05.5 (duyệt), P05.6 (bản theo đích), P05.7 (UI bài/lịch cần kiểm tra) mở vì phụ thuộc tài khoản/đích/lịch. File `.part` mồ côi trong `media/staging` sau crash vẫn chưa được quét. `apps/web/dist` vẫn cần xóa bằng quyền admin.
- **Tiếp theo:** các phần còn làm được không cần Facebook thật: P03.1–P03.2 (bảng tài khoản, thêm/sửa/gỡ, giới hạn hai tài khoản) và P04.1 (form proxy, mật khẩu qua DPAPI) — hai phần này mở khóa duyệt/đích cho P05. P01 thật vẫn chờ người dùng chọn tài khoản/đích/phạm vi.

## 2026-10-27 10:01 — P03 (offline, một phần): trang Quản lý tài khoản

- **Đã làm:**
  - `createAccountRepository` (`packages/storage/src/account-repository.ts`): `list/get/create/rename/setPaused/setAllPaused/remove`. Tối đa hai tài khoản đang dùng (mã lỗi mới `account_limit`); mỗi tài khoản tạo kèm `browser_profiles` riêng (chưa có proxy, chưa đăng nhập); nhãn gọn khoảng trắng và không trùng (không phân biệt hoa/thường). Tạm dừng: đặt cờ `paused` (readiness đã chặn nhận/gửi) + yêu cầu dừng tác vụ đang chạy của đúng tài khoản đó. Gỡ: lưu trữ tài khoản (giữ lịch sử/danh tính), giải phóng chỗ, thu hồi bản duyệt, hủy tác vụ chưa gửi, yêu cầu dừng tác vụ đang chạy; không chuyển sang tài khoản khác.
  - API `apps/server/src/accounts-api.ts`: `GET/POST /api/accounts`, `PUT /api/accounts/:id`, `POST /api/accounts/:id/pause`, `POST /api/accounts/pause-all`, `POST /api/accounts/:id/remove`. Không trả đường dẫn hồ sơ hay bí mật.
  - Web: `AccountsPage.tsx` thay trang khung (bảng, thêm, đổi nhãn tại chỗ, tạm dừng/tiếp tục từng cái và tất cả, gỡ có xác nhận, báo rõ nhãn trùng); các nút "Mở trình duyệt để đăng nhập"/"Kiểm tra phiên" vẫn bị khóa kèm lý do. Tách `http.ts` dùng chung cho hai trang.
- **Kiểm tra (chỉ test phần mới):**
  - `node scripts/test.ts packages/storage/src/account-repository.test.ts` → 2/2 đạt. Lần đầu **lỗi thật**: `lower()` của SQLite không hạ chữ hoa có dấu nên nhãn "MÁY…" không bị phát hiện trùng; đã chuyển so sánh sang JavaScript (`toLocaleLowerCase('vi')`) rồi chạy lại đạt.
  - `node scripts/test.ts apps/server/src/data-api.test.ts` → 7/7 đạt (test API tài khoản: giới hạn hai, trùng nhãn 409, thiếu token 403, gỡ lần hai 404).
  - `npm.cmd run typecheck`, `npm.cmd run lint` (79 file) → đạt. **Không** chạy cổng tổng lượt này.
  - Chạy thật (server + Vite + Edge headless, dữ liệu tạm): thêm hai tài khoản, ô thêm bị khóa khi đủ hai, đổi nhãn, tạm dừng một và tất cả, hỏi xác nhận trước khi gỡ, gỡ xong ô thêm mở lại; đã xem ảnh chụp. Đã tắt server/Vite.
  - Chưa thử trên UI sau khi thêm thông báo trùng nhãn ở form (mới typecheck/lint; server vẫn có kiểm tra).
- **Quyết định:** không dependency/migration. Danh tính/phiên/proxy hiển thị đúng dữ liệu hiện có (chưa có thì ghi "Chưa xác nhận"/"Chưa kiểm tra"/"Không dùng"), không giả số liệu.
- **Tồn đọng / lưu ý:** P03.1 thiếu avatar và "lần kiểm tra phiên"; P03.2 thiếu mở/đóng phiên; P03.3–P03.5, P03.7 cần Playwright/profile thật (P01). Gỡ tài khoản chưa xóa profile/cookie trên đĩa (chưa tồn tại). Tạm dừng/gỡ mới thử với tác vụ giả ở tầng DB, chưa có worker/scheduler thật.
- **Tiếp theo:** P04.1 (form proxy; mật khẩu qua DPAPI, gán proxy cho tài khoản) để hoàn thiện cột Proxy, rồi quay lại P05.5/P05.6 khi có đích (P06). P01 thật vẫn chờ người dùng chọn tài khoản/đích/phạm vi.

## 2026-10-27 10:13 — Quyết định: hoãn P04 (Quản lý proxy)

- **Đã làm:** Chỉ ghi tài liệu, không đổi mã. Theo yêu cầu người dùng, P04 để lại làm sau, không xóa; ghi vào `plan.md` (bảng tiến độ, ghi chú đầu mục P04, P06 không còn phụ thuộc P04).
- **Lý do (người dùng quyết định):** chỉ dùng 1–2 nick, đăng bằng mạng nhà nên chưa cần proxy. Tư vấn trong phiên: proxy trả phí thường không cần ở quy mô này, proxy lạ có thể làm tăng checkpoint; rủi ro chính nằm ở hành vi đăng (tần suất, nội dung lặp, group cấm bán hàng) và tự động hóa trình duyệt trái điều khoản Facebook — không có cách nào bảo đảm không bị hạn chế. Đây là nhận định chung, chưa kiểm chứng bằng thử nghiệm thật trên máy này.
- **Trong lúc hoãn:** mọi tài khoản dùng kết nối trực tiếp; cột Proxy ở trang tài khoản hiển thị "Không dùng". Schema (`proxies`, `browser_profiles.proxy_id`) giữ nguyên, nên bật lại P04 không cần migration nền. Khi làm lại: lưu ý SOCKS5 có user/password của Chromium và mật khẩu proxy qua DPAPI.
- **Khi nào làm lại:** khi tăng số nick, cần tách IP, hoặc P01 thật cho thấy mạng là điểm nghẽn.
- **Tiếp theo:** chuẩn bị P01 thử thật — cần người dùng chọn rõ 1 nick, 1 group thử và phạm vi (không gửi mật khẩu/cookie vào chat hay Git); hoặc làm P06 offline (danh sách đích, nội quy group) để mở khóa duyệt/bản theo đích của P05.

## 2026-10-27 10:21 — P06 (phần nhập tay): Nhóm đã tham gia, danh sách đích

- **Đã làm:**
  - Domain: `normalizeGroupReference` (link nhiều dạng m./web./www., bỏ query/hash/đường dẫn phụ → ID số + link chuẩn; link chỉ có tên rút gọn → `externalId=null`; từ chối domain giả như `facebook.com.evil.com`, `/groups/feed`, URL có user:pass).
  - Migration `0003_group_curation.sql` (`destinations.curation`, `user_note`) + ADR 0011. Cập nhật 5 chỗ trong test đang ghim schema v2 → v3.
  - `createGroupRepository`: `add/update/setRelation/setArchived/list`. Một nhóm một bản ghi dù nhiều tài khoản, không ghi đè dữ liệu đã có; quan hệ tham gia/quyền riêng từng tài khoản (nguồn `manual`); `list` lọc theo tài khoản (không lẫn), tìm không dấu, khu vực, tham gia, ưu tiên, lưu trữ, phân trang; mỗi cặp tài khoản–nhóm có `eligible` và danh sách lý do chặn.
  - API `apps/server/src/groups-api.ts` (`/api/groups`, `/:id`, `/:id/accounts/:accountId`, `/:id/archive`).
  - Web: `GroupsPage.tsx` (trang "Nhóm đã tham gia"): thêm nhóm, lọc, đổi ưu tiên/quan hệ ngay trên bảng, sửa nội quy/ghi chú, ngừng dùng/dùng lại, chuyển sang Đăng nhóm (`handoff.ts`, chỉ giữ trong bộ nhớ). Banner ghi rõ **đọc tự động chưa hỗ trợ** và dữ liệu là do người dùng khai báo.
- **Kiểm tra (chỉ test phần mới):**
  - `group-link.test.ts` 3/3, `group-repository.test.ts` 3/3 (lần đầu 1 test sai kỳ vọng của chính tôi về tìm không dấu, đã sửa test), `data-api.test.ts` 8/8 (thêm test API nhóm); `migrate/schema/app.test.ts` đạt sau khi cập nhật phiên bản.
  - `npm.cmd run typecheck`, `npm.cmd run lint` (86 file) → đạt. **Không** chạy cổng tổng lượt này (`tests/e2e/local-api.test.ts` đã sửa kỳ vọng schema v3 nhưng chưa chạy lại).
  - Chạy thật (server + Vite + Edge headless, dữ liệu tạm): thêm 2 tài khoản; thêm nhóm có ID và nhóm chỉ có tên rút gọn; nhóm rút gọn bị khóa ("chưa có ID số của nhóm", checkbox tắt); chọn tài khoản, chọn nhóm đủ điều kiện, bấm chuyển → sang `#/post-group` hiện đúng tài khoản và 1 nhóm; link giả (example.com) bị từ chối. Phát hiện bảng tràn ngang ở 1200px, đã sửa CSS và chụp lại. Đã tắt server/Vite.
  - Chưa thử trên UI: thông báo link sai mới thêm ở form (typecheck/lint đạt; server vẫn từ chối), sửa nội quy/ghi chú, ngừng dùng/dùng lại, phân trang >20 nhóm.
- **Quyết định:** ADR 0011. "Đã tham gia/được đăng" là khai báo `manual`, không tuyên bố đã kiểm chứng.
- **Tồn đọng / lưu ý:**
  - P06.2–P06.4, P06.8 (đọc nhóm đã tham gia, tìm từ khóa, ScanRun, khóa phiên) **chưa hỗ trợ**, cần P01; trang "Tìm nhóm theo từ khóa" vẫn là khung.
  - `unsuitable` mới chặn ở bước chuyển sang Đăng nhóm, chưa nằm trong `readiness` — thêm khi làm duyệt/P10.
  - Link tên rút gọn không đăng được và không điền ID sau được (trigger danh tính); cùng nhóm nhập bằng hai cách thành hai bản ghi.
  - Trang Đăng nhóm mới nhận và hiển thị lựa chọn; hàng chờ là P10.
- **Tiếp theo:** P05.5/P05.6 nay đã có tài khoản + đích; duyệt cần danh tính tài khoản (hiện `account_identities` rỗng nên duyệt thật phải chờ P03.3–P03.4/P01). Hoặc P01 thử thật (cần người dùng chọn 1 nick, 1 group, phạm vi).

## 2026-10-27 10:40 — P01.1/P01.2 (đang làm): công cụ thử thật chỉ-đọc và lượt đăng nhập đầu

- **Quyết định người dùng cho lượt thử này:** dùng **nick phụ** (nhãn `phu1`); phạm vi nói là "cả thử đăng bài" nhưng **chưa nêu đích** (TCN/group) nên mới làm bước 1 (đăng nhập tay + xác nhận danh tính, không đăng, không đọc nhóm). Đích đăng cần người dùng nêu rõ ở bước sau.
- **Đã làm:**
  - Thêm `playwright-core@1.64.1` (khóa chính xác, 0 lỗ hổng theo npm audit); dùng **Edge có sẵn** (`channel: 'msedge'`), không tải trình duyệt.
  - `#browser`: `identityRefFromUrl` (danh tính từ URL trang cá nhân), `maskRef`/`refDigest`, `classifySession` (checkpoint/xác minh → dừng, form đăng nhập, cookie phiên chỉ kiểm tra có tồn tại), `acquireProfileLock` (một thư mục profile chỉ một tiến trình, dọn khóa mồ côi).
  - `spikes/fb-session.ts` + `npm run spike:fb -- login|verify --label=<nhãn> --confirm-real`: mở profile riêng tại `<dataDir>/spikes/profiles/<nhãn>` (ngoài repo), người dùng tự đăng nhập, công cụ chỉ chờ rồi mở `/me` để lấy danh tính; bằng chứng lưu **chỉ băm danh tính + bản che** ở `<dataDir>/spikes/evidence/`. Không đăng, không đọc nhóm, không đọc mật khẩu/giá trị cookie, không giải checkpoint. Thiếu `--confirm-real`, nhãn sai hoặc `APM_ENV=test` → thoát, không mở gì.
- **Kiểm tra:**
  - `node scripts/test.ts packages/integrations/browser/src/browser.test.ts` → 3/3 đạt (danh tính, phân loại phiên, khóa profile giữa hai tiến trình thật).
  - `npm.cmd run typecheck`, `npm.cmd run lint` (90 file) → đạt. Không chạy cổng tổng.
  - Chốt an toàn: chạy thiếu `--confirm-real` và với nhãn `Bad_Label` → báo lỗi, không mở trình duyệt.
  - **Chạy thật** `login --label=phu1 --confirm-real --timeout-min=15`: Edge mở được, tới trang Facebook, công cụ nhận ra `login_required`. **Trong ~9 phút theo dõi chưa có ai đăng nhập** nên chưa có kết quả danh tính; chưa chạy `verify`. Chưa có khả năng Facebook thật nào được xác nhận đạt.
- **Tồn đọng / lưu ý:**
  - P01.2 còn mở: cần người dùng đăng nhập `phu1` (có thể chạy lại lệnh `login`), sau đó chạy `verify` ở một tiến trình mới để đối chiếu danh tính sau khi mở lại.
  - Playwright mặc định bật cờ tự động hóa của trình duyệt; Facebook có thể phản ứng khác (checkpoint). Không che giấu cờ này; nếu bị checkpoint thì dừng và ghi nhận vào kết luận P01.
  - Chưa có driver đăng bài/đọc nhóm (P01.4–P01.6): cần người dùng nêu rõ đích.
- **Tiếp theo:** người dùng đăng nhập `phu1` → `verify` → ghi kết quả vào `docs/feasibility.md`; sau đó người dùng nêu đích (TCN hoặc 1 group và nội dung thử) để làm P01.4/P01.5.
