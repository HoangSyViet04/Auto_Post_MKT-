# ADR 0007 — Repository phiên bản, idempotency và mốc gửi

- Ngày: 2026-10-27
- Trạng thái: Đã chấp nhận
- Phạm vi: P02.3; thao tác DB, chưa nối API/scheduler/adapter thật

## Quyết định

1. Dùng SQL tham số hóa và `BEGIN IMMEDIATE` qua helper hiện có; không thêm ORM/dependency hoặc migration. Mỗi thao tác nghiệp vụ là một transaction đồng bộ, không giữ transaction trong lúc gọi mạng/file/browser.
2. `#domain.BusinessError` có code/message cố định. Validation và lỗi ràng buộc SQLite được trả thành lỗi nghiệp vụ không echo payload hoặc thông báo DB. Lỗi lập trình/hạ tầng ngoài nhóm constraint tiếp tục được ném để logger chung xử lý.
3. `#storage.createContentRepository` tạo product/revision/media order, bản nội dung theo đích hoặc nháp chưa có đích, và approval. Sửa máy dùng expected revision để tránh ghi đè thay đổi đồng thời; luôn tạo revision mới, giữ bản cũ. Optional text rỗng thành NULL, giá nếu có phải nguyên dương. Nháp generic không được approve trực tiếp thành một đích khác.
4. Sửa product và thu hồi approval/invalidate job cùng transaction. Job chưa chạy chuyển needs_review, hoặc cancelled khi sold/archived. Job running chỉ nhận stop_requested_at: trước marker sẽ bị chặn khi kiểm tra lại, sau marker vẫn phải lưu kết quả thực tế; không giả thu hồi bài Facebook. Bán lại hoặc sửa nguồn không tự khôi phục approval/job cũ.
5. `#storage.createJobRepository.enqueue` canonical hóa batch bằng approval ID, hash SHA256 gồm mode/approval/schedule. Scope publish + request key là một ý định. Key lặp với fingerprint giống trả các job cũ và trạng thái hiện tại, kể cả nguồn đã đổi; khác fingerprint báo idempotency_conflict. Key mới cho phép ý định đăng lại. Cả batch rollback nếu một đích lỗi hoặc cùng identity/đích bị lặp qua hai approval.
6. `claimNext` chỉ lấy queued đến hạn, đúng mode, kiểm tra lại eligibility; UPDATE có điều kiện, tăng claim generation và tạo attempt cùng transaction. Receipt gồm job/worker/generation/attempt. Mutation của worker cần receipt đúng và chưa hết hạn. Không có heartbeat/renewal ở bước này; lease job tối đa 5 phút, mặc định30giây.
7. Kiểm tra readiness lúc approve/enqueue/claim và ngay trước marker: product còn bán/current revision, approval chưa thu hồi, đúng current account identity, chưa archive/pause, trạng thái phiên/quyền/group membership hoặc quyền Page, media metadata ready và đúng thứ tự. Live Page còn cần secret reference available. Đây là dữ liệu trong DB; không chứng minh trạng thái Facebook/file thực hoặc độ mới quyền truy cập.
8. `getApprovedSnapshot` trả caption/context và managed media metadata; không trả đường dẫn tùy ý hay bí mật. Consumer phải dùng MediaStore P02.4 để resolve/kiểm tra file và approved contract P02.6 trước khi dùng adapter. `markSendStarted` phải commit trước side effect; gọi lần hai bị từ chối, không coi marker cũ là quyền gửi lại.
9. `finish` ghi observation đúng source/mode, đóng attempt và cập nhật job trong một transaction. Published/pending/unknown cần có marker; published cần remote ID/link. Failed có thể trước marker. URL chứa userinfo hoặc query key nhạy cảm bị từ chối; reason code có allowlist, không nhận raw exception. Không có đường chuyển unknown/pending/published/failed về queued qua API state-change.
10. `recoverExpired` chỉ xử lý mode được chọn: trước marker thành paused, sau marker thành unknown; không tự requeue. Activity log ghi lý do nội bộ cố định, không giả là bằng chứng API/UI hoặc xác nhận thủ công. Resume trước gửi phải là thao tác chủ động và revalidate; receipt cũ mất quyền. Verification/reconciliation kết quả muộn thuộc P11, không sửa chứng cứ cũ ở đây.

## Phạm vi còn lại

- Đây là DB primitives, chưa phải scheduler P07: không auto-run, heartbeat, backoff, chính sách lịch quá hạn hoặc resource lease/profile mutex P03/P07. Hai job khác nhau cùng account vẫn có thể được DB claim; worker thật bắt buộc khóa tài nguyên tương ứng trước khi điều khiển browser. Claim DB không phải quyền mở profile/gửi Facebook.
- Chưa có MediaStore, kiểm byte/hash/file vật lý, kho bí mật Windows, API upload/pagination/path validation hay UI nhập máy/duyệt. Secret reference available chỉ là điều kiện metadata, không phải bằng chứng giải mã token được.
- Repository chưa có CRUD tài khoản/proxy/scanner hoặc xử lý nhóm đã chọn bắt buộc giá; các phần đó thuộc P03–P06. Chưa kiểm tra độ mới quyền hoặc danh tính phiên thật; adapter phải xác minh lại.
- Bảng schema không đổi, migration0001/0002 giữ nguyên. Dữ liệu test dùng DB tạm và UUID giả, không dùng DB vận hành.

## Bằng chứng

`repository.test.ts` kiểm rollback, version/order/optional, generic draft, optimistic concurrency, idempotency/batch, identity/media revalidation, source/mode, sold/stop trước và sau marker, expiry/receipt generation và luồng qua fake publisher. Ba tiến trình Node thực chạy repository trên cùng SQLite nhận60job: mỗi job đúng một claim, trạng thái/attempt/observation tồn tại khi mở lại DB. Đây không phải kiểm chứng exactly-once trên Facebook.
