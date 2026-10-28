# Báo cáo nghiệm thu (P12)

Cập nhật: 28/10/2026. Phiên bản: mã nguồn trên nhánh `main` (chưa gắn số phiên bản; `package.json` ghi 0.0.0). Môi trường chạy thử: Windows 10, Node 24.16, Edge.

**Kết luận ngắn:** bản nội bộ dùng được cho **đăng nhóm** và **đăng trang cá nhân (TCN)** với một hoặc hai tài khoản, từ hàng chờ có đối chiếu kết quả, sao lưu/phục hồi và cập nhật an toàn. Cả ba kênh (**nhóm, trang cá nhân, fanpage**) đã đăng thật thành công một lần và được người dùng xác nhận bằng mắt. Vẫn **chưa bàn giao đủ phạm vi** vì còn các mục "một phần"/"chưa" bên dưới (proxy hoãn, quét nhóm tự động, nhóm kiểm duyệt thật, hai nick đồng thời, AI). Theo `plan.md`: một kênh chính chưa đạt thì chưa bàn giao đủ.

Quy ước cột "Kết quả": **Đạt** = có test tự động (và/hoặc thử thật) chứng minh; **Một phần** = đạt phần nêu, còn thiếu phần ghi rõ; **Chưa** = chưa làm hoặc chưa kiểm chứng.

## Ma trận kiểm tra (plan.md mục 7)

| Mã | Tình huống | Kết quả | Bằng chứng | Còn thiếu |
| --- | --- | --- | --- | --- |
| T01 | Chỉ ảnh/tên/tình trạng, thiếu tùy chọn | Đạt | `packages/domain/src/caption.test.ts` (T01), `apps/web/src/product-form.test.ts`, mẫu caption bỏ dòng thiếu dữ kiện (`caption-template.test.ts`) | — |
| T02 | Ảnh hỏng/mất hoặc upload lỗi | Đạt | `composer-publisher.test.ts` (ảnh không đính được → `media_invalid` trước khi gửi), `job-runner.test.ts` ("ảnh mất không biến bài thành chỉ chữ"), `media-store.test.ts`. Thử thật 28/10: ảnh trong kho không đuôi ảnh làm bài dừng trước khi gửi; đã sửa và có test hồi quy | — |
| T03 | Nick A đăng nhóm X, nick B đăng TCN B, Page Y | Một phần | Nhóm và TCN: `data-api.test.ts` (P10, P10.3); đăng thật 28/10 một bài ở nhóm `1357510931662685` và một bài ở TCN nick phụ, người dùng đã xác nhận bằng mắt (nội dung, thứ tự ảnh, người đăng) | Fanpage: đăng thật 28/10 một bài 2 ảnh lên Page "Góc Nghiện Đồ Hay", người dùng xác nhận bằng mắt; test với Graph giả (`page-publisher.test.ts`, `page-job.test.ts`, `pages-api.test.ts`). **Còn thiếu:** chưa thử đồng thời hai nick, chưa thử lỗi thật từ Meta |
| T04 | Bấm hai lần / hai worker nhận một job | Đạt | `post-batch.test.ts` (chống bấm hai lần), `repository.test.ts` ("nhiều tiến trình nhận cùng cohort, mỗi job một claim"), `apps/worker/src/single-instance.test.ts`, `tests/e2e/launcher.test.ts` (bản thứ hai bị từ chối) | — |
| T05 | Quét/đăng/mở thủ công cùng profile | Một phần | Khóa hồ sơ: `browser.test.ts`; khóa trình duyệt giữa các tác vụ: `job-runner.test.ts`; `joined-scans.test.ts` xác nhận quét chờ khi bận và owner riêng ngăn login/đăng chiếm lease đang quét | Chưa nghiệm thu tranh phiên khi quét/đăng trên Facebook thật |
| T06 | Nhóm chưa tham gia / chưa rõ quyền / có điều kiện | Một phần | `group-repository.test.ts` (lý do chặn), trang Đăng nhóm khóa nhóm chưa đủ điều kiện, `post-batch.test.ts` (tất cả hoặc không gì) | Chưa có cờ riêng "nhóm yêu cầu giá": nội quy được hiển thị để người dùng tự bỏ chọn |
| T07 | Nhóm kiểm duyệt | Một phần | `job-runner.test.ts` (chờ duyệt ghi riêng, không tự thành `published`), `job-reconcile.test.ts` (chỉ đổi khi người dùng xác nhận) | Chưa thử nhóm kiểm duyệt thật (P08.5) |
| T08 | Timeout/crash sau khi gửi | Đạt | `job-runner.test.ts`, `repository.test.ts`, **`tests/e2e/lifecycle.test.ts`** (worker thật bị bỏ dở: sau mốc gửi → `unknown`, trước mốc gửi → tạm dừng, không lần thử mới), đối chiếu thủ công trên giao diện (chạy trình duyệt 28/10) | Chưa thử mất điện/kill giữa lúc đăng THẬT |
| T09 | Nguồn đổi sau duyệt hoặc máy đã bán | Đạt | `job-reconcile.test.ts`, `repository.test.ts` (kiểm tra lại trước mốc gửi), `product-impact.test.ts`, trang Máy hỏi xác nhận (chạy trình duyệt 28/10) | — |
| T10 | Proxy lỗi/đổi, phiên hết hạn, cảnh báo | Một phần | Phiên hết hạn/checkpoint chỉ chặn đúng tài khoản: `job-runner.test.ts`, `composer-publisher.test.ts` | **Proxy hoãn có chủ đích (P04)**, chưa kiểm chứng |
| T11 | Một đích thành công, đích khác lỗi | Đạt | `job-runner.test.ts` ("nhiều đích, kết quả xen kẽ"), kết quả từng nhóm trên trang Đăng nhóm | — |
| T12 | Slot lỗi xen kẽ thành công | Đạt | `job-runner.test.ts` (giãn cách tính theo mốc gửi thực tế, không theo số lần thành công) | — |
| T13 | Mở lại với nhiều lịch quá hạn | Đạt | **`tests/e2e/lifecycle.test.ts`** (worker thật: chỉ job đến hạn chạy, job quá hạn giữ nguyên chờ quyết định), `job-runner.test.ts`, giao diện báo quá hạn | — |
| T14 | Hủy khi đang gửi | Một phần | `repository.test.ts` ("stop trước mốc gửi hủy phần chưa gửi; sau mốc gửi vẫn ghi nhận `unknown`"), `fake.test.ts` (stop không thu hồi kết quả đã gửi), `job-view.test.ts` | Cố ý chưa thử hủy giữa lúc gửi trên Facebook thật |
| T15 | Backup/restore vùng sạch | Đạt | `backup.test.ts` (5), `packages/ops/src/update.test.ts` (cập nhật thật trên dữ liệu tạm, quay về từ sao lưu); chạy script `backup`/`restore` thật trên dữ liệu tạm 28/10: đủ máy/ảnh/lịch sử, không có cookie/khóa, job chờ → tạm dừng, tài khoản → cần đăng nhập lại | Chưa thử trên dữ liệu thật của người dùng |
| T16 | Origin lạ / đường dẫn ngoài kho / thiếu xác thực | Đạt | `local-access.test.ts`, `static-ui.test.ts` (không tải được `.env`, `.map`, file ngoài thư mục build, thoát đường dẫn), `data-api.test.ts`, `tests/e2e/local-api.test.ts` | — |
| T17 | AI lỗi hoặc thêm dữ kiện không có nguồn | Chưa | — | P13 (LLM) chưa làm; bản cơ bản không cần AI |
| T18 | Quét được một phần nhóm/nội quy | Một phần | Joined scan đã nối UI/API/worker; `joined-scans.test.ts`, `joined-groups.test.ts`, `joined-scan-api.test.ts`, `group-count.test.ts` kiểm tra tiến độ/hủy/nguồn/loại trùng/giữ nhóm vắng và UI 40 → chọn 30 → xếp 30 job, không gọi Facebook thật | Chưa nghiệm thu joined thật; keyword chưa hỗ trợ |

## Các mục P12 theo bằng chứng

| Mục | Kết quả | Bằng chứng |
| --- | --- | --- |
| P12.1 Ma trận mục 7 | Một phần | Bảng trên: 10 Đạt, 7 Một phần, 1 Chưa. Facebook thật đã thử một lần cho nhóm và TCN; joined scan mới đạt offline |
| P12.2 Đóng/mở, một scheduler | Đạt (mô phỏng) | `tests/e2e/launcher.test.ts` (một cổng; bản thứ hai bị từ chối; launcher bị giết đột ngột thì server và worker tự dừng và lần khởi động sau không bị khóa mồ côi chặn), `tests/e2e/lifecycle.test.ts` |
| P12.3 Launcher và hướng dẫn Windows | Đạt | `Auto-Post-MKT.cmd`/`npm start` + `packages/ops/src/preflight.test.ts` (Node sai phiên bản, thiếu thư viện, cổng bị chiếm — phân biệt "đã đang chạy" với "chương trình khác", thư mục dữ liệu không ghi được, thiếu Edge). Chạy thật từ `...\Thử Nghiệm Có Dấu\Auto Post MKT` với thư mục dữ liệu có dấu: kiểm tra, khởi động, trang và API đều đạt. Không có đường dẫn cứng |
| P12.4 Build và phục vụ UI cục bộ | Đạt | `apps/server/src/static-ui.ts` + `static-ui.test.ts`: chỉ `/` và file phẳng trong `/assets/` theo danh sách đuôi cho phép, CSP, không `.map`, không thoát đường dẫn; vẫn chặn Host/Origin lạ; chỉ nghe 127.0.0.1 |
| P12.5 Backup trước cập nhật | Đạt (mô phỏng) | `npm run update`/`Cap-nhat-Auto-Post-MKT.cmd` + `update.test.ts`: sao lưu đã kiểm tra trước khi đổi gì, dừng đúng chỗ, không lệnh phá hủy, in cách quay về; cập nhật thật trên dữ liệu tạm giữ nguyên hồ sơ đăng nhập/khóa/ảnh. Chưa chạy `npm run update` trên bản cài thật (cần `git pull` từ kho từ xa) |
| P12.6 Hướng dẫn | Đạt (viết) | [huong-dan.md](huong-dan.md). Chưa có người dùng ngoài tác giả đọc thử |
| P12.7 Nghiệm thu một chu trình với cấu hình thật | Đạt (một chu trình) | Xem mục dưới: launcher chế độ THẬT, một bài thật ở nhóm bằng nick phụ, khởi động lại không đăng lại, sao lưu khi đang chạy |
| P12.8 README đúng thực tế | Đạt | README mục 11 và "Chạy ứng dụng"; ghi rõ máy phải bật và cửa sổ đang mở thì lịch mới chạy |

## Nghiệm thu một chu trình thật (P12.7) — 28/10/2026

**Phạm vi do người dùng cho phép riêng cho lượt này:** nick phụ `phu1` đăng MỘT bài (chữ + 2 ảnh) vào nhóm `1357510931662685` (nhóm người dùng quản trị). Phiên bản: commit `eee44bb` (xuất sạch ra thư mục riêng, không lẫn phần dở của phiên khác), dữ liệu thật của người dùng (`%LOCALAPPDATA%AutoPostMKT`), Windows 10, Node 24.16, Edge.

| Bước | Kết quả |
| --- | --- |
| 1. Sao lưu dữ liệu thật rồi kiểm tra | Đạt: 2 ảnh, mã băm khớp, `--verify-only` hợp lệ |
| 2. `APM_INTEGRATIONS=live`, chạy launcher | Đạt: banner "Chế độ: THẬT", mọi mục kiểm tra [ĐẠT], tự build giao diện, `/api/health` báo `live`, worker sống với trình duyệt thật |
| 3. Phiên đăng nhập | Dùng phiên `phu1` đã có (`logged_in`); worker tự xác nhận danh tính trước khi gửi. Không phải đăng nhập lại |
| 4. Xếp lịch qua trang "Đăng bài viết nhóm" (chọn `phu1`, máy thử, đúng 1 nhóm, tick xác nhận THẬT) | Đạt: đúng 1 job. Giao diện được điều khiển bằng Edge ngầm do tôi thao tác, không phải người dùng bấm tay |
| 5. Worker đăng | Đạt: `queued` → `running` → `published` trong khoảng 43 giây. ID `2307345636679205`, có liên kết bài, nguồn `ui_observation`, 2 ảnh, 1 lần thử, nhật ký `send_started` → `job_published` |
| 6. Giết launcher đột ngột | Đạt: server và worker dừng trong 12 giây, Edge của worker đóng; khóa worker mồ côi còn sót |
| 7. Mở lại launcher | Đạt: khóa mồ côi không chặn; tổng job vẫn 4 (3 đã đăng + 1 lỗi cũ), bài vừa đăng vẫn 1 lần thử, **không đăng lại, không phát dồn** |
| 8. `npm run backup` khi ứng dụng đang chạy, `--verify-only`, phục hồi sang thư mục tạm | Đạt: schema v5, 2 ảnh, phục hồi báo "1 tài khoản cần đăng nhập lại", dữ liệu thật không bị đụng |

**Phát hiện và đã sửa trong lượt này:** script `backup` tự chạy migration trước khi sao lưu nên dữ liệu thật bị nâng lên v5 ngay ở bước 1 và không còn bản sao lưu ở schema cũ. Migration 0005 chỉ thêm một bảng nên không ảnh hưởng dữ liệu cũ; script đã sửa để chụp dữ liệu nguyên trạng, không bao giờ migrate.

**Chưa kiểm chứng trong chu trình này:** người dùng tự bấm trên giao diện (tôi điều khiển); đóng cửa sổ GIỮA LÚC đang gửi (cố ý không làm trên Facebook thật; đã có test với worker thật ở `tests/e2e/lifecycle.test.ts`); đối chiếu thủ công một job `unknown`; nhóm kiểm duyệt; trang cá nhân và hai nick qua launcher.

**Việc người dùng còn lại:** tự xóa bài thử mới trên Facebook (`https://www.facebook.com/groups/1357510931662685/posts/2307345636679205`) và các bài thử cũ.

## Tồn đọng chính trước khi bàn giao đủ phạm vi

1. Fanpage (P09/P10.4): đã đăng thật và được xác nhận; còn chưa thử lỗi thật từ Meta (token hết hạn, bị từ chối), `unknown` thật và đăng 1 ảnh/nhiều ảnh hơn.
2. Proxy (P04): hoãn có chủ đích.
3. Quét nhóm đã tham gia (P06): đã có trong ứng dụng và đạt kiểm thử offline; cần nghiệm thu đọc thật trên tài khoản được chọn. Chưa tìm nhóm theo từ khóa. Có chọn theo số lượng ở trang Đăng nhóm; xem [joined-groups.md](joined-groups.md).
4. Nhóm kiểm duyệt thật (P08.5), nick không phải quản trị, hai nick đồng thời.
5. LLM (P13): ngoài bản cơ bản.
