# spikes/

Mã thử nghiệm P01. Chạy thủ công từng bước, không import vào `apps/` và không tự chạy khi mở app.

Hiện chỉ có **harness offline với fake publisher**, chưa có Playwright/Graph API driver, không mở profile hay gọi Facebook/proxy. Không dùng kết quả này để xác nhận khả năng tích hợp thật.

```sh
node spikes/run.ts --help
node spikes/run.ts --scenario=unknown
node spikes/run.ts --scenario=pending_approval --channel=group
node spikes/run.ts --scenario=stop --mode=fake
```

Scenario: `published`, `pending_approval`, `unknown`, `stop`, `expired`, `checkpoint`, `ambiguous_selector`. Channel: `profile`, `group` (mặc định), `page`. Phải chọn scenario rõ ràng; chạy không đối số báo lỗi mà không tạo/gửi tác vụ. Chỉ nhận `fake`; `live` hoặc cấu hình `APM_INTEGRATIONS=live` bị từ chối. Lỗi đầu vào không echo đối số/env để tránh ghi bí mật dán nhầm.

`expired`/`checkpoint`/`ambiguous_selector` là fixture ở controller chặn trước submit; **không phải** logic phát hiện phiên/checkpoint/selector trên browser. `stop` kiểm tra fake publisher sau stop không prepare/submit. `unknown` chỉ submit một lần rồi verify chỉ đọc; không tự retry. Log cấu trúc có `simulated: true`, `realCapability: not_tested`, stage/outcome/count; chỉ stdout qua `#logging`, không lưu file, ảnh, trace hay session.

Test: `node --env-file=tests/test.env --test tests/spikes/offline.test.ts` (cũng nằm trong `npm test`). Bảng khả năng/đầu vào còn thiếu: [docs/feasibility.md](../docs/feasibility.md).

Khi triển khai driver thật sau này, bằng chứng vận hành phải nằm ngoài repo dưới thư mục dữ liệu ứng dụng; không ghi cookie/token/password/API key vào ảnh/trace/log. Không mở profile hoặc gửi bài thật trước khi người vận hành chọn rõ tài khoản/đích cho lượt thử.
