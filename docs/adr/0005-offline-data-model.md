# ADR 0005 — Snapshot được duyệt và schema nghiệp vụ offline

- Ngày: 2026-10-27
- Trạng thái: Đã chấp nhận
- Phạm vi: P02.1–P02.2; không nghiệm thu P02.3–P02.8 hoặc Facebook thật

## Bối cảnh

`0001_init.sql` chỉ có `app_meta`. Các luồng nội dung và DB có thể phát triển độc lập bằng fake adapter khi P01 chưa đủ điều kiện thử thật; cần schema thống nhất cho plan mục 4, giữ đúng account/Page–destination–content đã duyệt và lịch sử unknown/pending.

## Quyết định

1. Thêm migration `0002_offline_core.sql`, giữ nguyên `0001`. Dùng 26 bảng STRICT cho kết nối/danh tính, sản phẩm/revision/media, nội dung/approval, request/job/attempt/observation, lease, scan và preset/activity. ID do ứng dụng cấp dạng UUID TEXT, thời gian mới epoch-ms UTC. Không thêm ORM/dependency và không seed dữ liệu vận hành.
2. Account identity, product revision, content version, selected media và approval là snapshot bất biến; job chỉ tham chiếu approval ID. Composite FK và CHECK ràng buộc đúng tuple account identity/đích/content/Page. Dùng revocation append-only thay vì sửa approval. Các fields biểu thị state vận hành có thể cập nhật nhưng không được đổi snapshot identity dưới job lịch sử.
3. Order ảnh lưu tại cả revision và content version, unique vị trí, không ảnh trùng trong một snapshot; approval cần ảnh ready, nonempty và liên tục từ 0. Physical file safety còn thuộc MediaStore/validation, không giả định một FK chứng minh file tồn tại.
4. Request key/fingerprint bất biến, unique theo scope; job chống trùng theo request+approval và request+target identity. Request mới cho phép ý định đăng lại. Repository P02.3 sẽ xử lý read-back response và fingerprint conflict trong transaction; schema chưa phải toàn bộ idempotency API.
5. Send marker và finish marker của attempt write-once; job/attempt/observation/request lịch sử không được xóa/viết lại. Unknown/pending có source explicit; fake và API/UI provenance không được trộn với approval mode. Không tự chuyển trạng thái scheduler trong SQL trigger.
6. Lease fence không giảm hoặc bị DELETE reset; đổi owner cần fence tăng. Mọi connection phải dùng `openDatabase()`, bật `recursive_triggers=ON` cùng `foreign_keys=ON`: SQLite REPLACE khi đó chạy DELETE trigger và bị chặn trên immutable/durable rows, kể cả alternate UNIQUE conflicts. Không dùng pre-insert guard cấm mọi conflict vì cách đó chặn cả thao tác idempotent DO NOTHING và UPSERT hợp lệ. Migration/repository không được tắt hai PRAGMA này; không hỗ trợ connection tự tạo bỏ qua helper. Conditional lease UPSERT có thể dùng khi hết hạn và fence tăng; đây chưa phải implementation scheduler.
7. FK child và đường nhận job/đọc kết quả có index. Scanner/preset mới có bảng nền; không coi schema là chức năng quét/lập lịch đã hoạt động. Secrets chỉ lưu reference, không ciphertext/key trong schema này; lựa chọn bảo vệ thật thuộc P02.5.

## Hệ quả

- Nhiều composite FK/trigger hơn schema chỉ dùng FK độc lập, đổi lại không thể chọn lại một phần danh tính/đích/content sau duyệt bằng SQL thông thường hoặc OR REPLACE qua helper. Repository phải tạo snapshot mới; DO NOTHING vẫn cần đọc lại/so fingerprint, không được coi việc bỏ qua conflict là xác nhận payload giống nhau.
- Destination identity và Page binding bất biến. URL-only group chưa có luồng enrich/merge external ID; giữ quan sát mới trong scan result, thiết kế rõ ở P06 trước sử dụng thật.
- Việc nguồn đổi/máy sold/permission hết hạn phải được revalidate và invalidate đúng transaction ở P02.3/P05/P07. DB không chứng minh phiên Facebook đang đúng danh tính, quyền thật hay side effect gửi bài exactly-once.
- Tài liệu chi tiết bảng, invariants và ranh giới: [data-model.md](../data-model.md).

## Kiểm chứng

Test DB tạm chạy migration fresh/v1→v2/noop/rollback; online SQLite backup khi WAL có dữ liệu, restore ra DB riêng rồi nâng bản giữ sentinel. Negative tests kiểm tuple identity/đích/content/Page, media ownership/order/immutability, active slots, request-target dedup, marker/provenance/fence và OR REPLACE. Không mở Facebook, không dùng credentials hay DB vận hành.
