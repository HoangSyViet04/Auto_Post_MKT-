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

## 2026-10-27 10:50 — P01.2 (một phần): đăng nhập tay nick phụ và xác nhận danh tính — ĐẠT một profile

- **Đã làm:** Người dùng chọn nick phụ `phu1` và tự đăng nhập (quyết định không ghi mật khẩu vào `.env`: giữ nguyên nguyên tắc tự đăng nhập, không lưu mật khẩu/2FA; mình không đọc `.env`). Chạy `npm run spike:fb -- login --label=phu1 --confirm-real` rồi `verify` ở tiến trình mới. Không đăng bài, không đọc nhóm.
- **Kết quả thật:**
  - `login`: trạng thái đi `login_required` → `verification_required` (Facebook đòi xác minh, người dùng tự xử lý trong cửa sổ, công cụ chỉ chờ) → `logged_in` → lưu danh tính (băm `29b814f0…`, bản che `vanity:vie****** (9 ký tự)`).
  - `verify` (tiến trình mới, mở lại cùng profile): `status: match`, exit 0.
- **Kiểm tra / giới hạn:** Mới **một** profile và **một** lần chạy; chưa thử mở lại sau khi khởi động lại máy, chưa thử profile thứ hai, chưa thử hai tiến trình cùng profile trên Facebook thật (khóa profile đã có test riêng). Một lần đạt không đủ kết luận ổn định.
- **Phát hiện đáng chú ý:** lần đăng nhập đầu bằng Edge do Playwright điều khiển bị Facebook yêu cầu xác minh. Cần ghi vào kết luận P01.10; với bản dùng thật, nên coi bước đăng nhập/xác minh là thủ công một lần cho mỗi profile.
- **Bằng chứng:** nằm ngoài repo ở `%LOCALAPPDATA%\AutoPostMKT\spikes\` (profile, `evidence/phu1-identity.json` chỉ chứa băm và bản che). Không có cookie/mật khẩu/ảnh chụp trong repo hay log.
- **Cập nhật tài liệu:** `docs/feasibility.md` (P01.2 đạt một phần), `plan.md` (ghi chú P01.2, chưa tick).
- **Tiếp theo:** người dùng nêu rõ đích (TCN hoặc 1 group, nội dung thử) để làm P01.4/P01.5; hoặc chỉ làm P01.6 đọc nhóm đã tham gia (chỉ đọc) nếu người dùng đồng ý. Có thể lặp lại `verify` sau khi khởi động lại máy để tăng bằng chứng P01.2.

## 2026-10-27 11:10 — P01.5 (đang làm): bước A chỉ đọc trên group do người dùng chỉ định

- **Người dùng chọn:** group ID `1357510931662685` (người dùng là quản trị), nick `phu1` cũng là quản trị. Chưa trả lời có đăng thử TCN hay không nên **không** thử TCN (P01.4 chưa làm).
- **Đã làm:** `spikes/fb-group-post.ts prepare --label=phu1 --group=<ID> --confirm-real`: chỉ đọc. Kiểm tra phiên, so băm danh tính với bản đã lưu, vào trang nhóm, tìm ô soạn bài bằng tên truy cập (không theo class CSS). Không gõ, không bấm gửi.
- **Kết quả thật:** danh tính `match`; vào được trang nhóm; `soLuongKhop: 1`, `composer_found`, nhìn thấy được. Tiêu đề trang nhóm hiện là "Highlands Coffee- Nhận Voucher Ưu Đãi" — **chưa được người dùng xác nhận đúng là nhóm của họ**; vì vậy chưa đăng.
- **Lỗi gặp và đã sửa trong công cụ:** (1) regex tên ô soạn bài dùng cờ `u` bị Playwright từ chối khi dựng selector → bỏ cờ; (2) thêm dòng đầu thông báo lỗi đã thay URL để chẩn đoán. Chạy 4 lần mới đạt, lần cuối `composer_found`.
- **Kiểm tra:** `npm.cmd run typecheck`, `npm.cmd run lint` (91 file) đạt; chốt an toàn: `--group=abc` bị từ chối. Không chạy cổng tổng.
- **Giới hạn:** mới 1 nhóm, 1 lần đạt, giao diện tiếng Việt; chưa biết hành vi khi UI/ngôn ngữ đổi; `onGroupPage` mới kiểm tra đường dẫn có `/groups/`, chưa so ID/slug với nhóm mong đợi nên bước đăng phải bắt buộc đối chiếu tên nhóm do người dùng cung cấp.
- **Tiếp theo (bước B, đăng thật):** cần người dùng xác nhận tên nhóm đúng; sau đó thêm lệnh `post` với `--confirm-post` và `--expect-title` bắt buộc, đăng chữ rồi chữ + 2 ảnh tự tạo, phân biệt published/pending/unknown, không tự thử lại.

## 2026-10-27 11:20 — P01.5 (đang làm): đăng thử thật vào group — soạn đạt, kết quả gửi CHƯA xác định

- **Người dùng xác nhận:** tên nhóm "Highlands Coffee- Nhận Voucher Ưu Đãi" đúng là nhóm họ quản trị; nick `phu1` cũng là quản trị. Người dùng cho phép đăng thử.
- **Đã làm:** lệnh `post` trong `spikes/fb-group-post.ts`: bắt buộc `--confirm-post` và `--expect-title` (sai tên nhóm thì dừng, không đăng), có `--dry-run`, một lần bấm Đăng, không tự thử lại; ảnh do công cụ tự tạo (2 ảnh PNG), bài có marker duy nhất.
- **Kết quả thật:**
  - `--dry-run` chữ: 1 hộp thoại, 1 ô văn bản, chữ khớp, 1 nút Đăng đang bật. `--dry-run` ảnh: lần đầu đếm 7 ảnh (gồm icon), sửa đếm chỉ ảnh lớn → đúng 2 ảnh.
  - **Đăng thật 1 bài chữ** (marker `APM-TEST-20261027041131`): đã bấm Đăng một lần, hộp thoại đóng. Công cụ báo `pending_approval` và không tìm thấy bài trong feed sau ~6 giây, `postId` không đọc được.
  - **Đánh giá trung thực:** kết luận `pending_approval` dựa vào regex tìm chữ "đang chờ/chờ duyệt/pending" trên cả trang; với tài khoản quản trị trang nhóm có sẵn mục như vậy nên regex có thể khớp nhầm. Bài có thể đã đăng nhưng chưa hiện trong 6 giây, hoặc đang chờ duyệt, hoặc không lên. **Trạng thái thật chưa biết** cho đến khi người dùng đối chiếu trên nhóm.
- **Việc đã sửa/kiểm:** `npm.cmd run typecheck`, `npm.cmd run lint` (91 file) đạt; chốt an toàn: thiếu `--confirm-post`/`--expect-title` bị từ chối. Không chạy cổng tổng.
- **Chưa làm:** đăng thử có ảnh (cố ý hoãn đến khi biết kết quả bài chữ); P01.4 TCN (người dùng chưa xác nhận đích/đối tượng "Chỉ mình tôi"); nhận diện đã gửi/chờ duyệt/từ chối chắc chắn.
- **Tồn đọng:** người dùng cần tự xóa bài thử trên nhóm (công cụ không xóa). Cần cải thiện nhận diện: tìm marker lâu hơn/cuộn feed, xem mục bài chờ duyệt của quản trị, chỉ coi pending khi thấy marker trong danh sách chờ.
- **Tiếp theo:** người dùng cho biết bài `APM-TEST-20261027041131` đang ở đâu (đã hiện / chờ duyệt / không có) để hiệu chỉnh nhận diện, rồi mới đăng thử ảnh.

## 2026-10-27 11:30 — P01.5 (một phần): đăng thử thật 2 bài vào group, hiệu chỉnh nhận diện

- **Người dùng đối chiếu:** bài chữ `APM-TEST-20261027041131` **đã hiện** trên nhóm (tài khoản quản trị: bài đăng thẳng, không chờ duyệt); người dùng tự xóa bài thử.
- **Sai sót của công cụ đã phát hiện nhờ đối chiếu:** lượt đầu báo `pending_approval` (sai). Nguyên nhân: coi "không thấy bài trong 6 giây + có chữ đang chờ/pending ở đâu đó trên trang" là chờ duyệt, trong khi quản trị luôn có mục đó. Đã bỏ suy luận này: chỉ `published` khi thấy dấu vết của bài, ngược lại `unknown`; chờ duyệt chưa được hỗ trợ.
- **Đã làm (spikes/fb-group-post.ts):** thêm lệnh `find` (chỉ đọc, tìm lại bài theo dấu vết, cuộn tối đa 6 lần); đăng thử bài thứ hai (chữ + 2 ảnh PNG tự tạo, marker `APM-TEST-20261027041940`): đúng một lần bấm Đăng, hộp thoại đóng, `find` thấy bài (`published`).
- **Kết quả không đáng tin (ghi để không dùng nhầm):**
  - `postId`: lần đầu cả hai bài cùng ra `1690702521676856` → lấy nhầm liên kết của bài khác; sau khi chỉ chấp nhận khi tầng gần nhất có đúng một ID thì không đọc được (`khong_doc_duoc`).
  - Đếm ảnh: `8` cho bài chỉ có chữ (khối quá rộng), `3` trên trang riêng của một ID sai → bỏ. Số ảnh đính kèm chỉ được xác nhận **trong hộp thoại trước khi đăng** (đúng 2); chưa xác nhận trong bài đã đăng.
  - Bài chữ lần `find` thứ hai không thấy nữa (`unknown`, cuộn 6 lần) — khớp với việc người dùng xóa bài; không dùng làm bằng chứng về độ ổn định.
- **Kiểm tra:** `npm.cmd run typecheck`, `npm.cmd run lint` (91 file) đạt. Không chạy cổng tổng. Chốt an toàn: thiếu `--confirm-post`/`--expect-title` bị từ chối; `--expect-title` sai tên nhóm → dừng.
- **Giới hạn:** 1 nhóm, 1 nick quản trị, giao diện tiếng Việt, 2 bài, chưa lặp lại sau khởi động lại; chưa thử nick thường (pending/từ chối), chưa thử TCN (P01.4: người dùng chưa xác nhận đối tượng "Chỉ mình tôi").
- **Tồn đọng:** người dùng tự xóa bài thử thứ hai (marker `APM-TEST-20261027041940`). Cần cách đọc ID bài và đếm ảnh đáng tin (P01.9), cách nhận diện chờ duyệt/từ chối, thử lại sau restart.
- **Tiếp theo:** (1) người dùng xác nhận bài 2 hiện đủ 2 ảnh rồi xóa; (2) quyết định có thử TCN không (cần đặt đối tượng mặc định "Chỉ mình tôi"); (3) thử nick không phải quản trị nếu muốn kiểm chứng pending/từ chối.

## 2026-10-27 11:30 — P01.5 (một phần, kết thúc đợt thử với nick quản trị): đối chiếu đáp án thật

- **Người dùng cung cấp đáp án thật:** bài `APM-TEST-20261027041940` hiện **đủ 2 ảnh**; link thật `.../groups/1357510931662685/permalink/2306124406801328/`. ID công cụ đọc lúc trước (`1690702521676856`) là **sai** (xác nhận lại nhận định ở mục trước).
- **Chẩn đoán (2 lần chạy chỉ đọc tạm, file chẩn đoán đã xóa):** ID bài thật không nằm ở liên kết `/permalink/` hay `/posts/` trong trang nhóm (liên kết dòng thời gian không có sẵn); nó nằm ở `.../post_insights/<ID>/` (chỉ quản trị) và `set=pcb.<ID>` (liên kết ảnh của bài có ảnh). Trang riêng của bài mở dạng hộp thoại nên đếm ảnh trong hộp thoại (ban đầu đếm cả khung trang ra 3).
- **Đã sửa (`spikes/fb-group-post.ts`):** nhận diện ID ở các dạng trên, chỉ tin khi tầng gần nhất có đúng một ID; đếm ảnh trong hộp thoại bài.
- **Kết quả thật sau sửa:** `find --marker=APM-TEST-20261027041940` → `published`, `postId=2306124406801328` (khớp đáp án), `anhTrongBai=2` (khớp). Typecheck/lint (91 file) đạt; không chạy cổng tổng.
- **Giới hạn (không được khái quát):** chỉ 1 nhóm, 1 nick quản trị, 1 bài có ảnh được đối chiếu; ID bài chữ của nick thường chưa có cách đọc; chờ duyệt/từ chối chưa nhận diện; chưa lặp lại sau restart; chưa thử TCN (P01.4). Cách đọc ID phụ thuộc cấu trúc trang hiện tại của Facebook và có thể hỏng khi giao diện đổi.
- **Quyết định:** theo yêu cầu người dùng chuyển sang phần tiếp theo; P01.4 và các phần còn thiếu của P01.5 để mở, ghi rõ ở `plan.md` và `docs/feasibility.md`.
- **Tiếp theo:** P01.6 đọc nhóm đã tham gia của nick `phu1` (chỉ đọc, có giới hạn và điều kiện dừng).

## 2026-10-27 11:40 — P01.6 (một phần): đọc danh sách nhóm đã tham gia của nick phụ

- **Phạm vi:** nick `phu1` đã đăng nhập; chỉ đọc trang nhóm đã tham gia, không bấm, không tham gia/rời nhóm, không đăng. Kết quả đầy đủ (tên, link) nằm ngoài repo ở `%LOCALAPPDATA%\AutoPostMKT\spikes\evidence\phu1-joined-groups.json`; màn hình/log chỉ in số lượng.
- **Đã làm:** `spikes/fb-common.ts` (mở profile đã đăng nhập, bắt buộc phiên còn hiệu lực và danh tính khớp) và `spikes/fb-groups-read.ts joined --label --limit --expect-group --confirm-real`: cuộn trang, gom liên kết nhóm, chuẩn hóa bằng `normalizeGroupReference` (cùng quy tắc với trang Nhóm), điều kiện dừng: đủ giới hạn / 3 vòng không thêm nhóm / mất phiên / tối đa 40 vòng. Kết quả luôn ghi `complete: false`.
- **Kết quả thật:**
  - `--limit=50`: dừng vì chạm giới hạn (50 nhóm: 29 có ID số, 21 chỉ có tên rút gọn); nhóm đã biết chưa nằm trong 50 đầu.
  - `--limit=200`: **130 nhóm**, 81 có ID số, 49 chỉ có tên rút gọn, dừng `no_more_results_seen` sau 13 vòng, **có chứa nhóm đã biết** (`1357510931662685`).
- **Đánh giá trung thực:** chưa đối chiếu 130 với số nhóm thật của nick nên chưa biết đủ hay thiếu, và chưa biết trang có lẫn nhóm gợi ý hay không. Có thể bị cắt do tải chậm ở vòng cuối. Khoảng 38% nhóm chỉ có tên rút gọn → không đăng được cho tới khi biết ID số (cần bước làm giàu: mở từng nhóm để đọc ID, chưa làm).
- **Kiểm tra:** `npm.cmd run typecheck`, `npm.cmd run lint` (93 file) đạt; chốt an toàn thiếu `--confirm-real` bị từ chối. Không chạy cổng tổng. Chưa lặp lại sau restart.
- **Chưa làm:** tìm nhóm theo từ khóa (P01.6 nửa sau); làm giàu ID cho nhóm tên rút gọn; nhập kết quả vào DB/trang Nhóm.
- **Tiếp theo:** người dùng cho biết số nhóm thật của `phu1` (khoảng bao nhiêu) để đối chiếu; sau đó thử tìm theo từ khóa hoặc làm giàu ID.

## 2026-10-27 11:45 — P06.2 (đường nhập kết quả quét): nhập nhóm đã đọc vào trang Nhóm

- **Đã làm:** `createGroupRepository().importObserved(accountId, items)`: nhập danh sách nhóm đọc được (chuẩn hóa link, không ghi đè dữ liệu đã có, chạy lại không trùng, mục lạ bị bỏ qua và đếm); đặt "đã tham gia" với nguồn `joined_scan`, **không đụng quyền đăng** (nhóm mới để "chưa rõ quyền đăng" nên chưa đủ điều kiện đăng). `scripts/import-joined-groups.ts` + `npm run groups:import -- --label --account [--apply]`: mặc định chạy thử, cần `--apply` mới ghi; tài khoản phải có sẵn trong app. Giao diện: nhãn "đọc từ Facebook" cho quan hệ nguồn `joined_scan`, sửa dòng giải thích cho đúng thực tế.
- **Kiểm tra (chỉ phần mới):** `node scripts/test.ts packages/storage/src/group-repository.test.ts` → 4/4 đạt (test mới: nguồn `joined_scan`, quyền đăng người dùng khai báo được giữ nguyên, nhóm mới `unknown` quyền, nhóm tên rút gọn bị chặn `no_external_id`, không lẫn tài khoản khác, tài khoản không tồn tại → `not_found`). `npm.cmd run typecheck` đạt, `npm.cmd run lint` (94 file) đạt. Không chạy cổng tổng.
- **Chạy thật trên DB tạm (không đụng DB vận hành):** tạo tài khoản `phu1`, chạy thử → 130 mục nhận được (81 có ID số, 49 tên rút gọn); `--apply` → created 130; chạy lại → existing 130, created 0; tài khoản sai nhãn → báo lỗi. API: tổng 130, 0 nhóm đủ điều kiện đăng, nguồn `joined_scan`. Đã xem ảnh chụp trang Nhóm với 130 nhóm có nhãn "đọc từ Facebook".
- **Chưa làm / lưu ý:**
  - **Chưa nhập vào DB thật của người dùng**; muốn dùng thật: tạo tài khoản `phu1` ở trang Quản lý tài khoản rồi chạy `npm run groups:import -- --label=phu1 --account=phu1 --apply`.
  - Tên nhóm lấy từ chữ trên liên kết, có thể lẫn ký tự lạ; 49 nhóm tên rút gọn chưa đăng được (cần làm giàu ID).
  - Hồ sơ trình duyệt của app (`browser_profiles`) chưa nối với hồ sơ thử P01 (`spikes/profiles/phu1`) — việc của P03.3.
  - Kết quả đọc là một phần; chưa đối chiếu tổng số nhóm thật.
- **Tiếp theo:** P03.3 (nối tài khoản trong app với hồ sơ trình duyệt đã đăng nhập, đăng nhập/mở lại trong worker) để app tự đọc/đăng thay vì công cụ thử; hoặc làm giàu ID cho 49 nhóm; hoặc tìm theo từ khóa.

## 2026-10-27 11:55 — Quyết định người dùng + P01.4 (TCN) bước đầu: dừng vì đối tượng bài là "Công khai"

- **Người dùng cho biết/quyết định:**
  1. Đã tự đếm: nick phụ có **130 nhóm** — khớp kết quả đọc (P01.6 đối chiếu được số lượng). Nhóm **không có ID số thì bỏ qua**, không cần; làm giàu ID để khi mở rộng sau.
  2. Đồng ý **đăng thử 1 bài test lên TCN** của `phu1`.
  3. Đã xóa thư mục `dist` trong `D:\OneDrive - EDUPIA\Auto_Post_MKT\apps\web\dist` — đó là **thư mục OneDrive cũ**, không phải repo hiện tại; kiểm tra lại: `D:\Project\Auto_Post_MKT\apps\web\dist` vẫn còn và `npm run build:web` vẫn báo EPERM. Cần người dùng xóa đúng thư mục này (hoặc bằng quyền admin).
- **Đã làm:**
  - `importObserved` và `groups:import` chỉ nhập nhóm **có ID số**; nhóm chưa có ID được đếm riêng (`withoutId`) và không lưu. Test `group-repository` cập nhật: 4/4 đạt; typecheck/lint (95 file) đạt.
  - `spikes/fb-common.ts` dùng chung và `spikes/fb-profile-post.ts post --label --confirm-post [--expect-audience] [--dry-run]`: mở trang cá nhân, mở hộp soạn bài, **đọc đối tượng của bài** và chỉ đăng khi khớp `--expect-audience` (mặc định "Chỉ mình tôi"/"Only me"); không đọc được hoặc khác → dừng; không tự đổi quyền riêng tư; bấm Đăng đúng một lần.
- **Kết quả thật (`--dry-run`, không đăng):** đúng danh tính; tìm thấy 1 ô soạn bài, 1 hộp thoại, 1 ô văn bản, 1 nút đối tượng; nhãn đọc được: "Đang chia sẻ với **Công khai**" → khác mong đợi → **dừng, không đăng, không gõ gì lên Facebook**. Mã thoát 8.
- **Quyết định đang chờ người dùng:** (a) đặt đối tượng mặc định/đối tượng bài của `phu1` thành "Chỉ mình tôi" rồi chạy lại; hoặc (b) cho phép đăng bài test **công khai** (mọi người xem được cho tới khi xóa) bằng `--expect-audience="Công khai"`.
- **Chưa làm:** chưa đăng TCN; chưa nhập 130 nhóm vào DB thật (cần tạo tài khoản `phu1` trong app); chưa chạy cổng tổng.

## 2026-10-27 12:10 — P01.4 (một phần): đăng thử bài chữ công khai lên TCN của nick phụ

- **Người dùng đồng ý:** đăng bài test **công khai** trên TCN của `phu1` (nick phụ). Người dùng cũng báo đã "back lại" thư mục `dist` (chưa kiểm lại build ở lượt này).
- **Đã làm:** `spikes/fb-profile-post.ts`: thêm bước "Tiếp" (trang cá nhân có hai bước), chờ nút bật, kiểm lại đối tượng ở bước hai, lệnh `find` chỉ đọc; bước xác nhận sau khi đăng chờ lâu hơn và tải lại tối đa 3 lần.
- **Kết quả thật:**
  - Lần chạy 1 và 2 (không đăng): dừng vì không thấy nút "Đăng" — hộp thoại trang cá nhân có nút **"Tiếp"**; sau khi xử lý hai bước, `--dry-run` đạt (đối tượng "Công khai" khớp ở cả hai bước, nút Đăng bật).
  - **Đăng thật** (marker `APM-TEST-20261027045312`): bấm Đăng đúng một lần, hộp thoại đóng. Xác nhận ngay sau đó báo `unknown` (5 lần cuộn không thấy); chạy `find` chỉ đọc sau đó → **`published`** (cuộn 1 lần). Kết luận: `unknown` ban đầu do trang cập nhật chậm, không phải bài thất bại; không đăng lại.
- **Kiểm tra:** `npm.cmd run typecheck`, `npm.cmd run lint` (95 file) đạt; guard: thiếu `--confirm-post` bị từ chối; sai đối tượng → dừng (đã thấy ở lượt trước). Không chạy cổng tổng.
- **Giới hạn:** 1 bài chữ, 1 nick, giao diện tiếng Việt; chưa thử ảnh, đọc ID/link bài TCN, đối tượng khác, sau restart; `published` chỉ dựa vào dấu vết xuất hiện trên trang cá nhân (người dùng nên đối chiếu bằng mắt).
- **Việc người dùng cần làm:** xem bài trên TCN `phu1`, rồi **tự xóa** (bài đang công khai).
- **Tiếp theo:** P03.3–P03.5 (nối hồ sơ trình duyệt vào worker) hoặc P07 (hàng chờ, adapter giả); còn tồn đọng P01: chờ duyệt/từ chối (nick không phải quản trị), ảnh TCN, restart, tìm từ khóa, đọc ID cho nhóm tên rút gọn khi mở rộng.

## 2026-10-27 12:20 — P03.3 (xong) + P03.4/P03.5/P03.7 (một phần): worker mở lại phiên tài khoản qua giao diện

- **Quyết định người dùng:** làm P03.3–P03.5 (nối trình duyệt vào ứng dụng).
- **Kiến trúc:** server chỉ ghi lệnh; **worker** mới điều khiển Playwright. Migration `0004_browser_commands.sql` (lệnh `login`/`verify`, mỗi tài khoản tối đa MỘT lệnh đang chờ/chạy bằng chỉ mục duy nhất, lịch sử không xóa). `createBrowserCommandRepository` (enqueue/claimNext có điều kiện/heartbeat/hủy/finish đúng chủ, dọn lệnh worker chết `worker_lost`), `createLeaseRepository` (khóa trình duyệt theo tài khoản trên `resource_leases`, fence chỉ tăng), `worker-status` (nhịp sống + chế độ trình duyệt trong `app_meta`, hiện ở `/api/health`). `createAccountRepository`: `profileKey`, `identityRef`, `recordIdentity` (tạo lần đầu; khác nick thì **không tự đổi**), `recordSession`; gỡ tài khoản hủy lệnh trình duyệt.
- **Worker:** `#browser` có giao diện `BrowserDriver` (tiêm được) + `createPlaywrightDriver` (Edge có sẵn, hồ sơ `<dataDir>/profiles/<khóa ngẫu nhiên>`, người dùng tự đăng nhập, chỉ kiểm tra cookie phiên tồn tại, không đọc mật khẩu/giá trị cookie; checkpoint thì chỉ chờ). `apps/worker/src/browser-commands.ts` điều phối: nhận lệnh → khóa → driver → ghi phiên/danh tính → kết thúc đúng một lần → nhả khóa; lỗi driver chỉ lưu mã `driver_error`. `apps/worker/src/index.ts` giờ chạy vòng lặp (nhịp sống 5s, hỏi lệnh 2s); `--once` cho test. **`APM_BROWSER` mặc định `off`**, `real` bị cấm khi `APM_ENV=test` (tài liệu: `.env.example`, `docs/environment.md`).
- **Server/UI:** `POST /api/accounts/:id/browser {kind}` (503 nếu worker không chạy/chưa bật trình duyệt, 409 nếu đã có lệnh), `POST /api/browser-commands/:id/cancel`; trang Quản lý tài khoản có nút Đăng nhập / Kiểm tra phiên / Hủy lệnh, trạng thái lệnh bằng tiếng Việt, "kiểm tra lúc …", cảnh báo khi worker chưa chạy hoặc chưa bật trình duyệt, tự cập nhật.
- **Lỗi cũ phát hiện và sửa:** `AccountsPage.tsx` có `/s+/` thay vì `/\s+/` (dấu \ bị mất khi tạo file bằng shell, làm kiểm tra trùng nhãn sai); đã quét các biểu thức chính quy khác trong mã, không còn chỗ hỏng.
- **Kiểm tra:**
  - Test phần mới: `browser-state.test.ts` 3 (lệnh/khóa/danh tính), `apps/worker/src/browser-commands.test.ts` 4 (driver giả: đăng nhập, nhầm nick, mismatch, không có danh tính gốc, phân loại phiên, hủy, lỗi driver không lộ thông điệp, hồ sơ bận), `data-api.test.ts` +1 (API lệnh), `browser-labels.test.ts` 1, `browser.test.ts` +1 (lỗi mạng).
  - **Cổng tổng một lần: `npm.cmd test` → 163/163 đạt; typecheck, lint (105 file) đạt.** `build:web` mặc định vẫn vướng `dist` cũ (chưa kiểm lại lượt này).
  - **Chạy thật trên dữ liệu thật của người dùng** (server + worker `APM_BROWSER=real` + web; không nạp `.env`): tạo tài khoản `phu1`; lệnh `login` → người dùng tự đăng nhập (qua xác minh) → `succeeded/identity_saved`, phiên `logged_in`; lệnh `verify` (mở lại hồ sơ) → `succeeded/match`; lệnh thứ hai khi đang bận → 409. Đã xem ảnh chụp trang tài khoản. Đã tắt server/worker/web.
  - **Nhập nhóm vào DB thật** (người dùng đã đồng ý bỏ nhóm không ID): `groups:import --label=phu1 --account=phu1 --apply` → 81 nhóm có ID số được tạo, 49 bỏ qua.
- **Giới hạn:** 1 tài khoản, 1 lần; chưa thử `identity_mismatch`, `network_error`, hủy lệnh đang chạy, `worker_lost` trên Facebook thật (chỉ driver giả); chưa thử hồ sơ thứ hai; cửa sổ Edge luôn hiện (cả khi kiểm tra phiên); người dùng tự mở thư mục hồ sơ ngoài app chưa được xử lý; chưa khởi động lại máy rồi verify. Hồ sơ trình duyệt của app mới (không dùng lại hồ sơ thử P01).
- **Tiếp theo:** P07 (hàng chờ/lịch với adapter giả, dùng khóa trình duyệt và kiểm tra danh tính trước mỗi job) rồi P08 (adapter đăng nhóm/TCN thật từ mã thử P01).

## 2026-10-27 12:45 — P07 (mô phỏng): hàng chờ, bộ chạy job của worker, API và trang Hàng chờ

- **Quyết định người dùng:** làm P07 (hàng chờ và lịch với adapter giả) trước P08.
- **Đã làm:**
  - Lưu trữ: `ClaimOptions` cho `claimNext` (loại job theo tài nguyên bận, bỏ job quá hạn), `renewClaim`, `abandon` (trả job về hàng khi chưa gửi), `reschedule`, `lastSendStartedAt`, `hasRunningJob`, `logActivity`; `createJobQueries().list` (đọc job bền kèm đích/tài khoản/máy/kết quả cuối/quá hạn); `identityId` của tài khoản; cấu hình `APM_MIN_GAP_SECONDS` (mặc định 60), `APM_OVERDUE_MINUTES` (mặc định 15).
  - Worker: `apps/worker/src/job-runner.ts` — khôi phục job của worker chết; nhận job (tuần tự theo tài khoản, giãn cách, bỏ quá hạn); giữ khóa trình duyệt; kiểm tra ảnh/điều kiện/`prepare`; **ghi mốc gửi rồi mới gửi đúng một lần**; lỗi sau mốc → `unknown`, không thử lại; lỗi phiên/checkpoint/sai danh tính chặn đúng tài khoản đó. Vòng lặp worker chạy cả lệnh trình duyệt lẫn job (chỉ adapter đã chọn: mặc định giả).
  - Server: `GET /api/jobs`, `POST /api/approvals`, `POST /api/jobs`, `/api/jobs/:id/{pause,resume,cancel,stop,reschedule}`; bản caption theo đích (`destinationId` trong `POST /api/products/:id/content-versions`, P05.6).
  - Web: trang "Hàng chờ đăng" (giờ Việt Nam, trạng thái tiếng Việt, thao tác theo trạng thái, cảnh báo job quá hạn, báo worker chưa chạy), `job-view.ts`.
- **Kiểm tra:**
  - Test phần mới: `job-runner.test.ts` 9 (chạy một lần, chưa đến hạn/quá hạn, unknown/ném lỗi/chờ duyệt không gửi lại, lỗi trước gửi và ảnh mất, dừng trước mốc gửi, khóa bận/giãn cách, phiên hết hạn chỉ chặn tài khoản đó, worker chết trước/sau mốc, đích xen kẽ); `data-api.test.ts` +1 (duyệt cần danh tính, chống bấm hai lần, tạm dừng/tiếp tục/hủy/đổi lịch, danh sách bền); `job-view.test.ts` 3.
  - **Cổng tổng cuối phase: `npm.cmd test` → 176/176 đạt; typecheck, lint (112 file) đạt.** `build:web` mặc định vẫn vướng `dist` cũ (chưa kiểm lại).
  - **Chạy thật (mô phỏng, DB tạm, server + worker + web, `APM_MIN_GAP_SECONDS=8`):** 3 job cùng tài khoản: job 1 chạy sau ~2s, job 2 chờ đúng giãn cách rồi chạy (~11s), job 3 quá hạn 1 giờ **không tự chạy**; bấm "Chạy ngay" trên giao diện (Edge điều khiển) → job 3 đã đăng (mô phỏng). Đã xem ảnh chụp; đã tắt server/worker/web.
- **Giới hạn:** chỉ adapter giả — chưa có bài thật nào đi qua hàng chờ; chưa chạy P07 trên DB thật của người dùng; chưa thử worker bị tắt giữa lúc đang chạy bằng tiến trình thật (chỉ mô phỏng bằng test); Page (khóa `page:`) chưa có khóa riêng; chưa có giới hạn số bài/ngày; chưa có ô nhập lịch trên giao diện.
- **Tiếp theo:** P08 — chuyển mã thử P01 (đăng nhóm/TCN) thành adapter thật cắm vào bộ chạy job (móc `preflight` xác nhận danh tính trước mỗi job), bắt đầu bằng `APM_INTEGRATIONS=live` cho một đích thử do người dùng chọn rõ.

## 2026-10-27 13:00 — P08 (offline): adapter đăng nhóm/TCN thật cắm vào hàng chờ — CHƯA chạy thật qua ứng dụng

- **Quyết định người dùng:** làm P08 (adapter thật). Đích thử đã chọn từ trước: nhóm `1357510931662685` (người dùng quản trị) bằng nick phụ `phu1`.
- **Đã làm:**
  - `#browser`: `launchProfile` (khóa hồ sơ, Edge), `facebook-ui` (nhận diện phần tử theo tên truy cập, đọc ID bài, đếm ảnh), `createBrowserPublisher` — `prepare` làm mọi việc trừ bấm Đăng (đúng người đăng bằng so băm danh tính, đúng đích, điền caption, đính đủ ảnh theo thứ tự, chờ xem trước, tìm đúng một nút Đăng bật); `submit` bấm Đăng đúng một lần rồi tìm lại bài (số lần đoạn chữ tăng so với trước khi đăng; ID đọc từ `/post_insights/`, `set=pcb.`…); không thấy bài → `unknown`; `verify` chỉ đọc; `stop`. Driver đăng nhập dùng chung `launchProfile`.
  - `#fb-group` (xác nhận đúng ID nhóm), `#fb-profile` (hai bước Tiếp/Đăng, đối tượng bài bắt buộc theo `APM_PROFILE_AUDIENCE` nếu đặt). Fanpage: adapter "unsupported" tắt rõ ràng (`prepare`/`submit` đều dừng, không giả thành công). `createPublishers('live', …)`; worker từ chối `live` nếu không có `APM_BROWSER=real`.
  - `ensureProfileDestination` + `POST /api/accounts/:id/profile-destination` (đích trang cá nhân theo danh tính đã xác nhận); dải đỏ "Chế độ THẬT" trên giao diện; `scripts/live-test-post.ts` (đăng thử thật có chốt `--confirm-post`, từ chối nếu server/worker không ở chế độ live).
- **Kiểm tra:**
  - **Cổng tổng: `npm.cmd test` → 186/186 đạt**; typecheck, lint (118 file) đạt.
  - Test mới: `composer-publisher.test.ts` 9 trên **trang Facebook giả** (`tests/fixtures/mock-facebook.ts`, Edge ngầm): đăng chữ + đúng 2 ảnh một lần (ID bài đọc đúng, bằng chứng `browser_observation`), bấm Đăng mà không thấy bài → `unknown` kể cả khi feed đã có bài cùng nội dung từ trước, bài phải có ≥1 ảnh, 6 lý do dừng trước khi gửi (chưa đăng nhập, checkpoint, sai danh tính, sai nhóm, giao diện đổi, ảnh không đính được; đều **không** gửi), sai kênh/yêu cầu không hợp lệ, `stop`, `verify`; trang cá nhân hai bước, đối tượng không khớp thì dừng, sai người đăng nhập/đích lệch bị từ chối. Thêm test `ensureProfileDestination`, nhà máy adapter (live/unsupported).
  - **Sai sót của chính bộ test đã phát hiện và sửa:** Facebook giả ban đầu trả chuyển hướng 302, và yêu cầu sau chuyển hướng lọt ra **mạng thật** (Facebook thật trả trang đăng nhập) nên vài kết quả không đáng tin. Đã đổi sang chuyển hướng bằng JavaScript và thêm chặn mọi yêu cầu khác (chỉ `www.facebook.com` được xử lý bằng trang giả); kiểm tra lại: các yêu cầu chỉ tới `www.facebook.com` và đều bị chặn/trả trang giả. Không có bài thật nào bị đăng vì việc này (trang giả không có nút gửi thật, trình duyệt không có phiên thật).
- **KHÔNG chạy thật qua ứng dụng:** đã bật server + worker ở chế độ live và định tạo máy thử/duyệt/xếp job vào nhóm của người dùng, nhưng bước đó **bị hệ thống chặn quyền** (hành động đăng bài thật). Không lách; đã **tắt toàn bộ tiến trình live**, không có job nào được tạo, không có bài nào được đăng. Chưa có bằng chứng adapter chạy đúng trên Facebook thật; mã mới dựa trên cách nhận diện đã đạt ở P01 nhưng chưa được kiểm chứng ở dạng adapter.
- **Tồn đọng / giới hạn:** thử thật qua ứng dụng (nhóm, rồi TCN); thứ tự ảnh chỉ kiểm chứng ở P01 (xanh rồi đỏ), chưa qua adapter; chờ duyệt/từ chối chưa nhận diện; Fanpage chưa có (P09); `build:web` vẫn vướng `dist` cũ.
- **Tiếp theo (cần người dùng):** tự chạy hoặc cho phép chạy `scripts/live-test-post.ts`: (1) `APM_INTEGRATIONS=live npm run dev:server`, (2) `APM_INTEGRATIONS=live APM_BROWSER=real npm run dev:worker`, (3) `npm run dev:web`, (4) `node scripts/live-test-post.ts --account=phu1 --group=1357510931662685 --confirm-post`; sau đó xem "Hàng chờ đăng", đối chiếu bài trên nhóm và tự xóa bài thử.

## 2026-10-28 09:30 — P10 (kênh nhóm): trang "Đăng bài viết nhóm" dùng được trong ứng dụng

- **Quyết định người dùng:** làm P10 trước; từ giờ **chỉ push một lần cuối buổi** (dự án chạy trên một máy) — lượt này chỉ commit trên máy. Người dùng đã xóa thư mục `apps/web/dist` cũ; `npm run build:web` hết lỗi EPERM.
- **Đã làm:**
  - Lưu trữ: `createPostBatchService` — một lần gọi tạo bản caption RIÊNG từng đích (đúng ảnh và thứ tự của máy), duyệt theo phiên bản máy hiện tại và danh tính đã xác nhận, xếp job. **Tất cả hoặc không gì** (đích không đủ điều kiện thì không xếp job nào, trả danh sách đích bị chặn); chống bấm hai lần theo `requestKey` (trả lại kết quả cũ, nội dung khác → `idempotency_conflict`); máy đã bán hoặc tài khoản chưa có danh tính bị từ chối.
  - Server: `POST /api/posts` (409 kèm `failures` khi có đích bị chặn).
  - Web: `PostGroupPage.tsx` (6 bước: tài khoản → máy (ảnh theo thứ tự) → caption chung (mẫu/sửa) → nhóm (lọc, nội quy, duyệt bài, lý do chưa đăng được; nhận lựa chọn từ trang Nhóm) → lịch (ngay hoặc giờ Việt Nam) → xem trước từng nhóm với caption sửa riêng và cảnh báo trùng) + khối kết quả từng nhóm tự cập nhật; chế độ THẬT bắt buộc tick xác nhận; mã yêu cầu giữ nguyên khi nội dung không đổi; bản nháp được nhớ khi chuyển trang. `post-plan.ts` (logic thuần).
- **Kiểm tra:**
  - Test phần mới: `post-batch.test.ts` 4 (tạo bản/duyệt/job theo đích; chống bấm hai lần; tất cả hoặc không gì và mã khóa dùng lại được; đầu vào sai/máy đã bán/chưa có danh tính), `data-api.test.ts` +1 (API `/api/posts`), `post-plan.test.ts` 5.
  - **Cổng tổng: `npm run check` (typecheck + lint + test + build:web) → 196/196 test đạt, lint 123 file sạch, build web đạt.** Cổng phát hiện một test cũ dùng `/api/posts` làm ví dụ "API không tồn tại" (nay có thật) → đã đổi sang đường dẫn khác.
  - Chạy thật trên giao diện (mô phỏng, DB tạm, server + worker + web; Edge điều khiển): caption mẫu tự điền đúng, 2 ảnh theo thứ tự, nhóm chưa có quyền bị khóa kèm lý do, nút bị khóa tới khi chọn nhóm; chọn 2 nhóm, sửa riêng caption nhóm 2, bấm xếp lịch → 2 job chạy xong "Đã đăng" (mô phỏng, không có bài thật). Đã xem ảnh chụp; đã tắt server/worker/web.
- **Giới hạn:** chưa chạy chế độ THẬT qua trang này (chờ người dùng cho phép); trang chưa thử với >100 nhóm/trang kết quả dài; ô giờ hẹn mới thử qua test logic, chưa thử trên giao diện thật; chưa có chọn lại caption từ bản đã lưu; bản sửa layout ô lịch chưa chụp lại.
- **Tiếp theo:** (1) đăng thử thật bằng chính trang này (cần người dùng có mặt/cho phép; chạy server+worker `APM_INTEGRATIONS=live`, `APM_BROWSER=real`); (2) P10.3 trang cá nhân (dùng lại `/api/posts` với đích `profile-destination`); (3) P11 đối chiếu job `unknown`.

## 2026-10-28 10:10 — P10.3: trang "Đăng bài viết cá nhân"

- **Quyết định người dùng:** "triển khai đi" sau khi mình nêu 3 hướng; mình chọn hướng 2 (trang cá nhân). Không push (chỉ commit trên máy).
- **Đã làm:** `PostProfilePage.tsx`: chọn 1–2 tài khoản đủ điều kiện (lý do khóa hiển thị), máy (ảnh theo thứ tự), caption chung + sửa riêng từng tài khoản, lịch, xem trước "Trang cá nhân của <tài khoản>" kèm danh tính, cảnh báo cùng caption giữa hai tài khoản, xác nhận bắt buộc ở chế độ THẬT, kết quả từng tài khoản tự cập nhật. Với mỗi tài khoản: `POST /api/accounts/:id/profile-destination` rồi `POST /api/posts` (mã yêu cầu riêng, giữ nguyên khi nội dung không đổi nên bấm lại/mất phản hồi không tạo job trùng). Ghi chú trên trang: đối tượng bài theo cài đặt Facebook; `APM_PROFILE_AUDIENCE` làm worker dừng khi khác.
- **Kiểm tra:**
  - Test mới: `data-api.test.ts` +1 — đích TCN cần danh tính xác nhận, mỗi danh tính một đích, chạy lại không trùng, danh sách nhóm không chứa TCN, hai tài khoản hai job riêng `profile`, dùng TCN của người khác làm đích → 409.
  - **Cổng tổng: `npm run check` → 197/197 test đạt, lint 124 file sạch, build web đạt.**
  - Chạy thật trên giao diện (mô phỏng, DB tạm; Edge điều khiển): chọn 2 tài khoản + máy → cảnh báo trùng caption; sửa riêng caption Nick B → cảnh báo mất; bấm xếp lịch → 2 job `profile` tới đúng `vanity:nick.a`/`vanity:nick.b`, cả hai "Đã đăng (mô phỏng)". Đã tắt server/worker/web. Chưa xem ảnh chụp lần này.
- **Giới hạn:** chưa đăng thật qua trang này; chưa hiển thị đối tượng bài thực tế (chỉ biết khi worker đọc lúc chuẩn bị); ô hẹn giờ chưa thử trên giao diện; một tài khoản lỗi giữa chừng không dừng tài khoản kia (có chủ ý, báo từng tài khoản).
- **Tiếp theo:** đăng thử thật (nhóm/TCN) bằng các trang này khi người dùng cho phép; P11 đối chiếu job `unknown`/nhật ký/sao lưu; P10.5 preset; P10.9 máy sửa/đã bán phản ánh vào bài/lịch.

## 2026-10-28 14:45 — P08.8: đăng thử THẬT qua trang giao diện (nhóm và trang cá nhân)

- **Người dùng chọn rõ và cho phép:** đăng thử bằng các trang trong ứng dụng, nhóm `1357510931662685` (người dùng quản trị) và trang cá nhân của nick phụ `phu1` (công khai, đã đồng ý trước đó). Chế độ: `APM_INTEGRATIONS=live`, `APM_BROWSER=real`, `APM_PROFILE_AUDIENCE="Công khai"`, dữ liệu thật; trang giao diện được điều khiển bằng Edge ngầm (chọn tài khoản/máy/nhóm, tick xác nhận THẬT, bấm xếp lịch).
- **Diễn biến thật:**
  1. Lần 1 (nhóm): job chạy ~100 giây rồi **dừng trước khi gửi** — `failed/media_invalid`, mốc gửi = chưa; **không có bài nào được đăng**. Chẩn đoán: `spikes/fb-adapter-prepare.ts` (chỉ `prepare`, không submit) cho `ok` với ảnh `.png` do script tạo → nguyên nhân là ảnh trong kho ứng dụng có tên `<uuid>.blob` (không đuôi ảnh) nên giao diện Facebook không nhận. Sửa: đọc file và đưa trình duyệt kèm tên/loại đúng suy từ chữ ký file (giữ thứ tự), thông báo lỗi giờ nêu số ảnh đếm được; Facebook giả từ chối file không có đuôi ảnh để test bắt lỗi; thêm test hồi quy (ảnh `.blob` đính đủ 2, file không phải ảnh → `media_invalid` trước gửi).
  2. Lần 2 (nhóm): sau ~50 giây `published`, ID bài `2307259096687859`, có liên kết bài, nguồn `ui_observation`, mốc gửi đã ghi, nhật ký `send_started` → `job_published`.
  3. Trang cá nhân `phu1` (công khai): sau ~45 giây `published`, ID `1549103153905018` (ID đọc được từ trang; TCN không có liên kết bài suy ra).
- **Kiểm tra:** cổng tổng `npm run check` → **198/198 test đạt**, lint 125 file sạch, build web đạt. Đã tắt toàn bộ server/worker/web và không còn trình duyệt của ứng dụng chạy.
- **Chưa xác nhận (cần người dùng):** bằng mắt — nội dung đúng (2 dòng/caption mẫu), ảnh đúng thứ tự (xanh rồi đỏ), đúng người đăng, ở cả nhóm và trang cá nhân. Hệ thống chỉ có bằng chứng "thấy bài mới xuất hiện", chưa tự kiểm thứ tự ảnh trong bài đã đăng.
- **Dọn dẹp cần người dùng:** tự xóa 2 bài thử trên Facebook (nhóm và trang cá nhân công khai). Trong ứng dụng có thêm máy "Máy thử P10 (xóa sau)" và 3 job (1 lỗi trước gửi, 2 đã đăng) — dữ liệu thử, có thể ẩn bằng "Ngừng bán".
- **Giới hạn:** mỗi kênh mới 1 lần thành công; chỉ nick quản trị; chưa thử chờ duyệt/từ chối; chưa thử sau khi khởi động lại máy; chưa thử đăng hai nhóm liên tiếp qua hàng chờ thật (giãn cách) hoặc hai tài khoản.
- **Tiếp theo:** người dùng đối chiếu và xóa bài thử → tick P08.8; P11 (đối chiếu `unknown`, nhật ký, sao lưu); P10.5/P10.9.

## 2026-10-28 15:00 — P08.8: người dùng xác nhận đã thấy bài thử

- **Người dùng báo:** "vào nick phụ thấy đăng rồi" — xác nhận bằng mắt rằng bài thử đã được đăng (cho nick phụ `phu1`).
- **Mức xác nhận được ghi nhận:** bài thử có xuất hiện. **Chưa** có xác nhận riêng về: thứ tự ảnh (xanh rồi đỏ), đủ 2 dòng nội dung, và việc bài ở nhóm `1357510931662685` (người dùng chỉ nhắc nick phụ). P08.8 vì vậy vẫn để mở, ghi rõ trong `plan.md`.
- **Việc người dùng còn lại:** tự xóa các bài thử trên Facebook (trang cá nhân công khai và bài ở nhóm).
- **Tiếp theo:** P11 (đối chiếu job `unknown`, nhật ký hoạt động, sao lưu) hoặc P10.5/P10.9; thử thêm các tình huống chưa có (hai nhóm liên tiếp qua hàng chờ thật, sau khi khởi động lại máy, nick không phải quản trị).

## 2026-10-28 15:01 — P11 + P10.5 + P10.9: đối chiếu job unknown, nhật ký/chi tiết, sao lưu-phục hồi, cấu hình đăng thường dùng, xem trước tác động khi sửa/bán máy

- **Yêu cầu người dùng:** "P11: đối chiếu job unknown, nhật ký hoạt động, sao lưu … P10.5 và P10.9: lưu cấu hình đăng thường dùng, và máy sửa hoặc đã bán thì phản ánh vào bài đã xếp". Không push (chỉ commit trên máy).
- **Đã làm:**
  - **Đối chiếu (P11.2/P11.3):** `reconcile()` trong `job-repository.ts` chỉ cho job `unknown`/`pending_approval` đã có mốc gửi; nguồn luôn `manual`; thêm quan sát mới (giữ quan sát cũ); "chưa đăng" → `failed` (lý do `confirmed_not_posted`); URL có userinfo/khóa bí mật bị từ chối; không có đường đưa về hàng chờ để gửi lại. API `POST /api/jobs/:id/reconcile`.
  - **Lịch sử/chi tiết (P11.1):** `job-query.ts` viết lại (`list` có lọc máy/tài khoản/đích/giờ/trạng thái/mã job; `detail` có caption và ảnh theo thứ tự của BẢN ĐÃ DUYỆT, từng lần thử, quan sát, nhật ký). `GET /api/jobs/:id`. `JobsPage.tsx` viết lại: bộ lọc, panel chi tiết, đối chiếu hai bước xác nhận, thông báo máy đã sửa/đã bán.
  - **Crash (P11.4):** khóa `worker.lock` — bản worker thứ hai bị từ chối, khóa mồ côi tự dọn (`apps/worker/src/index.ts`).
  - **Sao lưu/phục hồi (P11.5–7):** `packages/storage/src/backup.ts` (`createBackup`/`verifyBackup`/`restoreBackup`), `scripts/backup.ts`, `scripts/restore.ts`, npm `backup`/`restore`, tài liệu `docs/backup.md`. Phục hồi vào thư mục tạm, kiểm tra xong mới thay; dữ liệu cũ đổi tên không xóa; job chờ → tạm dừng; tài khoản → `login_required`; không chứa profiles/secrets/logs. Sửa lỗi thật phát hiện khi chạy script: Windows không đổi tên đè lên thư mục đích rỗng (do bước kiểm tra khóa worker tạo sẵn) → xóa thư mục rỗng trước khi đổi tên + test hồi quy.
  - **Chẩn đoán (một phần P11.8):** `diagnostics.ts` + `npm run diagnostics` — chỉ số đếm/mã trạng thái/kích thước.
  - **P10.5:** `caption-template.ts` (domain; dòng thiếu dữ kiện tự bỏ; chỗ trống lạ như `{gía}` bị bắt khi lưu và không bao giờ in ra bài), `preset-repository.ts`, `presets-api.ts` (`/api/presets`, ngừng dùng bằng `POST .../archive`), `PresetPanel.tsx` gắn vào trang Đăng bài viết nhóm; `post-plan.ts` thêm `presetSelection`, `nextDailyStart`, `toVnLocal`.
  - **P10.9:** `GET /api/products/:id/impact` (`productImpact`), `product-impact.ts`, hộp xác nhận ở `ProductsPage.tsx` khi lưu bản sửa/đổi trạng thái mà có bài chưa gửi/đang chạy bị ảnh hưởng.
- **Quyết định/phát hiện đáng nhớ:**
  - Hậu quả thật của sửa/bán máy (đọc từ `invalidateProduct`): sửa → job chưa gửi thành `needs_review`; bán/ngừng bán → job chưa gửi bị HỦY; job đang chạy chỉ bị yêu cầu dừng; job đã có kết quả không đổi. Văn bản xem trước bám đúng điều này (đã có test đối chiếu xem trước với kết quả thực).
  - Ngừng dùng cấu hình dùng `POST`, không `DELETE`: client luôn gửi `Content-Type: application/json` cho thao tác ghi, `DELETE` không body bị Fastify trả 400.
  - Lỗi có sẵn từ trước được sửa: điền lại caption mẫu khi đổi máy/mẫu không chạy vì hàm cập nhật state đọc `lastTemplate.current` sau khi nó đã bị gán giá trị mới.
- **Kiểm tra (lệnh đã chạy → kết quả thật):**
  - `npm run check` (typecheck + lint + test + build:web) → **222/222 test đạt**, lint 142 file sạch, build web đạt.
  - Test mới: `job-reconcile.test.ts` 3, `backup.test.ts` 5, `diagnostics.test.ts` 2, `preset-repository.test.ts` 3, `caption-template.test.ts` 3, `post-plan.test.ts` +2, `product-impact.test.ts` 2, `single-instance.test.ts` 1, `data-api.test.ts` +2 (API P11 và API preset/impact).
  - Chạy thật trên trình duyệt (Edge ngầm, chế độ MÔ PHỎNG, dữ liệu tạm, không worker, không chạm Facebook; đã xem ảnh chụp, đã tắt server/web và xóa script tạm): (1) caption theo mẫu bỏ đúng dòng thiếu dữ kiện; lưu cấu hình không tạo job; tải lại trang rồi áp dụng → chọn đúng 2 nhóm, điền tài khoản; danh sách nhóm chỉ gọi 1 lần (không lặp); (2) sửa máy khi có 4 job chờ → hộp xác nhận nêu đúng; "Quay lại" không lưu; "Vẫn tiếp tục" → phiên bản 2 và cả 4 job thành "Cần xem lại" đúng như báo trước; (3) job `unknown` (giả lập worker bằng repository) → Chi tiết hiện caption/ảnh bản duyệt, không có nút Hủy/chạy lại, đối chiếu "chưa đăng" → `failed`, lịch sử `unknown/fake` rồi `not_found/manual`. Lỗi 404 duy nhất ở console là `/favicon.ico` của vite dev.
  - `npm run backup` / `restore` chạy thật trên dữ liệu tạm: sao lưu, `--verify-only`, phục hồi sang thư mục mới, từ chối đè khi thiếu `--replace`, `--replace` giữ bản cũ đổi tên; backup vào trong repo bị từ chối.
- **Chưa kiểm tra / giới hạn:** chưa chạy backup/restore trên dữ liệu thật của người dùng; chưa thử mất điện hay kill giữa lúc đăng thật; đối chiếu chỉ qua xác nhận thủ công (chưa có verify chỉ đọc tự động); trang cá nhân và fanpage chưa dùng cấu hình thường dùng; "hằng ngày" chỉ điền sẵn giờ hẹn kế tiếp khi áp dụng (chưa có bộ lập lịch tự lặp); P11.8 mới có chẩn đoán lọc bí mật, chưa có cơ chế thu ảnh chụp/trace có bật rõ và hạn lưu (ứng dụng chưa thu loại này); P11.9 chưa làm. Nhật ký hoạt động trong chi tiết job trống khi job không đi qua worker thật (chỉ lúc đối chiếu mới ghi `job_reconciled`).
- **Tiếp theo:** (1) người dùng chạy thử `npm run backup` trên dữ liệu thật và cất bản sao lưu ra ổ khác; (2) P11.9 nhập tay nguồn khách hỏi/đơn hàng; (3) cơ chế thu ảnh chụp/trace có bật rõ + hạn lưu (nếu cần); (4) dùng cấu hình thường dùng cho trang cá nhân; (5) P08.8 còn mở (thứ tự ảnh/nhóm cần người dùng xác nhận), P09/P10.4 fanpage cần Meta app; (6) cuối ngày, khi người dùng nói, mới `git push` một lần.

## 2026-10-28 15:29 — P11.8 + P11.9: ảnh chụp chẩn đoán có bật rõ và hạn lưu; nhập tay khách hỏi/đơn hàng

- **Yêu cầu người dùng:** triển khai phần còn lại của P11 (P11.8, P11.9) và cho biết P08.8 cần người dùng xác nhận gì. Không push.
- **Đã làm:**
  - **P11.8 (nửa còn lại):** `packages/integrations/browser/src/diagnostic-capture.ts` (`createDiagnosticCapture`: chụp PNG, tên file chỉ gồm thời điểm + 8 ký tự mã job + mã lý do đã làm sạch, hạn lưu, tối đa 100 ảnh, `purgeExpired`/`purgeAll`/`stats`, không bao giờ ném lỗi); `getDiagnosticCapture()` trong `#config` (`APM_DIAG_CAPTURE` chỉ nhận `on`/`off`, tắt mặc định; `APM_DIAG_RETENTION_HOURS` 1–168, mặc định 24); adapter `composer-publisher.ts` nhận hook `diagnostics` tùy chọn và chụp khi `prepare` dừng vì lỗi (trừ `stopped`) hoặc `submit` ra `unknown`; worker bật hook chỉ khi `APM_DIAG_CAPTURE=on`, ghi cảnh báo to, dọn ảnh quá hạn khi khởi động và mỗi 10 phút (kể cả khi đã tắt thu); `npm run diagnostics -- --purge-captures`; thư mục `diagnostics` bị loại khỏi sao lưu; báo cáo chẩn đoán đếm số ảnh (không đưa nội dung/tên file). **Không có trace**: trace Playwright chứa cả cookie/header nên cố ý không hỗ trợ.
  - **P11.9:** migration `0005_sales_events.sql` (bảng `sales_events`, trigger: bài nguồn phải thuộc đúng máy, chỉ được đánh dấu hủy một lần, không xóa); `sales-repository.ts` (ghi nhận, lọc, tổng hợp theo máy/nơi đăng, hủy); `sales-api.ts` (`/api/sales-events`, `/summary`, `/:id/void` dùng POST vì client luôn gửi JSON); trang `SalesPage.tsx` ("Khách hỏi và đơn hàng" trong nav) + `sales-form.ts` (kiểm tra form thuần).
  - Tài liệu: `docs/environment.md` (2 biến mới), `docs/data-model.md` (bảng mới), `docs/backup.md`.
- **Kiểm tra (lệnh đã chạy → kết quả thật):**
  - `npm run check` (typecheck + lint + test + build:web) → **238/238 test đạt**, lint 150 file sạch, build web đạt.
  - Test mới: `diagnostic-capture.test.ts` 4, `composer-publisher.test.ts` +3 (Facebook giả trên Edge ngầm: chụp PNG thật khi `ui_changed` và `unknown_after_submit`, không chụp khi đăng thành công/dừng chủ động, hook ném lỗi không đổi kết quả), `config` +1, `sales-repository.test.ts` 3, `sales-form.test.ts` 4, `data-api.test.ts` +1, `diagnostics.test.ts` mở rộng, `backup.test.ts` mở rộng (loại `diagnostics`).
  - Chạy thật trên trình duyệt (Edge ngầm, MÔ PHỎNG, dữ liệu tạm, không worker, không chạm Facebook; đã xem ảnh chụp, đã xóa script tạm): ghi khách hỏi có bài nguồn + đơn hàng 9.500.000 đ không rõ nguồn; tổng hợp theo máy/nơi đăng đúng; "Hủy ghi nhận" hai bước, dòng vẫn còn trong dữ liệu; trang không gọi ra ngoài máy; không lỗi trang.
- **Lỗi/phát hiện trong lượt này:** migration 0005 làm đổi số phiên bản schema nên 7 chỗ test gán cứng `4` phải sửa (đã chuyển `backup.test.ts` sang đọc phiên bản mới nhất từ `loadMigrations()`). Test `tests/e2e/local-api.test.ts` ban đầu báo `ENOTEMPTY` khi dọn thư mục — lỗi thật bị che là `schemaVersion 5 !== 4`; thư mục sót là `vite-cache/deps_temp_*` do Vite còn chạy nền lúc test thoát sớm. Đã sửa giá trị gán cứng và thêm `maxRetries`/`retryDelay` cho `rmSync` (biện pháp phòng thủ, chưa chứng minh là cần thiết riêng).
- **Chưa kiểm tra / giới hạn:** chưa chụp ảnh trên một lỗi đăng THẬT (chưa có lỗi thật nào xảy ra khi bật); số khách hỏi/đơn chưa hiện trong chi tiết job; chưa xuất CSV; số liệu bán hàng chỉ là số người dùng nhập; chưa thử backup/restore trên dữ liệu thật; chưa thử mất điện/kill giữa lúc đăng thật.
- **P08.8 (cần người dùng):** xác nhận bằng mắt trên Facebook — (1) bài ở nhóm `1357510931662685` có xuất hiện không; (2) trong bài có đúng 2 ảnh theo thứ tự xanh rồi đỏ; (3) nội dung đúng 2 dòng caption mẫu; (4) đúng người đăng (nick phụ `phu1`) ở cả nhóm và trang cá nhân. Chỉ khi đủ mới tick.
- **Tiếp theo:** P08.8 sau khi người dùng xác nhận; P09/P10.4 fanpage (cần Meta app); P03/P06/P01 còn nhiều mục làm dở; P12 kiểm thử tổng thể/bàn giao; dùng cấu hình thường dùng cho trang cá nhân; cuối ngày khi người dùng nói mới `git push` một lần.

## 2026-10-28 15:46 — P08.8: người dùng xác nhận thấy bài ở cả nhóm và trang cá nhân

- **Người dùng báo:** "đã thấy của cả trong nhóm và TCN đã đăng rồi".
- **Mức xác nhận được ghi nhận:** bài thử có xuất hiện ở cả nhóm `1357510931662685` và trang cá nhân nick phụ. **Chưa** có xác nhận riêng về thứ tự ảnh (xanh rồi đỏ), đủ 2 dòng nội dung, và đúng người đăng, nên P08.8 vẫn để mở trong `plan.md` (đã ghi chú).
- **Việc người dùng còn lại:** tự xóa các bài thử trên Facebook (nhóm và trang cá nhân).
- **Tiếp theo:** khi người dùng xác nhận nốt ba điểm trên thì tick P08.8; sau đó P12, hoặc làm dở P03/P06/P01, hoặc fanpage (cần Meta app).

## 2026-10-28 16:27 — P12: launcher Windows, phục vụ UI cục bộ, cập nhật an toàn, nghiệm thu và hướng dẫn (P08.8 đạt)

- **Yêu cầu người dùng:** xác nhận P08.8 đạt ("cái này t confirm ok rồi") và "triển khai P12 (kiểm thử tổng thể và bàn giao)". Không push (chỉ commit trên máy).
- **Đã làm:**
  - **P08.8 tick** theo xác nhận của người dùng (nội dung, thứ tự ảnh, người đăng ở cả nhóm và TCN).
  - **P12.4 phục vụ UI cục bộ:** `apps/server/src/static-ui.ts` (`APM_SERVE_WEB=on`): chỉ `/` và file phẳng trong `/assets/` theo danh sách đuôi, CSP, nosniff, không `.map`, không thoát đường dẫn; vẫn qua kiểm tra Host/Origin.
  - **P12.3 launcher Windows:** `scripts/launch.ts` (`npm start`, `Auto-Post-MKT.cmd`; `--check`, `--no-open`) + `packages/ops/src/preflight.ts` (Node, thư viện, bản build, thư mục dữ liệu ghi được, cổng — phân biệt "đã đang chạy" với chương trình khác —, Edge, worker đang chạy). Tự build giao diện nếu thiếu, chỉ bật chế độ thật khi `APM_INTEGRATIONS=live`. Thêm `APM_LOG_LEVEL` (launcher mặc định `warn`).
  - **P12.2 vòng đời:** `packages/ops/src/parent.ts` + `APM_PARENT_PID`: server/worker tự dừng khi launcher biến mất; test tiến trình thật `tests/e2e/launcher.test.ts` và `tests/e2e/lifecycle.test.ts`.
  - **P12.5 cập nhật an toàn:** `packages/ops/src/update.ts` + `scripts/update.ts` (`npm run update`, `Cap-nhat-Auto-Post-MKT.cmd`).
  - **P12.1/6/8:** `docs/nghiem-thu.md` (ma trận T01–T18 có bằng chứng và giới hạn), `docs/huong-dan.md`, README mục 11 viết lại, `docs/environment.md`.
- **Lỗi thật tìm ra khi làm:** (1) `createBackup` lỗi `no such table: media` khi sao lưu DB còn schema cũ — đúng tình huống "sao lưu trước khi cập nhật" — đã sửa và có test; (2) thông báo preflight mất dấu `\` trong `%LOCALAPPDATA%\AutoPostMKT` (lint báo `noUselessEscapeInString`); (3) test launcher từng treo do test dựng server TCP "bận" không đóng kết nối thăm dò (lỗi của test, không phải sản phẩm); (4) cuộc đua trong test: server phục vụ trang trước khi launcher in dòng "Đang chạy tại".
- **Phát hiện hành vi:** khi launcher bị giết đột ngột, server và worker chết trong dưới 1 giây vì ống ghi log bị đứt (worker có thể để lại khóa mồ côi, hệ thống tự dọn ở lần sau); `APM_PARENT_PID` là lớp dự phòng cho trường hợp chúng không ghi log.
- **Kiểm tra (lệnh đã chạy → kết quả thật):**
  - Cổng tổng `npm run check` chạy trên **đúng trạng thái sẽ commit** (xuất chỉ mục ra thư mục sạch, không có phần dở của phiên khác): typecheck đạt, lint 163 file sạch, **260/260 test đạt**, build web đạt. Ngay trước đó, trên thư mục làm việc, các test mới đều đạt (launcher 2, lifecycle 2, static-ui 3, ops 14, config 7).
  - Chạy thật bằng `Auto-Post-MKT.cmd` từ `...\Thử Nghiệm Có Dấu\Auto Post MKT` (dữ liệu cũng ở thư mục có dấu): `--check` đạt, khởi động đạt, `GET /` 200 `text/html`, `/api/health` worker sống; đã tắt và dọn. `node scripts/update.ts` trong repo đang có thay đổi chưa commit → dừng đúng ở bước chặn, chưa đụng gì.
  - Sự cố khi dọn: lệnh `Remove-Item -Recurse` trên thư mục thử có junction `node_modules` làm thư mục thử bị khóa; đã kiểm tra `node_modules` của dự án còn nguyên (`npm ls` đủ 14 gói) và dọn lại bằng cách tắt đúng tiến trình theo cổng.
- **Làm việc song song:** trong lượt này phát hiện một phiên khác đang làm quét nhóm đã tham gia (P06: `JoinedScanPanel.tsx`, `joined-scan*.ts`, migration `0006_joined_scans.sql`, `joined-groups.ts`...) trong cùng thư mục làm việc và chưa xong (lỗi lint của họ). Tôi **không đụng và không commit** các file đó; commit này chỉ chứa phần của tôi, dựng từ HEAD + thay đổi của tôi cho các file dùng chung (`app.ts`, `worker/index.ts`, `plan.md`, `README.md`) và kiểm chứng riêng bằng cách xuất chỉ mục ra thư mục sạch rồi chạy `npm run check`. Các test gán cứng phiên bản schema đã được phiên kia đổi sang đọc động nên không vỡ khi có migration 0006.
- **Chưa làm / giới hạn:** **P12.7** (một chu trình thật qua launcher, cần người dùng chọn tài khoản/đích); chưa chạy `npm run update` trọn vẹn trên bản cài thật (cần kho từ xa); chưa thử trên máy sạch chưa cài Node/Git; chưa có người ngoài đọc thử hướng dẫn; chưa thử mất điện/kill giữa lúc đăng thật. Chưa bàn giao đủ phạm vi vì fanpage chưa làm.
- **Tiếp theo:** (1) P12.7 khi người dùng chọn tài khoản/đích: chạy `Auto-Post-MKT.cmd` ở chế độ thật, một chu trình theo các bước ở `docs/nghiem-thu.md`; (2) fanpage (P09/P10.4) cần Meta app; (3) hoàn tất quét nhóm (P06) ở phiên kia rồi cập nhật hướng dẫn/README mục "chưa bàn giao"; (4) cuối ngày, khi người dùng nói, mới `git push` một lần.

## 2026-10-28 16:27 — P06 joined scan trong ứng dụng + P10 chọn số nhóm muốn đăng

- **Yêu cầu:** triển khai quét nhóm đã tham gia trong app và nhập số nhóm muốn đăng (ví dụ 30) cho một máy; vẫn xem trước/duyệt trước khi xếp lịch. Không mở Facebook thật trong lượt này.
- **Đã làm:**
  - `packages/integrations/browser/src/joined-groups.ts`: đọc trang nhóm đã tham gia bằng hồ sơ tài khoản, kiểm tra phiên/danh tính, cuộn có giới hạn, loại trùng, lưu tiến độ mỗi vòng; không tham gia/đăng bài. Dừng khi đạt giới hạn, không thấy nhóm mới, hết lượt, cảnh báo/mất phiên/hủy/lỗi; luôn ghi kết quả một phần. Luôn đóng profile.
  - Migration `0006_joined_scans.sql`, `joined-scan-repository.ts`, `apps/worker/src/joined-scans.ts`: hàng chờ scan bền, một scan active mỗi tài khoản, chủ xử lý/heartbeat/cancel, giữ kết quả khi lỗi/dừng, worker mất -> partial/worker_lost, không resume tự động. Dùng chung browser lease nhưng owner riêng cho scan, không tranh profile với đăng/login. Ghi nhóm + quan sát trong cùng transaction; chỉ nhập ID số, đếm slug riêng; giữ quyền/nội quy/ưu tiên đã có, không đổi nhóm vắng thành đã rời. Không tự cấp quyền đăng. Worker chỉ nối scanner thật khi live + browser real.
  - `groups-api.ts`: GET/POST `/api/accounts/:accountId/joined-scan`, POST `/api/joined-scans/:id/cancel`; strict schema/CSRF, kiểm tra mode/worker/danh tính; không trả profile path/tham chiếu danh tính và không tạo job đăng.
  - `JoinedScanPanel.tsx` trong `GroupsPage.tsx`: chọn tài khoản, giới hạn 1–1000, quét/dừng, tiến độ, mã lý do và hướng dẫn xác nhận quyền đăng.
  - `group-selection.ts` + `PostGroupPage.tsx`: nhập 1–100 nhóm, chọn nhóm đủ điều kiện trong bộ lọc hiện tại; ưu tiên preferred rồi tên/id, không trùng/không mượn quyền tài khoản khác, báo số thiếu và thay lựa chọn cũ. Chọn không tạo job; xóa xác nhận live cũ, vẫn preview/duyệt. Giữ luồng một đích một job hiện có.
  - Tài liệu: `docs/joined-groups.md`, README trạng thái đầu trang, `docs/data-model.md`, plan P06/P10. Các mục nghiệm thu joined thật vẫn để mở.
- **Kiểm tra thật:**
  - Typecheck đạt; lint 174 file đạt; build:web đạt (47 module).
  - 11 test mới đã đạt qua các lượt: chọn số lượng 2, worker/repository 4, API 1, scanner trên Facebook giả/Edge headless 3, UI end-to-end 1. Facebook giả chặn toàn bộ mạng ngoài; không mở profile hoặc đăng Facebook thật.
  - UI offline end-to-end: bấm quét -> lưu 40 nhóm; quyền mới vẫn unknown; sau khai báo quyền, nhập 30 -> preview 30 -> duyệt -> đúng 30 job queued. Không khởi động publisher; DB/media/profile giả đều tạm. Không pageerror.
  - Gate `npm.cmd run check` chạy ngoài sandbox (test dùng dữ liệu tạm/fake) -> 268/271 đạt, 3 lỗi: 2 test schema cũ gán cứng v5 và 1 test launcher P12 (`tests/e2e/launcher.test.ts:104`, worker không dừng khi mất launcher). Hai test DPAPI thật đều đạt trong lượt này. Do test fail nên build trong chuỗi check chưa chạy; đã chạy build:web riêng đạt.
  - Đã sửa các kỳ vọng schema sang `loadMigrations()`; chạy lại regression schema/migration + API/worker/selection -> 30/30 đạt. Sau khi siết heartbeat/finish bằng UPDATE có điều kiện chủ xử lý, chạy lại 7/7 test API/worker/selection đạt. Chưa chạy lại gate toàn bộ; lỗi launcher là phần P12 đang thay đổi trong checkout, không sửa ngoài phạm vi lượt này.
- **Giới hạn/nghiệm thu còn lại:** chưa quét thật qua giao diện mới trên tài khoản người dùng đã chọn, chưa đăng thật 30 nhóm; nhóm chỉ có slug chưa làm giàu ID, keyword/fanpage chưa thuộc phạm vi. Quyền bán hàng do người dùng khai báo sau khi kiểm tra nội quy. Số chọn là số tác vụ, không cam kết số bài published.
- **Working tree:** đầu lượt đã có nhiều thay đổi P12/launcher chưa commit; chúng tiếp tục được cập nhật trong lúc làm. Giữ nguyên các thay đổi đó, chỉ nối scanner vào các file dùng chung; chưa commit/push để tránh gom nhầm công việc đang dở.
- **Tiếp theo:** nghiệm thu đọc nhóm thật bằng tài khoản được chọn, đối chiếu vài nhóm và điều kiện dừng; giải quyết gate launcher của P12; sau đó commit theo phạm vi và push khi người dùng yêu cầu.

### Cập nhật chốt kiểm tra P06/P10 — 2026-10-28 16:32

- Sau khi phần P12 được lưu riêng ở commit eee44bb và các kỳ vọng schema được cập nhật, chạy lại `npm.cmd run check` trên toàn bộ trạng thái tích hợp -> **271/271 test đạt**, 28 suite, không skip; typecheck/lint 174 file đạt, build:web 47 module đạt. Test launcher dừng worker khi mất launcher đã đạt ở lượt chạy lại (10,2 giây); không còn blocker gate ở trạng thái này.
- Đã cập nhật hướng dẫn và bảng nghiệm thu P12 để trỏ sang chức năng joined mới. Kiểm tra `git diff --cached --check` đạt; chỉ stage 32 file thuộc lượt quét/chọn số lượng và tài liệu/kiểm thử tương ứng. Phần P12 đã có commit riêng, không gộp vào commit này.
- Lưu commit riêng trên máy sau gate; không push. P06.2/P06.4/P06.8 vẫn mở phần nghiệm thu Facebook thật; chức năng mới đã triển khai và kiểm chứng offline, không tuyên bố đã thử thật 30 nhóm.

## 2026-10-28 16:38 — P12.7: nghiệm thu một chu trình THẬT qua launcher (nick phụ phu1 → nhóm 1357510931662685)

- **Người dùng cho phép rõ cho lượt này:** nick phụ `phu1` đăng MỘT bài vào nhóm `1357510931662685`, qua launcher ở chế độ thật. (Người dùng cũng chọn làm fanpage; chưa bắt đầu, xem Tiếp theo.)
- **Cách làm:** chạy từ bản xuất sạch của commit `eee44bb` (đã kiểm chứng), không chạy từ thư mục làm việc vì khi đó có migration 0006 dở của phiên khác có thể làm hỏng dữ liệu thật. Sao lưu và kiểm tra dữ liệu thật trước; `APM_INTEGRATIONS=live node scripts/launch.ts`; điều khiển trang "Đăng bài viết nhóm" bằng Edge ngầm (chọn đúng 1 nhóm, tick xác nhận THẬT, gửi một lần, không thử lại).
- **Kết quả:** `published` sau ~43 giây, ID `2307345636679205`, liên kết bài, nguồn `ui_observation`, 2 ảnh, 1 lần thử, nhật ký `send_started` → `job_published`. Giết launcher đột ngột: server/worker/Edge dừng trong 12 giây, khóa mồ côi còn sót. Mở lại: không bị khóa chặn, tổng job vẫn 4 (3 đã đăng + 1 lỗi cũ), bài vừa đăng vẫn 1 lần thử, không đăng lại. `npm run backup` khi đang chạy + `--verify-only` + phục hồi sang thư mục tạm đạt (schema v5, 2 ảnh, "1 tài khoản cần đăng nhập lại").
- **Lỗi tìm ra và đã sửa:** `scripts/backup.ts` tự chạy `migrate` trước khi sao lưu, nên dữ liệu thật bị nâng v4 → v5 ngay ở bước sao lưu đầu tiên và không còn bản sao lưu ở schema cũ (migration 0005 chỉ thêm bảng nên không ảnh hưởng dữ liệu cũ; tôi đã nói ngay với người dùng). Sửa: script chụp nguyên trạng, không bao giờ migrate; báo lỗi rõ nếu chưa có DB. Test hồi quy `tests/e2e/backup-script.test.ts` (chạy script thật trên DB schema v1: DB vẫn v1, bản sao lưu v1).
- **Kiểm tra:** `tests/e2e/backup-script.test.ts` 2/2 đạt, typecheck + lint sạch. Cổng tổng `npm run check` trên trạng thái hiện tại: typecheck đạt, lint 175 file sạch, **273/273 test đạt**, build web đạt (đã gồm commit quét nhóm của phiên khác).
- **Dọn dẹp:** đã tắt launcher, gỡ junction `node_modules` bằng `rmdir` (không đệ quy), xóa bản chạy tạm; `node_modules` dự án còn nguyên (83 thư mục). Có 2 bản sao lưu mới trong `%LOCALAPPDATA%\AutoPostMKT\backups` (`20261028093358` ở schema v5 sau migrate, `20261028093713` hợp lệ).
- **Giới hạn:** giao diện do tôi điều khiển (chưa phải người dùng tự bấm); chưa thử đóng giữa LÚC đang gửi trên Facebook thật (cố ý; đã có test worker thật); chưa đối chiếu một job `unknown` thật; một nhóm, một nick.
- **Việc người dùng:** tự xóa bài thử mới `https://www.facebook.com/groups/1357510931662685/posts/2307345636679205` và các bài thử cũ; dữ liệu thật hiện ở schema v5 (phiên quét nhóm sẽ nâng tiếp lên v6 khi chạy).
- **Tiếp theo:** **fanpage (P09/P10.4)**: cần người dùng tạo ứng dụng Meta (miễn phí) và là quản trị Page; tôi hướng dẫn từng bước, người dùng tự đăng nhập, không gửi mật khẩu/mã cho tôi; cần chốt Page nào, kiểm chứng phiên bản Graph API và quyền thật trước khi viết. Sau đó P12 đủ phạm vi.

## 2026-10-28 16:56 — Gom dữ liệu vận hành vào cùng folder dự án (ADR 0012)

- **Yêu cầu trực tiếp:** người dùng muốn toàn bộ code và dữ liệu của Auto Post MKT nằm trong `D:\project\Auto_Post_MKT`, thay vì dữ liệu ở AppData. Yêu cầu này thay thế quy định vị trí dữ liệu ngoài repo trước đây; vẫn không đưa dữ liệu riêng tư vào Git.
- **Đã thay đổi:**
  - `#config.getDataDir()` mặc định `<project>/data`, suy root từ vị trí module, không phụ thuộc cwd hoặc LOCALAPPDATA. `APM_DATA_DIR` vẫn ghi đè; đường dẫn tương đối theo project root. Trong repo chỉ cho data và con, chặn root/.git/mã nguồn/data-other. Test tiếp tục dùng tmp riêng.
  - MediaStore/SecretStore dùng chung quy tắc vị trí mới cả trước và sau realpath; giữ UUID/hash, symlink guards, DPAPI CurrentUser và ACL. Backup mặc định được phép vào `data/backups`, vẫn chặn thư mục mã nguồn. Cache Vite cũng theo dataDir tại `data/cache/vite`.
  - Git bỏ qua `data/`, `local-backups/`, `data.relocating-*`, `data.restoring-*`, `data.before-restore-*`; kiểm tra cả Cookies/ảnh trong vùng restore để không lộ dữ liệu sau đổi tên thư mục.
  - Cập nhật `.env.example`, CLAUDE, README, plan, hướng dẫn vận hành/backup/environment, ADR 0012 và ghi chú thay thế vị trí trong ADR 0001/0008/0009. Không sửa migration cũ.
- **Chuyển dữ liệu thật (đã thực hiện):**
  - Xác nhận không có server/worker/Edge profile dự án đang chạy, cổng 4317/5173 không nghe; nguồn không có reparse point. Chưa mở Facebook hay gửi bài trong lượt này.
  - Nguồn cũ: `C:\Users\VIET_HS\AppData\Local\AutoPostMKT`.
  - Đích đang dùng: `D:\project\Auto_Post_MKT\data`; DB hiện tại: `data\db\development.sqlite`.
  - Bản dự phòng đầy đủ trước chuyển: `D:\project\Auto_Post_MKT\local-backups\pre-relocation-20261028-164658` (gồm hồ sơ đăng nhập/cache, khác backup thông thường). Đã so sánh danh sách và SHA-256 đủ **4.161 file / 727.311.354 byte** cho cả bản staged và bản dự phòng.
  - SQLite integrity_check=ok, foreign_key_check rỗng; giữ nguyên số dòng: 1 tài khoản, 82 đích đăng, 1 máy, 2 media, 4 job, 0 scan, 0 sales. Bản gốc v5 giữ trong local-backups; chạy `npm.cmd run db:migrate` ở đích mới nâng đúng migration 6, số dòng nghiệp vụ không đổi.
  - Chạy đọc lại bằng cấu hình mặc định: DB v6 integrity/FK đạt, 2 ảnh xác minh hash và API trả 200, 1 hồ sơ tài khoản còn tồn tại; API health/accounts/products/groups/jobs đều 200. Không mở trình duyệt tài khoản.
  - Sau khi kiểm lại bản dự phòng khớp đủ 4.161 file và đọc đích mới thành công, đã dọn **đúng** thư mục AppData nguồn cũ. Giữ hai bản dữ liệu trong project (data đang dùng + local-backups dự phòng), không xóa bản duy nhất. Không sửa cấu hình Windows toàn cục, PATH hay ExecutionPolicy; không cần tạo/sửa `.env` cục bộ.
- **Kiểm thử:**
  - Target config + MediaStore: 14/14 đạt, gồm mặc định project/data, đường dẫn tương đối theo root dù cwd đổi, chặn mã nguồn/.git/tên gần giống data.
  - `npm.cmd start -- --check` trên dữ liệu mới: toàn bộ preflight đạt, không khởi động server/worker.
  - `npm.cmd run backup`: tạo và xác minh bản thật `data/backups/20261028095039`, DB v6 + 2 ảnh. `npm.cmd run restore -- data/backups/20261028095039 --verify-only`: hợp lệ, không phục hồi đè.
  - `npm.cmd run check` ngoài sandbox để test ACL Windows đúng quyền; runner ép test/fake + DB tạm -> **275/275 test đạt**, 28 suite, typecheck đạt, lint 175 file đạt, build:web 47 module đạt. Không có đăng/quét Facebook thật.
  - `git check-ignore` xác nhận data/profile/media/backup và các vùng restore bị bỏ qua; dữ liệu không được stage/commit.
- **Giới hạn:** chỉ chuyển dữ liệu trên máy Windows hiện tại. Khi sang máy khác, DPAPI/phiên Facebook có thể cần đăng nhập/kết nối lại. Bản dự phòng local-backups giữ lại để quay về, chỉ xóa tay khi người dùng chắc chắn không cần.
- **Tiếp theo:** mở app như cũ bằng `Auto-Post-MKT.cmd` hoặc `npm start`; dữ liệu mặc định đã ở data. Lưu commit riêng cho thay đổi đường dẫn/tài liệu, chưa push.

## 2026-10-28 17:02 — P09.1/P09.2: kết nối fanpage qua Graph API (chỉ đọc), chưa đăng

- **Quyết định người dùng:** làm fanpage; người dùng có Page và tự tạo ứng dụng Meta theo hướng dẫn từng bước. Ứng dụng: loại Kinh doanh, chế độ Phát triển. Trong Graph API Explorer, `me/accounts` trả Page "Góc Nghiện Đồ Hay" (ID `107892312229541`, danh mục Trang phục & quần áo) với `tasks` gồm `CREATE_CONTENT`, `MANAGE`, `MODERATE`, `ADVERTISE`…: quyền và token đã thông trong chế độ Phát triển cho người dùng là quản trị.
- **Sự cố bí mật:** ảnh chụp màn hình người dùng gửi chưa che dòng `access_token` (khoảng 80 ký tự đầu của một Page token ngắn hạn, bị cắt ở mép ảnh). Token bị cắt không dùng được và vốn ngắn hạn; coi như đã lộ, KHÔNG dùng lại, lần nhập thật dùng token mới nhập thẳng vào terminal. Đã dặn người dùng che token trước khi chụp.
- **Đã làm (chưa đăng gì, chưa chạm dữ liệu thật):**
  - `packages/integrations/facebook-page/src/graph-client.ts`: đổi token ngắn hạn → dài hạn (bí mật ứng dụng trong thân POST), liệt kê Page (`me/accounts`, phân trang bằng con trỏ `after`, không đi theo `paging.next` vì URL đó chứa token), kiểm tra token Page chỉ-đọc. Token chỉ ở header `Authorization`/thân POST, không bao giờ trong URL; lỗi phân loại theo mã của Meta (`token_expired`, `permission_denied`, `rate_limited`, `temporary`, `network`…) và không chép nguyên văn thông báo; chỉ nói chuyện với `graph.facebook.com` (hoặc loopback khi test); `APM_GRAPH_VERSION`, mặc định `v23.0` chưa đối chiếu.
  - `connect-flow.ts`: luồng nhập App ID/App Secret/token (ẩn) → đổi token → liệt kê → chọn → kiểm tra → lưu; từ chối Page không có `CREATE_CONTENT`; không lộ bí mật ở bất kỳ đầu ra nào (test kiểm tra từng đầu ra).
  - `packages/storage/src/page-repository.ts`: `connect` (Page token → SecretStore DPAPI, DB chỉ tham chiếu; kết nối lại thay token và thu hồi token cũ), `list` (chỉ metadata + `canPost`), `revealToken` (chỉ nội bộ), `markChecked`, `disconnect` (lưu trữ + thu hồi token).
  - `scripts/page-connect.ts` (`npm run page:connect`, `--dry-run`, `--page-id`, `--app-id`): ẩn ký tự bí mật, từ chối nhận bí mật khi không có terminal thật, hỏi xác nhận nơi lưu (gõ `co`) trước khi ghi; không lưu App Secret hay token người dùng.
- **Kiểm tra (lệnh đã chạy → kết quả thật):** `graph-client.test.ts` 6, `connect-flow.test.ts` 6, `page-repository.test.ts` 5 (kho bí mật DPAPI thật; khẳng định token không nằm dạng rõ ở file DB/WAL/secrets) → đều đạt; typecheck sạch, lint sạch trên phần mới. Lệnh khi không có terminal: từ chối đúng. **Chưa chạy `npm run check` đầy đủ** trong lượt này (chỉ test phần mới). Nhập ẩn trong terminal thật mới chỉ kiểm bằng logic, chưa thử tương tác.
- **Làm việc song song:** phiên khác vừa commit "gom dữ liệu vào `data/`" (ADR 0012); tôi chỉ commit các file của mình bằng `git commit --only`, giữ nguyên phần staged của họ. Dữ liệu thật nay ở `D:\Project\Auto_Post_MKT\data` (schema v6, 3 job đã đăng + 1 lỗi cũ còn nguyên).
- **Chưa làm:** kết nối thật (cần người dùng chạy `page:connect` và tự nhập bí mật), API HTTP + giao diện danh sách Page (P09.2), upload ảnh bằng dữ liệu file (P09.3), đăng chữ/ảnh (P09.4), lịch + unknown (P09.5/6), gỡ Page dừng lịch (P09.7), đối chiếu tài liệu/phiên bản Meta (P09.8), trang đăng fanpage, bài thử thật lên Page.
- **Tiếp theo:** người dùng chạy `npm run page:connect` (một lần, tự nhập App Secret và token mới); sau đó thử đăng CHỮ một bài lên Page với sự cho phép riêng của người dùng cho đúng Page đó (bài công khai trên fanpage thật), rồi ảnh theo thứ tự.

## 2026-10-28 17:17 — Ước lượng tiến độ và mockup giao diện tham khảo

- **Yêu cầu:** báo mức hoàn thành dự án và tạo ảnh giao diện để người dùng tham khảo.
- **Đối chiếu:** plan P00–P13 và nhật ký mới nhất, gồm phần fanpage mới có Graph client/kết nối CLI nhưng chưa đăng trọn luồng. Ước lượng 80–85% cho bản đăng nhóm/TCN, 65–70% nếu tính mở rộng fanpage/keyword/LLM; không coi tỷ lệ checkbox là tỷ lệ hoàn thành hoặc nghiệm thu.
- **Đã tạo:** `docs/design/ui-concept-v1.png` bằng imagegen tích hợp; ảnh tham khảo desktop sáng/sidebar navy, chọn máy/tài khoản, quét nhóm, nhập 30, danh sách nhóm, preview caption/ảnh, lịch và nút duyệt. Dữ liệu minh họa, mô phỏng, fanpage sắp có; không thay mã giao diện hiện tại.
- **Kiểm tra:** đã xem ảnh tạo ra, các vùng chính và nhãn tiếng Việt thể hiện đúng ý tưởng; sao chép ảnh vào project. Brief/prompt thiết kế và phạm vi tiến độ lưu ở `docs/design/ui-concept-v1.md`. Không cần chạy test ứng dụng vì chỉ thêm ảnh/tài liệu, không đổi source hoặc dữ liệu vận hành.
- **Tiếp theo:** người dùng xem mockup và chọn điểm cần chỉnh; chỉ triển khai vào giao diện khi có yêu cầu. Không push.

## 2026-10-28 17:31 — P09: bộ đăng fanpage qua Graph API, hàng chờ, API, trang giao diện (đạt test với Graph giả; CHƯA đăng thật)

- **Yêu cầu người dùng:** "ok triển khai đi" (làm phần đăng fanpage). Trước đó: người dùng tạo ứng dụng Meta (Kinh doanh, chế độ Phát triển), `npm run page:connect` kết nối Page "Góc Nghiện Đồ Hay" (ID 107892312229541) thành công, chỉ đọc. Người dùng không nhập được bí mật trong ô ẩn nên cho phép đặt tạm trong `.env`; tôi không đọc `.env`, lệnh tự xóa hai dòng sau khi lưu (`.env` về 0 byte).
- **Phát hiện thiết kế:** hợp đồng đăng đã duyệt (`assertApprovedPublishRequest`) bắt buộc `mediaPaths` không rỗng, nên bài fanpage luôn có ảnh; vì vậy không có bước "đăng chữ" riêng, sẽ thử 1 ảnh rồi 2 ảnh.
- **Đã làm:**
  - `graph-client.ts`: thêm `uploadUnpublishedPhoto` (multipart `source`, `published=false`), `createFeedPost` (`attached_media[i]` theo thứ tự), `deletePhoto`, `listRecentPosts`; thời gian chờ cấu hình được.
  - `page-publisher.ts` (`createPagePublisher`): `prepare` kiểm tra Page+token (chỉ đọc), đọc/kiểm tra TẤT CẢ ảnh bằng chữ ký file trước khi tải ảnh nào, tải ảnh chưa xuất bản theo thứ tự (lỗi giữa chừng → xóa ảnh đã tải, dừng trước khi gửi); `submit` tạo bài ĐÚNG MỘT LẦN, mất kết nối/quá giờ/lỗi tạm thời/phản hồi lạ → `unknown` không gửi lại; lỗi rõ ràng → `failed`; token hết hạn/bị từ chối → báo kết nối để các job sau bị chặn; `verify` chỉ đọc; `stop` dọn ảnh chưa gửi.
  - Worker: `job-runner.ts` ghi nguồn bằng chứng `api_response` cho kênh Page; `publishers.ts`/`index.ts` đăng ký bộ đăng Page khi `APM_INTEGRATIONS=live` (token lấy từ kho bí mật khi cần).
  - `post-batch.ts`: `submitPage` (một bài/một Page, duyệt theo kết nối Page, chống bấm hai lần, tất cả hoặc không gì; tách `replay` dùng chung). `page-repository.ts`: `disconnect` hủy job chưa gửi, yêu cầu dừng job đang chạy, giữ job đã có kết quả (P09.7).
  - API `pages-api.ts`: `GET /api/pages` (chỉ metadata), `POST /api/page-posts`, `POST /api/pages/:id/disconnect`. Giao diện `PostPagePage.tsx` + `page-plan.ts`; kiểu `PageConnectionItem` chuyển sang `#domain`.
  - Tài liệu: `docs/fanpage.md` (cách hoạt động, bảng "đã/chưa đối chiếu với Meta" — P09.8), `huong-dan.md` mục Đăng fanpage, README mục 11, `nghiem-thu.md`, `plan.md`.
- **Kiểm tra (lệnh đã chạy → kết quả thật):** cổng tổng `npm run check` trên **đúng trạng thái commit** (xuất chỉ mục ra thư mục sạch, không có phần dở của phiên khác): typecheck đạt, lint 193 file sạch, **319/319 test đạt**, build web đạt. Test mới: `page-publisher.test.ts` 10 (máy chủ Graph giả qua HTTP thật: thứ tự ảnh, đúng một yêu cầu tạo bài trong 4 kiểu không rõ kết quả, token chỉ ở header, dọn ảnh), `graph-client.test.ts` 6, `connect-flow.test.ts` 6, `secret-input.test.ts` 4, `page-repository.test.ts` 5, `page-post.test.ts` 3, `page-job.test.ts` 3 (job live qua runner), `pages-api.test.ts` 3, `page-plan.test.ts` 4.
- **Lỗi/bài học trong lượt này:** (1) ô nhập ẩn không hiện gì nên người dùng không biết đã dán được chưa + terminal có thể gửi chuỗi điều khiển khi dán → đã hiện dấu `*` và bỏ chuỗi điều khiển (`secret-input.ts`); (2) dấu `\` trong regex (`\d`) bị mất khi ghi qua script heredoc — bắt kịp trước khi chạy và sửa bằng Edit; (3) test từng mất 45 giây vì thời gian chờ tạo bài cố định → cấu hình được; (4) test API dùng `Date.now()` làm giờ hẹn nên lần gửi lại khác nội dung (hệ thống từ chối đúng) → cố định giờ.
- **Sự cố bí mật trước đó:** ảnh chụp người dùng gửi chưa che ~80 ký tự đầu của một Page token ngắn hạn; đã coi là lộ, không dùng; lần kết nối thật dùng token mới.
- **Làm việc song song:** phiên khác đang thiết kế lại giao diện (`App.tsx` điều hướng mới, `Icon.tsx`, `post-plan.ts`), chưa commit. Tôi chỉ commit phần của mình; với `App.tsx` chỉ đưa vào đúng 2 dòng của tôi (dựng từ HEAD + 2 dòng); nav mới của họ đã có mục "Đăng fanpage" khớp với trang này.
- **Chưa làm / giới hạn:** **chưa đăng thật lần nào** nên chưa biết: chế độ Phát triển có đăng được không cần App Review, định dạng nhiều ảnh `attached_media[i]`, tải ảnh bằng file thay vì `url`, giới hạn ảnh (10 là ước lượng thận trọng), phiên bản `v23.0` còn được hỗ trợ không. Chưa thử trang "Đăng fanpage" trên trình duyệt. Chưa thử hàng chờ hiện tên Page ở trang Hàng chờ đăng.
- **Tiếp theo:** bài thử thật đầu tiên lên Page "Góc Nghiện Đồ Hay" (1 ảnh, rồi 2 ảnh) CẦN người dùng cho phép riêng cho đúng Page và nội dung (bài công khai trên fanpage thật, người dùng tự xóa sau); sau đó tick P09.1/P09.3/P09.4/P09.8/P10.4 theo kết quả thật và cập nhật `docs/fanpage.md`.

## 2026-10-28 17:35 — P09: bài thử THẬT đầu tiên lên fanpage (Góc Nghiện Đồ Hay) — Meta nhận bài

- **Người dùng cho phép rõ:** "Cho phép đăng một bài thử công khai lên đúng Page này" (Page "Góc Nghiện Đồ Hay", ID 107892312229541). Tôi giữ đúng phạm vi: MỘT bài, dùng máy thử có 2 ảnh để thử luôn trường hợp nhiều ảnh; nếu lỗi trước khi tạo bài thì sửa và gửi lại mà không tạo bài thứ hai (không xảy ra).
- **Chuẩn bị:** thêm mã lỗi SỐ của Meta và HTTP vào lý do dừng/thất bại (không chép nguyên văn thông báo của Meta) và để worker ghi lý do dừng ra log, vì trước đó nếu Meta từ chối thì không biết lý do (commit `8993595`, test +1). Chạy từ bản xuất sạch của commit `8993595` (không lẫn phần dở của phiên khác), trỏ vào dữ liệu thật `data/` bằng `APM_DATA_DIR`; sao lưu trước (schema v6, 3 ảnh, mã băm đạt).
- **Kết quả:** launcher chế độ THẬT, kiểm tra mọi mục [ĐẠT]; trang "Đăng fanpage" điều khiển bằng Edge ngầm (chọn Page, máy, tick xác nhận, gửi MỘT lần): `queued` → `running` → `published` sau ~14 giây, ID `107892312229541_1104216589257690`, liên kết bài, nguồn `api_response`, 2 ảnh, 1 lần thử, nhật ký `send_started` → `job_published`; tổng job 4 → 5 (đúng một job mới). Không có lỗi trong log worker.
- **Điều đã chứng minh bằng bài thật:** chế độ Phát triển đăng được (người dùng là quản trị app và Page, không cần App Review); Meta nhận ảnh tải bằng file (`source`, `published=false`) và định dạng `attached_media[i]`; trang giao diện chạy đúng trên trình duyệt thật.
- **Chưa xác nhận (cần người dùng nhìn bằng mắt):** bài hiển thị ĐỦ 2 ảnh, đúng thứ tự (xanh rồi đỏ), đúng nội dung 2 dòng, đúng là Page đăng, công khai. Vì vậy P09.3/P09.4/P10.4 CHƯA tick; P09.1 đã tick.
- **Chưa thử:** đăng 1 ảnh hoặc nhiều ảnh hơn; lỗi thật từ Meta (token hết hạn, bị từ chối); `unknown` thật; `verify` trên Page thật; giới hạn số ảnh.
- **Dọn dẹp:** tắt launcher; gỡ junction `node_modules` bằng `rmdir`; xóa bản chạy tạm; `node_modules` dự án còn nguyên (83 thư mục); `.env` 0 byte. Một bản sao lưu mới `data/backups/20261028103338`.
- **Việc người dùng:** xác nhận bằng mắt như trên và tự XÓA bài thử trên Page (liên kết `https://www.facebook.com/107892312229541/posts/1104216589257690`) cùng các bài thử cũ ở nhóm/TCN.
- **Tiếp theo:** sau khi người dùng xác nhận: tick P09.3/P09.4/P10.4, cập nhật nghiệm thu (T03 Page đạt); sau đó còn P09 phần thử lỗi thật, hoặc quay lại các mục làm dở (P03/P06/P01).


## 2026-10-28 17:43 — Áp dụng giao diện từ mockup v1 (shell + Đăng nhóm)

- **Yêu cầu:** triển khai giao diện người dùng đã chọn ở `docs/design/ui-concept-v1.png` vào ứng dụng đang chạy.
- **Phạm vi đã làm:**
  - `App.tsx`, `Icon.tsx`, `styles.css`: sidebar navy/icon SVG, điều hướng trực tiếp, breadcrumb, nhãn chế độ, trạng thái app và kiểu bảng/form/nút thống nhất. Menu thu gọn trên mobile; vùng bảng các trang khác có cuộn riêng. Giữ trang `PostPagePage` và route fanpage của phiên khác; fanpage là link chức năng, chỉ proxy/keyword còn ghi chưa có.
  - `GroupComposerView.tsx` + `PostGroupPage.tsx`: tách phần trình bày khỏi tải dữ liệu/gửi lệnh; chọn máy/tài khoản và nhóm bên trái, preview/lịch bên phải; bốn bước dẫn tới vùng trong trang. Quét joined mở ngay trong màn Đăng nhóm, dùng lại `JoinedScanPanel` và backend có sẵn, không tự quét/gửi khi mở trang.
  - Bảng nhóm cuộn, lọc theo tên/khu vực/nội quy, lọc chỉ đủ điều kiện, chọn số lượng 1–100, nhóm ưu tiên/tên, giữ quyền riêng theo nick. Chọn cả bộ lọc tối đa 100; frontend báo rõ nếu bản nháp chọn vượt 100 (server đã có giới hạn này).
  - Preview theo nhóm bằng dropdown (đủ 30 lựa chọn, thay vì 30 ô caption kéo dài): xem caption, ảnh đúng thứ tự, sửa riêng một nhóm hoặc mở caption chung. Tab nội dung/ảnh, thời gian hẹn, cấu hình đăng thường dùng thu gọn và nút Lưu cấu hình mở đúng form. Thanh duyệt dưới nội dung, không che bảng/lịch; kết quả từng nhóm giữ nguyên.
  - Khi sửa nội dung/tài khoản/máy/nhóm/lịch/mẫu hoặc áp dụng preset thì bỏ xác nhận đăng thật cũ; chưa đọc được chế độ thì không bật nút duyệt. Chặn phản hồi tải nhóm/máy cũ ghi vào bản nháp mới khi đổi nhanh. Giữ idempotency, bản nháp khi đổi trang và server-side readiness.
- **Kiểm chứng (kết quả thật):**
  - Target `npm.cmd test -- tests/e2e/group-count.test.ts apps/web/src/post-plan.test.ts apps/web/src/group-selection.test.ts` -> 10/10 đạt. UI Edge headless + server/Vite thật + DB/ảnh giả: quét 40, chọn 30, quét lại ngay trong composer, chỉnh caption riêng bắt xác nhận lại, hẹn giờ, lưu preset thật trong DB test, đổi trang vẫn giữ bản nháp, menu mobile, duyệt đúng 30 job với caption đúng. Không publisher hoặc mạng Facebook thật.
  - Kiểm tra desktop 1440px và mobile 390px không tràn ngang; đi qua máy/nhóm/TCN/fanpage/lịch sử/đơn hàng không pageerror. Đã mở và xem ảnh chụp desktop/mobile/empty, chỉnh thanh duyệt để không che bảng/lịch và ảnh để không crop mất nội dung máy.
  - `npm.cmd run check` (ngoài sandbox để DPAPI có quyền ACL; runner vẫn ép test/fake và dữ liệu tạm) -> **320/320 test đạt**, 28 suite, không skip; typecheck/lint 195 file đạt, build:web 51 module đạt. Bộ gate bao gồm cả phần fanpage đã commit ở phiên khác.
  - Các lỗi trong lúc làm đã sửa: TS của test phía Node không có DOM global (dùng biểu thức Playwright evaluate), nhãn/accessibility của vùng bảng/icon, một thông báo tiếng Việt bị PowerShell truyền qua ASCII khi cắt JSX (đã sửa lại UTF-8 bằng apply_patch; đọc lại và kiểm trên ảnh). Không còn lỗi ở gate cuối.
- **Ảnh và tài liệu:** `docs/design/ui-implemented-desktop.png`, `ui-implemented-mobile.png`, `ui-implemented-empty.png` là ảnh app thật với dữ liệu test; nhãn ĐĂNG THẬT là tình huống kiểm thử xác nhận qua API live giả, không bằng chứng đăng thật. Hướng dẫn `docs/design/ui-implementation.md`; cập nhật plan và liên kết từ brief mockup. Giữ nguyên PNG mockup ban đầu.
- **Giới hạn:** tập trung bố cục Đăng nhóm và shell/shared styles; chưa viết lại form đặc thù của mọi trang theo mockup. Không đăng/quét thật, không sửa DB/phiên Facebook thật trong lượt UI. App đang mở cần restart và Ctrl+F5 để nhận bundle mới.
- **Tiếp theo:** người dùng mở `Auto-Post-MKT.cmd` hoặc `npm.cmd start`, vào Đăng nhóm dùng thử. Lưu commit riêng code/ảnh/tài liệu sau gate; chưa push.


## 2026-10-28 21:04 — Review nhanh UI/UX qua trình duyệt và sửa chặn duyệt khi nhóm chưa tải

- **Yêu cầu:** dùng thử nhanh qua UI, chụp và đánh giá giao diện, kiểm tra lỗi. Giữ phạm vi test mô phỏng; không đăng Facebook thật.
- **Đã dùng thử:** Edge headless + API/Vite thật và dữ liệu tạm: quét 40/chọn 30, nhập 0/101/1,5 báo lỗi; xin 60 chỉ chọn đúng 40; lọc không mất lựa chọn; preview/sửa caption/hẹn giờ/lưu preset/đổi trang/mobile menu; duyệt 30, bấm lại vẫn 30. Các trang máy/nhóm/TCN/fanpage/lịch sử/đơn hàng không pageerror. Kích thước 1440×1000, 1024×768, 390×844 không tràn ngang.
- **Lỗi tìm thấy và sửa:** bản nháp đã có nhóm, mở lại và GET nhóm trả 500 -> tick xác nhận vẫn bật nút duyệt dù chưa xem lại được danh sách. Đã tái hiện bằng test thất bại đúng `true !== false`. Frontend nay yêu cầu các nhóm đã chọn được tải và đủ điều kiện của đúng tài khoản; thêm Tải lại danh sách, lỗi riêng cho tải nhóm, bỏ xác nhận cũ khi tải lại. Test lỗi -> chặn -> tải lại -> xác nhận lại -> cho duyệt, không thêm job ngoài ý muốn.
- **UI/UX:** desktop đủ rõ cho MVP; mobile dùng được nhưng trang Đăng nhóm dài khoảng 2,4k px, CTA dưới nếp gấp. Chữ phụ 10–11px hơi nhỏ; các trang phụ chưa đồng bộ chi tiết, còn mã Pxx/hướng dẫn dài; nhánh lỗi nên thay ID nội bộ/badge 30/0 bằng lời nhắc chờ đối chiếu. Ghi ưu tiên cụ thể trong `docs/design/review-20261028/review.md`; chưa tự mở rộng đợt thiết kế mới.
- **Bằng chứng:** 10 ảnh mới trong `docs/design/review-20261028/` (desktop viewport/full, 1024px, mobile viewport/full, empty, tải lỗi, máy, hàng chờ, fanpage). Đã mở xem các ảnh chính và nhánh lỗi. Dữ liệu giả, không publisher/mạng Facebook; fanpage chỉ kiểm hiển thị chưa kết nối trong lượt này.
- **Kiểm tra cuối:** target UI/post-plan/selection 10/10 đạt; lần chốt UI 1/1 đạt (~12 giây); typecheck/lint 195 file/build web 51 module đạt. Không chạy lại full gate để giữ review nhanh theo yêu cầu. Không sửa dữ liệu/phiên thật.
- **Tiếp theo:** người dùng restart app để nhận bản sửa; ưu tiên thanh hành động gọn dễ tìm trên màn nhỏ và tăng độ đọc chữ phụ. Lưu commit riêng, chưa push.

## 2026-10-28 23:06 — P09: người dùng xác nhận bằng mắt bài fanpage; tick P09.3/P09.4/P10.4

- **Người dùng xác nhận:** đã kiểm tra bài thật trên Page "Góc Nghiện Đồ Hay": đủ 2 ảnh đúng thứ tự (xanh rồi đỏ), đúng nội dung 2 dòng, công khai và đúng Page.
- **Đã làm:** tick P09.3, P09.4, P10.4 trong `plan.md` (sau đó tick thêm P09.8 → P09 xong 8/8), cập nhật `docs/nghiem-thu.md` (cả ba kênh nhóm/TCN/fanpage đã đăng thật và được xác nhận), README mục 11, `docs/fanpage.md`.
- **Tiến độ theo checkbox:** 72/116 (62%); bỏ proxy (P04, hoãn) và AI (P13): 72/100 (72%). Còn mở chủ yếu: P01 (bảng bằng chứng khả thi), P03 (quản lý tài khoản: bảng/mở đóng phiên/khóa profile), P06 (quét nhóm tự động và từ khóa), P05.5–5.7, P08.5/P08.7, P10.1, P07.2, P04 và P13.
- **Chưa thử:** lỗi thật từ Meta (token hết hạn, bị từ chối), `unknown` thật trên Page, 1 ảnh/nhiều ảnh hơn 2, hai nick đồng thời, nhóm kiểm duyệt thật.
- **Tiếp theo:** người dùng tự xóa các bài thử (nhóm, TCN, fanpage); chọn việc kế tiếp (đóng các mục P03/P06/P05 làm dở, hoặc P04 proxy, hoặc P13 AI).

## 2026-10-29 00:18 — P10: làm mềm chuyển động và phản hồi thao tác UI

- **Yêu cầu:** giao diện đã khá tốt nhưng click/thao tác còn thô, chuyển động cứng; tinh chỉnh trực tiếp trên giao diện hiện có.
- **Đã làm:** CSS chuyển màu/nhấn/hover nút, điều hướng, nền dòng nhóm và số nhóm đã chọn; hiệu ứng vào trang/preview/thông báo; gạch chân tab trượt. Component `motion.tsx` dùng grid để mở–thu caption/quét nhóm/cấu hình/hẹn giờ/menu mobile, hủy RAF/timer khi bấm liên tiếp; vùng đóng `inert` ngay, giữ form cấu hình khi thu gọn. Tôn trọng `prefers-reduced-motion` cho cả CSS và cuộn bằng JS, theo dõi đổi tùy chọn khi đang mở.
- **Phản hồi xử lý:** spinner/nhãn khi tải danh sách hoặc duyệt; khóa chọn theo số lượng trong khi tải; chỉ nhận phản hồi tải nhóm mới nhất của đúng tài khoản. Không thêm độ trễ vào API/xếp lịch. File chính: `App.tsx`, `GroupComposerView.tsx`, `PostGroupPage.tsx`, `styles.css`, `motion.tsx`.
- **Kiểm chứng:** target `npm.cmd test -- tests/e2e/group-count.test.ts apps/web/src/post-plan.test.ts apps/web/src/group-selection.test.ts` **10/10 đạt**. UI kiểm tra transition thật, bấm mở/đóng nhanh, vùng đóng không nhận focus, giữ caption/tên preset, giảm chuyển động (transition 0s/không animation), request tải lại đang chờ khóa chọn và không thêm job. Các luồng chọn 30/duyệt/chống bấm hai lần/lỗi tải và hồi phục vẫn đạt.
- **Gate cuối:** `npm.cmd run check` đạt typecheck, lint **196 file**, **320/320 test**, 28 suite, không skip; build web **52 module** đạt. Chạy ngoài sandbox cho DPAPI/ACL; runner vẫn ép test/fake và dữ liệu tạm. Lỗi lint kiểu trả về callback trong lần kiểm tra đầu đã sửa; gate cuối không còn lỗi.
- **Ảnh/tài liệu:** `docs/design/motion-20261029/` có 10 ảnh chụp và `motion.md`; đã xem desktop/mobile, bố cục không bị lệch. Ảnh chụp tắt animation để lấy trạng thái ổn định; test kiểm tra thuộc tính chuyển động và tương tác. Chỉ fixture giả, không mở profile hoặc gửi Facebook thật. Cập nhật liên kết từ `ui-implementation.md` và ghi trạng thái trong plan.
- **Giới hạn/tiếp theo:** chuyển động tập trung shell và Đăng nhóm, nút/form dùng style chung trên các trang. Cảm giác trực tiếp còn cần người dùng dùng thử trên máy; mở lại app và Ctrl+F5 để nhận bundle. Lưu commit cục bộ, chưa push theo yêu cầu trước đó.

## 2026-10-29 08:00 — P10: làm mềm hình dáng box và button

- **Yêu cầu:** sau đợt chuyển động, người dùng làm rõ rằng khung/box/button vẫn vuông, trông cứng và thô.
- **Đã làm:** chỉnh trực tiếp CSS dùng chung bằng bộ biến góc bo: card chính 24 px, ô nhập/dropdown/tìm kiếm 14 px, khung bảng/ảnh/fieldset 18 px, nút thao tác và badge dạng viên. Tăng đệm card desktop 22 px/mobile 16 px, viền xanh xám nhẹ hơn, bóng khuếch tán nhẹ; đồng bộ ô chọn máy với các ô nhập khác, làm nhẹ banner. Giữ link chữ/tab phù hợp với vai trò, không thay logic hoặc thêm thư viện. File mã duy nhất: `apps/web/src/styles.css`.
- **Kiểm tra tập trung:** `npm.cmd test -- tests/e2e/group-count.test.ts` **1/1 đạt** (~19,5 giây); UI offline chọn/duyệt đúng 30 job, giữ caption/preset, menu mobile, chống bấm hai lần, lỗi tải/hồi phục và kiểm tra không tràn ngang 1440/1024/390 px. Typecheck/lint 196 file/build web 52 module đạt.
- **Ảnh:** 10 ảnh mới ở `docs/design/rounded-20261029/`; đã mở xem desktop, mobile và trang Máy. Khung/nút tròn hơn rõ rệt, không cắt chữ; nút quét trên mobile tự xuống dòng khi thiếu chỗ. `review.md` có liên kết trước/sau và thông số; cập nhật plan và liên kết tài liệu UI. Dữ liệu/ảnh/tài khoản giả; không mở Facebook thật hoặc gửi bài.
- **Tiếp theo:** người dùng mở lại `Auto-Post-MKT.cmd`, Ctrl+F5 để nhận CSS mới và dùng thử. Lưu commit cục bộ, chưa push.
- **Gate toàn dự án:** đã chạy `npm.cmd run check` theo quy định repo: typecheck/lint đạt, **319/320 test đạt**; test fanpage `prepare` 2 ảnh trả `network_error` ở ~1 giây với fixture localhost cấu hình timeout 800 ms. Chạy lại riêng toàn bộ `page-publisher.test.ts` **11/11 đạt**, ca đó ~94 ms. Chưa xác định chắc nguyên nhân timeout khi chạy chung; không sửa mã fanpage hoặc tăng timeout trong lượt CSS. Gate dừng trước build, nhưng build web riêng đã đạt ở trên; không báo full gate xanh.

## 2026-10-29 08:08 — Kiểm tra giãn cách đăng nhiều nhóm

- **Yêu cầu:** kiểm tra có thể chọn khoảng nghỉ từ X đến Y giây giữa các nhóm hay chưa.
- **Kết quả đọc mã hiện tại:** `getMinGapMs()` (`packages/config/src/index.ts`) đọc `APM_MIN_GAP_SECONDS`, mặc định 60 giây; chấp nhận số nguyên 0–86400. Worker truyền vào `createJobRunner`, chỉ nhận job tiếp theo cùng tài khoản khi không có job đang chạy/khóa browser và đã đủ khoảng cách từ `lastSendStartedAt`. Đây là khoảng cách giữa các mốc gửi, không phải thời gian nghỉ sau khi bài trước kết thúc; tác vụ lỗi trước mốc gửi không bắt đầu khoảng chờ này.
- **Chưa có:** input min/max giây trong UI Đăng nhóm; chọn ngẫu nhiên trong khoảng; cấu hình khoảng nghỉ theo từng lô hoặc từng nhóm. UI chỉ có bắt đầu ngay/hẹn giờ. Các job trong lô dùng chung scheduledAt, worker đảm nhiệm giãn cách.
- **Cấu hình:** không tìm thấy override `APM_MIN_GAP_SECONDS` trong `.env` của project hoặc môi trường shell đang kiểm tra; không đọc môi trường riêng của worker đã chạy nên không khẳng định giá trị của tiến trình đó. Không sửa `.env` hay hàng chờ.
- **Kiểm chứng:** `npm.cmd test -- apps/worker/src/job-runner.test.ts` **9/9 đạt**, gồm hai job cùng tài khoản phải chờ đủ giãn cách và trường hợp nhiều đích kết quả xen kẽ. Dữ liệu tạm/fake, không Facebook thật. Chỉ kiểm tra và ghi nhật ký, chưa triển khai min/max.
