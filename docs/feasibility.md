# Kiểm chứng khả năng tích hợp — P01

Ngày lập: 2026-10-27. **Chưa có khả năng Facebook/proxy thật nào được xác nhận đạt.** Dự án đang có công cụ mô phỏng chủ động để kiểm tra luồng điều khiển, không có driver browser/Graph API thật.

## Bằng chứng hiện có và ý nghĩa

`spikes/run.ts` chỉ tạo fake publisher trong bộ nhớ khi người vận hành chọn scenario. Chế độ live bị từ chối; không profile, cookie, API token, network hay tác vụ gửi thật. Kết quả luôn có `simulated: true` và `realCapability: not_tested`.

Các fixture published/pending/unknown kiểm tra việc giữ kết quả trả về. Unknown chỉ submit một lần rồi verify, không retry. Stop ngăn prepare/submit sau khi dừng. Expired/checkpoint/ambiguous_selector chỉ mô phỏng quyết định chặn trước submit bằng mã lý do cố định, chưa có bộ phát hiện browser hay selector để nghiệm thu.

Lệnh kiểm tra và kết quả chạy thật được ghi trong `report_daily.md`. Chạy lại một fixture không bổ sung bằng chứng độ ổn định của Facebook.

## Ma trận khả năng

| Khả năng / phần | Trạng thái thật | Bằng chứng đang có | Điều kiện tiếp theo |
| --- | --- | --- | --- |
| P01.1 công cụ thử chủ động | Đã có nền offline; driver thật chưa có | CLI explicit scenario, fake only, log qua bộ lọc chung; test không tự chạy khi thiếu scenario | Thêm driver từng bước theo quyền/phạm vi tài khoản được chọn, không tự submit |
| P01.2 hai profile và danh tính | **Đạt một phần** (1 profile, 1 lần) | 27/10/2026, nick phụ `phu1`: Playwright + Edge, profile riêng; người dùng tự đăng nhập (Facebook yêu cầu xác minh giữa chừng, người dùng tự xử lý, công cụ chỉ chờ); danh tính lưu dạng băm; `verify` ở tiến trình mới → `match`. Khóa profile chặn tiến trình thứ hai (test) | Còn thiếu: profile thứ hai, mở lại sau khi khởi động lại máy, lặp lại nhiều lần; ghi nhận Facebook có thể đòi xác minh ngay lần đăng nhập đầu bằng trình duyệt tự động |
| P01.3 trực tiếp/proxy | Chưa kiểm chứng | Chưa có proxy hay phép thử mạng | Cấu hình proxy do người vận hành cung cấp qua kênh cấu hình cục bộ; ghi giao thức/xác thực được thử, timeout/cancel và mạng thực dùng; không dán bí mật vào Git/log |
| P01.4 TCN | Chưa kiểm chứng | Fake profile published/unknown không chứng minh đăng thật | Chọn tài khoản và TCN đích cho lượt thử; driver nhận diện đúng danh tính/đích, caption/nhiều ảnh và căn cứ link/kết quả |
| P01.5 group | Chưa kiểm chứng | Fake pending/unknown chỉ giữ trạng thái mô phỏng | Chọn group và tài khoản có quyền, kiểm tra nội quy/quyền đăng; phân biệt submitted/pending/published/unknown bằng bằng chứng thật |
| P01.6 đọc nhóm đã tham gia | Chưa kiểm chứng | Có contract/fake scanner P02.6, chưa có driver UI thật | Tài khoản và phạm vi đọc rõ ràng; driver ghi nguồn/thời điểm/trường thiếu/kết quả một phần và nút dừng |
| P01.6 tìm nhóm theo từ khóa | Chưa kiểm chứng | Có contract/fake scanner P02.6, chưa có driver UI thật | Chọn tài khoản/từ khóa/giới hạn; không suy quyền đăng hoặc đã tham gia từ kết quả tìm kiếm |
| P01.7 Page API | Chưa kiểm chứng | Fake page không gọi Graph API | Meta App/Page được chọn và quyền hợp lệ; kiểm chứng phiên bản API/quyền, sau đó chữ/một ảnh/nhiều ảnh; không coi token hợp lệ là đủ quyền đăng |
| P01.8 dừng/phiên hết hạn/cảnh báo | Chỉ kiểm tra fixture offline | Stop không submit; expired/checkpoint fixture chặn trước submit | Driver thật phải dừng an toàn trước gửi; dùng mô phỏng cho cảnh báo/checkpoint, không cố gây vi phạm; kiểm tra riêng tình huống đã bắt đầu gửi |
| P01.9 selector/UI/xác nhận | Chưa kiểm chứng | Ambiguous selector fixture không có DOM/selector thật | Ghi selector/ngôn ngữ/UI và dấu hiệu quan sát khi có driver; nhiều nút mơ hồ thì dừng, không thử bấm hàng loạt |
| P01.10 kết luận theo kênh | Bảng ban đầu, chưa kết luận khả thi | Ma trận này phân biệt rõ chưa kiểm chứng và fixture | Thử lại có mục đích sau restart, ghi bằng chứng/giới hạn riêng từng khả năng rồi mới chốt đạt/chưa đạt |

## Điều kiện chuyển bước

P01 còn mở. Chưa chốt tự động hóa TCN/group/Page/scanner hoặc hỗ trợ một giao thức proxy nào. Các module độc lập có thể tiếp tục với adapter giả theo plan, nhưng không được đánh dấu tích hợp thật đạt dựa trên harness này.

Việc hiện cần từ người vận hành trước khi thử thật là lựa chọn rõ tài khoản, đích và phạm vi lượt thử; secrets chỉ đi qua cấu hình được bảo vệ ở máy cục bộ. Không yêu cầu gửi cookie/mật khẩu vào chat hoặc Git. Trước khi đủ điều kiện, công cụ chỉ chạy offline và không mở Facebook.
