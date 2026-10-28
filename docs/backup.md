# Sao lưu và phục hồi

## Sao lưu

```
npm run backup                      # ghi vào %LOCALAPPDATA%\AutoPostMKT\backups\<thời điểm>
npm run backup -- --out E:\sao-luu\2026-10-28
```

- Có thể chạy khi server/worker đang chạy (dùng API sao lưu trực tuyến của SQLite, không chép file đang ghi).
- Gồm: cơ sở dữ liệu (máy, bài, job, nhật ký, cấu hình), ảnh trong kho, `manifest.json` (mã băm SHA-256 từng file; ghi cuối cùng nên bản dở dang bị từ chối).
- **Không** gồm: hồ sơ trình duyệt/cookie (`profiles`), khóa/bí mật (`secrets`), log, ảnh chụp chẩn đoán (`diagnostics`), `backups`, `spikes`, `cache`.
- Có gồm: ghi nhận khách hỏi/đơn hàng bạn đã nhập (tên khách, ghi chú).
- Từ chối ghi vào trong thư mục repo. Nên chép bản sao lưu sang ổ khác/đám mây riêng; thư mục này chứa dữ liệu kinh doanh (tên máy, giá, ảnh) nhưng không chứa bí mật đăng nhập.

## Kiểm tra bản sao lưu

```
npm run restore -- <thư mục sao lưu> --verify-only
```

Kiểm tra manifest, mã băm DB và từng ảnh, `integrity_check`, schema không mới hơn mã nguồn. Không sửa gì.

## Phục hồi

Tắt server và worker trước (script từ chối nếu worker còn chạy).

```
npm run restore -- <thư mục sao lưu>             # sang máy mới / thư mục dữ liệu chưa có
npm run restore -- <thư mục sao lưu> --replace   # thay dữ liệu đang có
```

- Phục hồi vào thư mục tạm, kiểm tra xong mới thay. Bản sao lưu hỏng thì dữ liệu hiện tại không bị đụng tới.
- `--replace`: dữ liệu cũ được **đổi tên** thành `<dữ liệu>.before-restore-<thời điểm>`, không xóa. Hồ sơ trình duyệt và khóa của máy này được giữ lại.
- **Lịch không tự chạy sau phục hồi**: job đang chờ chuyển sang *Tạm dừng* (ghi vào nhật ký `restored_paused`). Xem lại rồi bấm tiếp tục từng job. Job đã có mốc gửi (`unknown`/`pending_approval`) giữ nguyên để đối chiếu thủ công.
- Tài khoản về `login_required`: đăng nhập/kiểm tra phiên lại trên máy.
- Sang máy mới: cần cài lại ứng dụng, chạy `npm ci`, rồi phục hồi; proxy/khóa nếu có phải nhập lại.
