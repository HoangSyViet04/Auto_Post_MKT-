# ADR 0001 — Mã nguồn trong OneDrive, một package npm, import nội bộ bằng `#alias`

- Ngày: 2026-10-26
- Trạng thái: Đã chấp nhận

## Bối cảnh

Người vận hành làm việc trên hai máy Windows và đồng bộ thư mục dự án qua OneDrive (`D:\OneDrive - EDUPIA\Auto_Post_MKT`).
OneDrive không hỗ trợ junction/symlink: nó đồng bộ nội dung đích thay vì liên kết
([Microsoft Q&A](https://learn.microsoft.com/en-us/answers/questions/1327239/onedrive-shortcuts-symlinks-and-junctions)).
pnpm (node_modules dạng symlink) và npm workspaces (link `node_modules/@scope/pkg → packages/pkg`) đều tạo junction, có thể khiến máy thứ hai nhận bản sao cũ của mã nội bộ.

## Quyết định

1. Giữ mã nguồn và `.git` trong OneDrive theo yêu cầu người dùng.
2. Dùng **npm** với **một `package.json` duy nhất** ở gốc; không dùng workspaces. `node_modules` chỉ chứa file thật.
3. Các module nội bộ (`apps/*`, `packages/*`) tham chiếu nhau qua trường `imports` của `package.json` (`#domain`, `#config`, `#storage`, ...). Ranh giới module giữ bằng cấu trúc thư mục và tsconfig, không bằng package riêng.
4. Server/worker chạy TypeScript trực tiếp bằng type stripping của Node 24 (không bước build). Vì vậy chỉ dùng cú pháp xóa được (`erasableSyntaxOnly`): không `enum`, `namespace`, parameter properties; import tương đối ghi rõ đuôi `.ts`.
5. Hai cấu hình TypeScript: `tsconfig.json` (Node) và `apps/web/tsconfig.json` (trình duyệt, không có kiểu Node). `packages/domain` được kiểm tra bởi cả hai, nên không thể dùng API Node.
6. Dữ liệu vận hành (DB SQLite, media, log, browser profiles) và cache Vite nằm ở `%LOCALAPPDATA%\AutoPostMKT\`, **không** đồng bộ qua OneDrive. Mỗi máy có dữ liệu/phiên Facebook riêng.

## Hệ quả và quy tắc vận hành

- Chỉ làm việc trên **một máy tại một thời điểm**; chờ OneDrive báo "Up to date" trước khi chuyển máy (tránh xung đột `.git/index`, `package-lock.json`).
- Hai máy dùng cùng dòng Node 24 (`.node-version`, `engines`), vì module native sẽ dựng theo ABI Node.
- Khi `package-lock.json` đổi, chạy `npm ci` trên máy đang dùng; không chạy install đồng thời ở hai máy.
- Nên đặt thư mục dự án ở chế độ OneDrive "Always keep on this device" để tránh file placeholder.
- Nếu đồng bộ `node_modules` gây lỗi thường xuyên, phương án thay thế: bare git repo trong OneDrive, bản làm việc đặt ngoài OneDrive trên từng máy.
