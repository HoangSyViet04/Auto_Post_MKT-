# Mô hình dữ liệu nền offline — P02.1–P02.2

Schema v2 được bổ sung bằng `0002_offline_core.sql`; `0001_init.sql` giữ nguyên. Đây là nền lưu trữ, **chưa có repository, scheduler, MediaStore, kho bí mật hoặc adapter Facebook thật**. Không có tài khoản/job/credential/capability được seed vào DB vận hành.

## Quy ước chung

- Bảng mới dùng SQLite `STRICT`. Entity ID là UUID do ứng dụng cấp, lưu TEXT; CHECK độ dài 36, còn kiểm tra đầy đủ định dạng UUID thuộc validation P02.7. ID ghép của bảng quan hệ và lease resource key là ngoại lệ được ghi rõ dưới đây.
- Thời gian mới dùng INTEGER epoch milliseconds UTC, không trộn định dạng ngày giờ địa phương. `app_meta` và lịch sử migration v1 giữ nguyên định dạng TEXT cũ; không đổi lịch sử để đồng nhất hình thức.
- FK dùng `ON DELETE RESTRICT`, giữ lịch sử và archive thay vì cascade xóa. Mọi connection phải qua `openDatabase()`, bật cả `foreign_keys=ON` và `recursive_triggers=ON`. Nhờ vậy DELETE trigger của immutable rows cũng chặn việc ghi đè destructive bằng `INSERT OR REPLACE`; không tắt hai PRAGMA trong migration/repository. `ON CONFLICT DO NOTHING` không ghi đè vẫn dùng được; lease UPSERT vẫn phải qua UPDATE/fence guards.
- Optional product fields là NULL khi chưa có. `price_vnd` nếu có phải dương; thiếu giá không thành 0. Hash ảnh không unique: ảnh giống nhau không chứng minh cùng một sản phẩm.

## Các bảng và quan hệ

| Nhóm | Bảng | Nội dung/ràng buộc chính |
| --- | --- | --- |
| Bí mật/kết nối | `secret_refs`, `proxies` | Secret reference chỉ gồm provider/reference/status/time; không có ciphertext, encryption key, cookie, token hay password columns. Proxy có protocol/host/port và secret reference; đây chỉ là cấu hình, không chứng minh tổ hợp giao thức/xác thực đã hỗ trợ. |
| Tài khoản | `accounts`, `account_identities`, `browser_profiles` | Hai slot hoạt động 1/2 bằng partial unique index. Account archived vẫn giữ lịch sử; slot được dùng lại bằng account row mới. Identity snapshot bất biến có version và remote identity ID. `current_identity_id` phải thuộc chính account đó bằng composite FK. Profile có managed directory UUID, một profile/account, proxy reference tùy chọn. |
| Đích | `destinations`, `account_destinations`, `page_connections` | Unique external ID/canonical URL theo channel. Membership/quyền/source/checked_at thuộc từng account–destination, không suy chung cả hai account. Page connection có composite FK đến đúng Page destination và đúng remote Page ID. Page secret/permission riêng browser session. |
| Máy/ảnh | `products`, `product_revisions`, `media`, `product_revision_media` | Product giữ current revision qua composite FK cùng product; revision append-only. Media lưu managed storage UUID và immutable hash/MIME/bytes, state có thể chuyển ready/missing. Junction bảo vệ ownership/position không âm, không ảnh trùng trong cùng revision. |
| Nội dung/duyệt | `content_versions`, `content_version_media`, `approvals`, `approval_revocations` | Content version bất biến gắn product revision và destination nếu đã chọn. Draft generic có destination NULL; không thể approve nó cho một đích khác. Media version phải lấy từ đúng product revision. Approval snapshot chọn chính xác identity+destination+content; thu hồi bằng bản ghi revocation riêng, không viết lại approval. |
| Ý định/tác vụ | `command_requests`, `publish_jobs`, `publish_attempts`, `publish_observations` | Request có scope/key unique và payload fingerprint bất biến. Job chỉ giữ approval ID để resolve danh tính/đích/content thống nhất. Attempt giữ mốc gửi và kết thúc write-once. Observation append-only ghi outcome/source/time/remote result khi có. |
| Khóa tài nguyên | `resource_leases` | PK `browser:<account UUID>` hoặc `page:<connection UUID>` đúng FK, owner/fence/expiry. Fence không giảm, đổi owner phải tăng, không DELETE/REPLACE reset fence. |
| Quét | `scan_runs`, `scan_results` | Run giữ account/identity/mode/query/limit/simulated snapshot; status/progress metadata có thể cập nhật nhưng không gán lại identity. Result append-only, unique run–group, source account resolve qua run; lưu observed metadata/time và unknown field rõ ràng. Chưa có scanner. |
| Preset/nhật ký | `posting_presets`, `preset_targets`, `activity_log` | Preset có JSON object policy, chưa nghiệm thu semantics lịch. Target cặp account/Page–destination ràng buộc như approval nhưng chưa duyệt nội dung. Activity append-only chỉ action/reason code cùng FK job/run và thời gian, không raw body/error dump. |

Tổng cộng 26 bảng mới; bản ghi `schema_migrations`/`app_meta` có trước không được thay thế.

## Danh tính, nội dung và ảnh đã duyệt

Approval dùng các composite FK:

- `(content_version_id, destination_id)` → content version đã chọn đúng đích.
- `(destination_id, channel)` → đúng loại profile/group/Page.
- Browser: `(account_identity_id, account_id)` → identity snapshot đúng chủ, và `(account_id, destination_id)` → quan hệ account–đích tồn tại.
- Page: `(page_connection_id, destination_id)` → đúng Page connection–đích.
- CHECK yêu cầu browser có cả account+identity và không có Page connection; Page có Page connection và không có account/identity browser.

Trigger khi approve yêu cầu account chưa archive và identity đang current, hoặc Page connection chưa archive. Profile destination external ID phải bằng remote identity ID của account. Điều này kiểm tra tính nhất quán **dữ liệu đã lưu**, không chứng minh đúng người đang đăng nhập Facebook hay quyền đăng thật.

Ảnh được chọn phải có ít nhất một bản ghi, đều `ready` và thứ tự liên tục từ 0. Composite FK version–revision và revision–media chặn ảnh thuộc revision khác. Source revision media không được thêm sau khi đã có content version sử dụng; selected content media không được thêm sau approval. Junction và content/revision/identity/approval snapshots không UPDATE/DELETE. Media bytes identity không được sửa, chỉ state còn mutable cho việc phát hiện file mất sau này.

Job không có các cột account/content/destination riêng để client chọn lại sai với approval. Đổi approval của job bị chặn. Thu hồi approval ngăn tạo job mới; việc xử lý job đang có phải do transaction nghiệp vụ P02.3/P05/P07.

## Idempotency và kết quả

- `(scope, request_key)` unique; cùng key phải đọc và so fingerprint trong transaction P02.3. Schema bảo vệ tính unique/bất biến, **chưa triển khai** cách trả response cũ hoặc conflict khi payload khác.
- Unique `(request_id, approval_id)` và trigger mỗi request–target identity chỉ có một job, kể cả hai approval ID khác nhau. Target identity dùng account hoặc Page connection + destination. Một request có thể chứa nhiều đích/danh tính. Request mới được phép sử dụng lại approval cho một ý định đăng lại có chủ đích.
- Job có đúng 10 trạng thái trong `JOB_STATUSES`. `running` cần claim owner/generation/time/expiry. Chưa có state-transition graph hoặc claim algorithm ở schema nền.
- `send_started_at` chỉ được ghi lần đầu, không xóa/đổi; attempt/job không được xóa để tránh mất dấu đã có thể gửi. `finished_at` khi có cũng write-once. Bước thực hiện phải commit mốc gửi **trước** side effect; schema không tự thực hiện điều này.
- Observation có source explicit `fake`, `api_response`, `ui_observation`, `manual`; outcome `published`, `pending_approval`, `unknown`, `failed`, `not_found`. Published cần remote ID/link không rỗng. Fake source không gắn live approval; API/UI source không gắn fake approval. Manual luôn cần được diễn giải cùng approval mode.
- Observation không tự cập nhật job status. Không có trigger biến pending thành published hoặc unknown thành queued. Recovery/no-retry khi đã bắt đầu gửi thuộc repository/scheduler; chưa được coi là hoàn thành bởi CHECK/trigger.

## Index và những giới hạn còn lại

Index due chỉ gồm job queued `(scheduled_at,id)`; các index approval/status, FK child, observation attempt/time, account membership, scan account/status và lease expiry phục vụ các luồng dự kiến. Chưa benchmark workload thật.

Destination identity (channel/external ID/canonical URL) và Page binding hiện bất biến suốt đời. Một group nhập bằng URL rồi quan sát được ID mới có thể lưu ID ở `scan_results.observed_external_id`, nhưng **chưa có merge/enrichment** cho canonical destination; cần thiết kế ở P06 trước khi sử dụng thực tế. Không lén đổi đích của lịch sử để gộp trùng.

P02.3/P05/P07 còn phải kiểm tra current product revision, selling/paused/archive, quyền account/group/Page còn hiệu lực, approval revocation, media ready và file vật lý ngay trước tạo/nhận/gửi job. Khi nguồn đổi hoặc máy sold phải invalidate/dừng đúng transaction. Những việc này không được tự suy từ FK hoặc approval cũ.

P02.4/P02.7 còn phải bảo vệ path thực, kiểm MIME/hash/bytes và ghi file atomic; DB chỉ lưu managed UUID, không đọc được ổ đĩa để xác minh. P02.5 còn phải chọn kho bí mật/quyền file; secret reference row không phải mã hóa. P03/P07 còn phải có khóa profile thực và holder abort khi mất lease; fence DB không ngăn một browser process cũ tiếp tục chạy.

## Bằng chứng migration đã chạy

`packages/storage/src/schema.test.ts` dùng DB tạm/in-memory. Test nâng bản v1 có sentinel chưa checkpoint trong WAL, gọi `node:sqlite.backup()` online, nâng DB hiện tại lên v2 giữ dữ liệu; copy snapshot sang đường dẫn restore riêng, xác nhận vẫn v1 và dữ liệu cũ còn, rồi nâng bản restore lên v2. Không ghi đè DB vận hành và không phải chức năng restore production P11.

Test còn xác nhận fresh/noop/rollback, FK identity/target/content/media, order/immutability, slot giới hạn, intent dedup, trạng thái/provenance, marker/fence không bị xóa và OR REPLACE không phá lịch sử qua connection được cấu hình. DO NOTHING giữ request cũ; conditional lease UPSERT chỉ nhận lease hết hạn với fence hợp lệ. Đây là ràng buộc/khả năng SQL, chưa phải repository hoàn chỉnh. Nhật ký `report_daily.md` ghi lệnh/kết quả cụ thể sau tích hợp.
