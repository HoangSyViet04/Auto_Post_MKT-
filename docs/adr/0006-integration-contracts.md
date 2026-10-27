# ADR 0006 — Publisher/scanner có context, nguồn quan sát và fake offline

- Ngày: 2026-10-27
- Trạng thái: Đã chấp nhận
- Phạm vi: lõi giao ước P02.6; chưa nối repository/scheduler/thu thập UI

## Bối cảnh

Một job phải giữ đúng đích, danh tính và phiên bản đã duyệt. Kết quả `published`, `pending_approval` và `unknown` không được thay thế cho nhau; verify chỉ đọc. Quét nhóm phải giữ nguồn, thời điểm và tài khoản quan sát, không suy quyền đăng từ việc tìm thấy nhóm.

P00.6 đã có fake publisher và các fixture chỉ gồm job/đích/caption/media. Cần giữ các bài thử offline này hoạt động, đồng thời định nghĩa boundary rõ cho scheduler và adapter thật về sau. Chưa có kết luận Facebook thật hoặc driver đăng/quét thật.

## Quyết định

1. `PublishRequest` dùng readonly, giữ các trường cũ và thêm `context` tùy chọn để tương thích **chỉ đường fake**. `ApprovedPublishRequest` bắt buộc context gồm request ID, approval ID, content version ID, expected identity (account hoặc Page, local/remote ID), và channel/remote ID của đích. `assertApprovedPublishRequest` kiểm tra runtime, kể cả media không rỗng; lỗi không echo dữ liệu đầu vào. Scheduler/live tương lai phải dùng boundary đã duyệt này, không nhận legacy chỉ dựa job ID.
2. `PrepareResult` thất bại có reason code và lời giải thích; fake có thể dựng session expired/checkpoint/identity mismatch để kiểm tra điều phối offline. Mismatch channel bị chặn trước gửi. TCN/Page phải có remote ID đích trùng remote ID danh tính mong đợi; group có thể khác. Chưa kiểm tra sự tồn tại/quyền đọc file, danh tính thực tế hay trạng thái Facebook; các việc đó thuộc media manager/browser/adapter thật.
3. Giữ các status submit đã có. Kết quả có evidence với source và thời điểm; fake luôn ghi `source=simulated`, không cho fixture giả mạo chứng cứ Graph API/browser. Verify giữ `not_found` và `unknown` riêng; `not_found` không cấp quyền phát lại. Snapshot job/đích/caption/media/context phải khớp thì mới đối chiếu kết quả cũ, không xác nhận theo riêng job ID.
4. Fake copy/freeze request, array media, context, identity, destination và kết quả; caller sửa input hoặc object trả về không đổi bản ghi mô phỏng. Verify chỉ đọc, không submit. Callback fixture ném lỗi lúc gửi được ghi `unknown`, không kết luận chưa gửi. Không thêm cơ chế retry hoặc idempotency ngoài repository job; fake không cam kết exactly-once.
5. `stop()` trả kết quả rõ: yêu cầu dừng đã nhận, chặn lượt tiếp theo, không thu hồi bài từ xa. Fake đồng bộ trong bộ nhớ có `inFlight=none`; adapter thật về sau phải dùng `unknown` khi không xác định được tác vụ đang gửi, không mượn kết luận của fake.
6. `ScanRequest` phân biệt joined/keyword, có run ID, account ID, expected remote identity và result limit nguyên từ 1 đến 1.000. Đây là giới hạn tài nguyên cục bộ, không phải ngưỡng Facebook hay cam kết tìm đủ. Keyword không rỗng. `assertScanRequest` là kiểm tra runtime cho consumer.
7. `ScanObservation` giữ URL, group ID nếu có, tên/mô tả nếu quan sát được, visibility/member count, account, source và observedAt; membership, postingPermission và approvalRequired có trạng thái `unknown`. Fake không suy những trường này từ mode joined/keyword, không suy ID từ URL hoặc biến trường thiếu thành 0. Fixture sai account bị từ chối rõ, không trộn dữ liệu hai tài khoản.
8. `ScanResult` giữ trạng thái completed/partial/stopped/blocked/failed, danh sách đã đọc, reason code, observedCount và scopeComplete. Completed/scopeComplete chỉ nói phạm vi request đã xong, không có nghĩa tất cả nhóm Facebook. Chạm limit chuyển partial; fixture checkpoint/lỗi có thể giữ phần đã đọc. Stop chặn scan sau, không xóa kết quả đã trả. Fake chỉ đọc fixture đã copy/freeze trong bộ nhớ, không gọi mạng/browser/DB. Cấu hình fixture có status/reasonCode ngoài giao ước bị từ chối runtime; capabilities được freeze để không đổi cờ mô phỏng.

## Bằng chứng và giới hạn

Test fake publisher/scanner thay `fetch` bằng hàm ném lỗi; kiểm tra unknown/pending/stop, snapshot isolation, verify sai context/đích/nội dung, reason codes, nguồn simulated, membership/quyền chưa rõ, limit/partial, account mismatch và validation. Các fixture không chứng minh một khả năng Facebook thật đã đạt.

P02.6 mới có lõi contract/fake. Ánh xạ row DB thành approved request, claim/transaction và lưu evidence thuộc P02.3/P07; chuẩn hóa/lưu/dedup scan và UI thuộc P06; kiểm chứng identity/permission/selector/API thuộc P01/P08/P09. Không đánh dấu các phần này hoàn thành bằng giao ước TypeScript.

Không thêm dependency hoặc cú pháp cần transform; TypeScript chạy trực tiếp Node 24, import nội bộ qua `#contracts`, các file cùng module dùng đuôi `.ts`.
