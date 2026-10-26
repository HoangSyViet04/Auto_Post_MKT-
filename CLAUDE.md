# Hướng dẫn cho agent — Auto Post MKT

## Đọc trước khi làm

1. `report_daily.md` — nhật ký các lượt làm việc trước: đã làm gì, làm thế nào, việc tiếp theo. **Đọc phần cuối trước.**
2. `plan.md` — thứ tự triển khai P00–P13, tiêu chí đạt của từng phần.
3. `README.md` — yêu cầu sản phẩm.
4. `docs/adr/` — các quyết định kỹ thuật đã chốt.

## Bắt buộc sau mỗi việc

Ghi một mục mới vào **cuối** `report_daily.md` theo mẫu ở đầu file, có ngày giờ (`date "+%Y-%m-%d %H:%M"`), phần Pxx, việc đã làm, cách làm/file chính, kết quả kiểm tra (lệnh đã chạy + kết quả thật), tồn đọng và việc tiếp theo. Ghi trung thực: chưa chạy/chỉ mô phỏng thì nói rõ.
Cập nhật checkbox/trạng thái tương ứng trong `plan.md` khi đạt tiêu chí.

## Môi trường

- Windows, dự án nằm trong OneDrive (đường dẫn có khoảng trắng) — xem ADR 0001. Không tạo symlink/junction trong repo; không dùng pnpm/npm workspaces.
- Node 24, npm, một `package.json`. Import nội bộ bằng `#domain`, `#config`, `#storage`, `#contracts`, `#browser`, `#fb-profile`, `#fb-group`, `#fb-page`.
- TypeScript chạy trực tiếp bằng Node (type stripping): import tương đối phải có đuôi `.ts`; không `enum`/`namespace`/parameter properties.
- Dữ liệu vận hành ở `%LOCALAPPDATA%\AutoPostMKT\` (ghi đè bằng `APM_DATA_DIR`), không bao giờ trong repo.

## Lệnh

- `npm run typecheck` — kiểm tra kiểu cả phía Node và web.
- `npm test` — chạy `node:test` cho `{apps,packages,tests}/**/*.test.ts`.
- `npm run db:migrate` — áp dụng migration cho DB môi trường hiện tại (`APM_ENV`, `APM_DATA_DIR`). Migration mới: thêm file `packages/storage/migrations/NNNN_ten.sql`, **không sửa file đã có** (ADR 0002).
- `npm run dev:server` / `npm run dev:worker` / `npm run dev:web`
- `npm run build:web`

## Nguyên tắc an toàn

- Không đăng bài Facebook thật, không mở profile thật nếu người dùng chưa chọn rõ tài khoản và đích cho lượt thử đó.
- Chỉ worker được điều khiển Playwright; server gửi lệnh qua DB.
- Không ghi cookie/token/mật khẩu proxy/API key vào log, file mẫu hoặc Git.
