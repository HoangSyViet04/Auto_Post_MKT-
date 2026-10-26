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
