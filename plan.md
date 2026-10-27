# Kế hoạch triển khai Auto Post MKT

> Cập nhật: 26/10/2026.
> Trạng thái: P00 đã hoàn thành; chưa có thử nghiệm Facebook thật nào được xác nhận hoàn thành.
> Tài liệu yêu cầu: [README.md](README.md). README mô tả sản phẩm; tài liệu này xác định thứ tự và cách triển khai.

## 1. Kết quả cuối cùng cần đạt

Xây từ đầu ứng dụng dùng nội bộ trên Windows cho một người vận hành và tối đa hai tài khoản Facebook. Mỗi máy chỉ cần nhập **ảnh + tên máy + tình trạng máy**; ứng dụng tạo caption cơ bản, ghép ảnh, sử dụng cấu hình tài khoản/nơi đăng đã lưu, cho xem trước, lên lịch và ghi nhận kết quả.

Bốn mục điều hướng chính:

```text
Quản lý tài khoản
Quản lý proxy
Chức năng đăng bài
  ├─ Đăng bài viết nhóm
  ├─ Đăng bài viết cá nhân
  └─ Đăng bài fanpage
Quét nhóm
  ├─ Nhóm đã tham gia
  └─ Tìm nhóm theo từ khóa
```

Hai mốc bàn giao:

- **Bản cơ bản không cần AI:** hoàn thành P00–P12 với caption từ mẫu và các kênh đã kiểm chứng. Chỉ gọi là đủ phạm vi ba kênh khi TCN, group và fanpage đều đạt nghiệm thu riêng.
- **Bản nâng cấp AI:** P13, thực hiện sau khi bản cơ bản chạy được. AI không phải điều kiện để nhập máy và đăng bài.

Không kế thừa nguyên mã nguồn hai repo đã review. Có thể học cách chia module, xử lý nhiều ảnh và lịch; nếu sao chép mã cụ thể về sau phải kiểm tra giấy phép và ghi nguồn.

## 2. Nguyên tắc thực hiện

1. Làm từng phần có đầu ra quan sát được; kiểm chứng phần đăng sớm, trước khi xây đầy đủ giao diện.
2. Bản mẫu thử nghiệm chưa được coi là bộ đăng ổn định. Một lần đăng thành công không chứng minh hỗ trợ mọi nhóm/tài khoản.
3. Giá, dung lượng, pin, bảo hành, số lượng và caption nhập tay không bắt buộc khi tạo máy. Thiếu dữ liệu tùy chọn thì bỏ khỏi bài, không tự điền.
4. Tác vụ thật phải gắn với đúng tài khoản, đích và phiên bản đã xem trước. Ảnh lỗi không được âm thầm biến bài thành chỉ có chữ.
5. Quét nhóm và đăng bài cùng tài khoản dùng chung khóa tài nguyên trình duyệt; không tranh quyền điều khiển một phiên.
6. Không rõ Facebook đã nhận bài thì chuyển cần kiểm tra; không tự thử lại để ép thành công.
7. Proxy là kết nối tùy chọn, không bảo đảm tránh checkpoint/khóa. Không xoay IP hoặc chuyển tài khoản để tiếp tục tác vụ đang bị chặn.
8. Kiểm thử thật chỉ chạy trên tài khoản và đích người vận hành đã chọn rõ cho lượt thử. Lập kế hoạch không đồng nghĩa cho phép đăng bài thật ngay.
9. Kênh không đạt phải ghi đúng giới hạn và đánh giá lại phạm vi; không đổi sang bán tự động rồi đánh dấu yêu cầu tự động đã hoàn tất.
10. Sau mỗi phần cập nhật trạng thái, bằng chứng kiểm tra và tồn đọng; chỉ đánh dấu hoàn thành khi đạt tiêu chí.

## 3. Hướng kỹ thuật ban đầu

Đây là phương án đề xuất, chốt lại tại P00–P01 trên Windows thực tế.

| Phần | Hướng lựa chọn | Lý do và giới hạn |
| --- | --- | --- |
| Ngôn ngữ | TypeScript | Dùng chung kiểu giữa giao diện, dịch vụ và worker |
| Runtime | Node.js LTS còn hỗ trợ; xem xét dòng 24 làm khởi điểm | Khóa phiên bản và kiểm tra dependencies Windows; đối chiếu [lịch Node.js](https://nodejs.org/en/about/previous-releases) khi cài |
| Giao diện | React + Vite, tiếng Việt | Ứng dụng quản trị cục bộ; theo tài liệu [React](https://react.dev/learn) và [Vite](https://vite.dev/guide/) |
| Server | Fastify trên loopback | Dữ liệu, file và lệnh nghiệp vụ; dùng [tài liệu Fastify](https://fastify.dev/docs/latest/) đúng phiên bản |
| Dữ liệu | SQLite, migration có phiên bản | Một người/hai tài khoản; chọn driver chạy được trên Windows tại P00; chưa cần Redis/cloud DB |
| Browser | Playwright, profile riêng của ứng dụng | Người dùng tự đăng nhập; đối chiếu [persistent context/proxy](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context); không dùng profile Chrome mặc định |
| Worker | Tiến trình Node riêng, dùng DB chung | Đóng/mở UI không được tạo thêm scheduler; khóa phiên ứng dụng đang chạy |
| Fanpage | Graph API với quyền hợp lệ | Chốt phiên bản và quyền tại P01; có token không đồng nghĩa đã có quyền đăng |
| LLM | Adapter thay nhà cung cấp được | P13; bảo vệ API key, không gửi bí mật phiên Facebook |
| Tiến độ UI | Polling trước; cân nhắc SSE khi cần | Giảm thành phần và dễ kiểm tra |

**Quyết định về lịch:** bản đầu giữ lịch cục bộ cho cả ba kênh. Page được gọi API khi job đến hạn; chưa gửi lịch tương lai để Facebook giữ. Nhờ vậy, dừng lịch khi máy đã bán hoặc dữ liệu đổi dùng chung một cơ chế. Máy và ứng dụng phải hoạt động lúc chạy. Nếu thêm lịch giữ trên Facebook về sau, cần đồng bộ/hủy lịch từ xa riêng.

### Cấu trúc dự kiến

```text
apps/
  web/                    Giao diện bốn mục chính và trang phụ (React + Vite)
  server/                 API cục bộ, file và lệnh nghiệp vụ; không điều khiển Playwright
  worker/                 Lịch, phiên, quét và thực hiện đăng; tiến trình duy nhất dùng Playwright
packages/
  domain/                 Kiểu, trạng thái, quy tắc dùng chung (không dùng API Node)
  config/                 Cấu hình runtime, thư mục dữ liệu
  storage/                SQLite, repository, media, secrets
    migrations/           Lịch sử thay đổi DB
  integrations/
    contracts/            Giao ước adapter và adapter giả
    browser/              Profile, khóa phiên, danh tính
    facebook-profile/     Đăng TCN
    facebook-group/       Đăng và thu thập thông tin nhóm
    facebook-page/        API fanpage
    llm/                  Bổ sung P13 (chưa tạo)
scripts/                  Setup, khởi chạy, chẩn đoán
tests/e2e/                Kiểm tra xuyên suốt; unit test đặt cạnh mã (*.test.ts)
spikes/                   Mã thử P01, không tự chạy khi mở app
docs/adr/                 Quyết định kỹ thuật
CLAUDE.md                 Hướng dẫn cho agent
report_daily.md           Nhật ký bàn giao từng lượt làm việc (có thời gian)
README.md
plan.md
```

Đã tạo ở P00.3. Bản làm việc đặt tại `D:/Project/Auto_Post_MKT` (ngoài OneDrive), hai máy đồng bộ qua git/GitHub. Dùng **một `package.json` npm, không workspaces/pnpm**. Các module tham chiếu nhau qua `#domain`, `#config`, `#storage`, ... (xem [ADR 0001](docs/adr/0001-onedrive-single-package.md)). Dữ liệu vận hành đặt ngoài mã nguồn, mặc định `%LOCALAPPDATA%/AutoPostMKT/`: DB, media, log, browser profiles, cache. Ghi đè được bằng `APM_DATA_DIR`, không ghi cứng theo máy hiện tại.

## 4. Dữ liệu và giao ước cần thiết kế

### 4.1. Các thực thể

| Thực thể | Nội dung tối thiểu |
| --- | --- |
| Product / ProductRevision | Mã tự sinh, tên/tình trạng gốc, trường tùy chọn chưa có để null, phiên bản, cờ được đăng |
| Media / ProductMedia | File trong kho, hash, MIME, dung lượng, thứ tự, liên kết máy/phiên bản; ảnh giống nhau không đồng nghĩa cùng máy |
| Account / BrowserProfile | Tối đa hai tài khoản, nhãn, danh tính xác nhận, trạng thái, tham chiếu profile/proxy |
| Proxy / SecretReference | Kết nối và tham chiếu bí mật được bảo vệ; không trả mật khẩu thô qua API |
| PageConnection | Page, quyền, trạng thái token, tham chiếu bí mật; tách khỏi phiên browser |
| Destination / AccountDestination | TCN/group/Page, ID/link, quan hệ tham gia/quyền từng tài khoản, nội quy và nguồn |
| ScanRun / ScanResult | Chế độ, đầu vào, tài khoản, phạm vi, tiến độ, kết quả một phần, nguồn/thời điểm |
| PostingPreset | Các cặp tài khoản–đích, mẫu và chính sách lịch tái sử dụng |
| ContentVersion / Approval | Caption, phiên bản máy, thứ tự ảnh, ngữ cảnh, nguồn mẫu/nhập tay/LLM, phiên bản được duyệt |
| PublishJob / PublishAttempt | Một đích, lịch, phiên bản bài, trạng thái, khóa nhận, mốc trước/sau gửi, lần thử |
| PublishResult / ActivityLog | Job, kết quả, link/ID nếu có, nguồn xác nhận, thời gian, lỗi đã lọc bí mật |
| ResourceLease | Quyền dùng phiên tài khoản/Page, chủ sở hữu, nhịp sống worker để ngăn chạy chồng |

### 4.2. Trạng thái và chống trùng

Bản nháp/duyệt thuộc nội dung; job chỉ tạo từ nội dung đã duyệt.

| Trạng thái job | Ý nghĩa |
| --- | --- |
| queued | Chờ lịch và được nhận |
| running | Đang chuẩn bị/gửi, có mốc đã bắt đầu gửi hay chưa |
| published | Có căn cứ xuất bản, không chỉ đã bấm nút |
| pending_approval | Đã gửi group, chờ duyệt |
| paused | Người dùng tạm dừng |
| blocked | Phiên/proxy/quyền/điều kiện đích chưa đáp ứng |
| needs_review | Máy hoặc nội dung đổi, cần xem lại |
| unknown | Có thể đã gửi, phải đối chiếu trước thử lại |
| failed | Lỗi xác định, thông báo cách xử lý |
| cancelled | Hủy trước gửi; không ngụ ý thu hồi bài Facebook |

Quy tắc bắt buộc:

- Nhận job bằng cập nhật có điều kiện trong transaction; không lấy danh sách rồi cập nhật bất kể trạng thái đã đổi.
- Khóa browser theo tài khoản cho cả đăng/quét/mở phiên; khóa tài nguyên Page tương ứng khi cần.
- Mã yêu cầu từ UI ngăn cùng thao tác tạo nhiều job khi bấm lại/mất phản hồi; không cấm vĩnh viễn quảng bá lại có chủ đích.
- Chống trùng theo đích, danh tính, phiên bản/lượt đăng. Page A thành công không được khiến Page B thất bại bị bỏ qua mãi.
- Ghi mốc trước thao tác có thể tạo bài; crash sau mốc đó thì cần đối chiếu, không phát lại vì khóa hết hạn.
- Khóa cục bộ không bảo đảm Facebook chỉ nhận một lần khi mạng lỗi; không cam kết exactly-once.
- Dừng ngăn job tiếp theo; job đang gửi báo yêu cầu dừng và kết quả thực tế. Nếu Facebook đã nhận, không hiển thị đã hủy trước gửi.

### 4.3. Giao ước adapter

- `capabilities`: định dạng/chức năng đã kiểm chứng, mức tự động/bán tự động/chưa hỗ trợ.
- `prepare`: kiểm tra danh tính, quyền, đích, media và dữ liệu; chưa xuất bản.
- `submit`: gửi đúng phiên bản đã duyệt, trả kết quả xác định hoặc chưa rõ.
- `verify`: đối chiếu chỉ đọc, không tạo thêm bài.
- `stop`: ngăn phần chưa làm và báo phần đã thực hiện, không ngụ ý thu hồi mọi yêu cầu từ xa.

Adapter giả phục vụ kiểm tra offline, không gọi Facebook/LLM. UI phải hiển thị rõ chế độ mô phỏng.

## 5. Bảng thứ tự triển khai

P00 đã hoàn thành; các phần tiếp theo theo trạng thái bên dưới. Pxx là mã phần giao việc, không phải phiên bản sản phẩm.

| Phần | Đầu ra | Phụ thuộc | Trạng thái |
| --- | --- | --- | --- |
| P00 | Nền dự án, môi trường Windows | README/plan | Hoàn thành (P00.1–P00.8) |
| P01 | Bằng chứng khả thi các tích hợp | P00 | Đang chuẩn bị offline; chưa kiểm chứng thật |
| P02 | DB, media, bí mật, giao ước | P00, kết luận P01 | Đang làm offline (P02.1–P02.4, P02.6 xong); chưa nghiệm thu toàn phần |
| P03 | Quản lý tài khoản | P01, P02 | Chưa bắt đầu |
| P04 | Quản lý proxy | P02, P03 | Chưa bắt đầu |
| P05 | Ba đầu vào, mẫu bài, phiên bản | P02 | Chuẩn bị quy tắc caption offline; chưa UI/media/phiên bản |
| P06 | Quét nhóm và danh sách đích | P01–P04 | Chưa bắt đầu |
| P07 | Hàng chờ/lịch với mô phỏng | P02–P06 | Chưa bắt đầu |
| P08 | Adapter TCN/group hoàn chỉnh | P01, P03–P07 | Chưa bắt đầu |
| P09 | Kết nối và đăng fanpage | P01, P02, P05, P07 | Chưa bắt đầu |
| P10 | Ba trang đăng tích hợp | P05–P09 | Chưa bắt đầu |
| P11 | Nhật ký, đối chiếu, phục hồi | P07–P10 | Chưa bắt đầu |
| P12 | Kiểm thử tổng thể, chạy Windows, bàn giao | P00–P11 | Chưa bắt đầu |
| P13 | LLM theo ngữ cảnh | P12 | Chưa bắt đầu |

Mặc định thực hiện từ trên xuống. Khi chờ quyền Page hoặc điều kiện thử ngoài, có thể làm dữ liệu/UI độc lập bằng adapter giả, nhưng không đánh dấu tích hợp đã kiểm chứng. Chốt ước lượng thời gian sau P01; đây chưa phải lịch cam kết theo ngày.

## 6. Công việc chi tiết

### P00 — Khởi tạo nền tối thiểu

**Mục tiêu:** có nơi chạy thử trên Windows, giữ nguyên tài liệu đã thống nhất.

- [x] P00.1. Kiểm tra Node, công cụ cài dependency, browser thử và đường dẫn dữ liệu; ghi phiên bản/giới hạn máy. *(Node 24.16.0, npm 11.13.0, git 2.54; browser Playwright kiểm tra ở P01.)*
- [x] P00.2. Khởi tạo Git nếu chưa có, giữ README/plan; ignore dữ liệu, ảnh, profiles, secrets, log và file môi trường.
- [x] P00.3. Tạo workspace TypeScript web/server/worker và kiểu dùng chung; khóa dependencies bằng lockfile. *(Một package npm + `#alias`, theo ADR 0001.)*
- [x] P00.4. Chọn SQLite driver chạy được trên Windows; thử DB tạm và migration tối thiểu. *(`node:sqlite` tích hợp sẵn, WAL, migration có checksum — ADR 0002.)*
- [x] P00.5. Dựng API health, UI bốn mục; hành động chưa có ghi chưa triển khai. *(Fastify `GET /api/health` trên 127.0.0.1:4317, UI hash-routing, Vite proxy `/api`.)*
- [x] P00.6. Cấu hình dev/test/local và adapter giả mặc định; không tự đăng Facebook khi mở app. *(`APM_INTEGRATIONS=fake` mặc định, `live` cấm trong test và chưa có adapter thật; `.env`/`tests/test.env`; health + UI báo mô phỏng — xem [docs/environment.md](docs/environment.md).)*
- [x] P00.7. Thiết lập typecheck, lint, build và kiểm tra nghiệp vụ; log có lọc bí mật từ đầu. *(Biome 2.6.3; `npm run check`; `#logging` lọc đệ quy trước JSON/pretty, che headers/body/payload; ADR 0003. 34/34 test offline đạt; chưa kiểm chứng Facebook thật.)*
- [x] P00.8. Server chỉ trên loopback; chuẩn bị kiểm tra origin/CSRF và cơ chế truy cập cục bộ cho lệnh thay đổi dữ liệu. Localhost không đồng nghĩa bỏ mọi kiểm tra request. *(Exact Host/Origin/IP, Fetch Metadata, bootstrap token trong bộ nhớ + JSON mutation; client không tự retry; ADR 0004. Test request thật qua Vite proxy và raw HTTP đạt.)*

**Đầu ra:** mã nền, lockfile, cấu hình mẫu không có bí mật thật, tài liệu môi trường.

**Đạt khi:** build/khởi động được, đủ điều hướng, health đúng, DB tạm hoạt động; không có request tạo bài Facebook.

### P01 — Kiểm chứng tích hợp sớm

**Mục tiêu:** xác định phần làm được của từng kênh trước khi xây đầy đủ.

- [ ] P01.1. Viết công cụ thử trong `spikes/`, chạy từng bước chủ động; log/bằng chứng không chứa cookie/token. *(Đã có `npm run spike:offline -- --scenario=...`, 7 fixture fake-only và 5 test; chưa có driver Facebook thật nên chưa đóng mục. Xem docs/feasibility.md.)*
- [ ] P01.2. Tạo hai profile riêng, người dùng đăng nhập thủ công; mở lại và xác nhận danh tính. Không mở cùng thư mục profile bằng hai tiến trình.
- [ ] P01.3. Thử trực tiếp/proxy do người dùng cung cấp; ghi giao thức/xác thực hỗ trợ, lỗi mạng và cách đổi cấu hình.
- [ ] P01.4. Thử TCN: caption, nhiều ảnh, đúng danh tính, đúng đích được chọn; lấy kết quả/link khi đủ căn cứ.
- [ ] P01.5. Thử group: quyền tham gia/đăng, caption/ảnh, phân biệt đã gửi, chờ duyệt, từ chối và unknown.
- [ ] P01.6. Thử đọc nhóm đã tham gia theo tài khoản và tìm theo từ khóa; ghi trường đọc được, kết quả một phần và điều kiện dừng.
- [ ] P01.7. Chuẩn bị ứng dụng Meta, kiểm tra quyền/token/Page, phiên bản API và callback nếu cần; thử chữ/một ảnh/nhiều ảnh trên Page đã chọn. Token hợp lệ chưa đủ chứng minh quyền đăng.
- [ ] P01.8. Kiểm tra dừng trước gửi và phiên hết hạn; mô phỏng checkpoint/cảnh báo/lỗi nguy hiểm, không cố gây vi phạm để thử.
- [ ] P01.9. Ghi selector, ngôn ngữ/UI và dấu hiệu xác nhận; không tự bấm nhiều nút mơ hồ nếu không tìm được phần tử đúng.
- [ ] P01.10. Lập bảng đạt/chưa đạt/bị chặn theo từng khả năng, có điều kiện và bằng chứng. Thử lại có mục đích sau khởi động lại; không đánh giá chỉ bằng một lần thành công.

**Đầu ra dự kiến:** `docs/feasibility.md`, công cụ thử, quyết định kỹ thuật, danh sách khả năng cho bản đầu.

**Điều kiện chuyển bước:** có kết luận riêng cho TCN/group/Page/quét nhóm/tìm kiếm/proxy. TCN/group không đạt thì ngừng mở rộng phần đó và làm rõ lại phạm vi; phần độc lập vẫn có thể tiếp tục. Không cam kết thời gian Meta xét duyệt.

### P02 — Nền dữ liệu, file và giao ước

**Mục tiêu:** các module dùng dữ liệu/quy tắc thống nhất; dữ liệu thật độc lập thư mục mã nguồn.

- [x] P02.1. Thiết kế schema mục 4: foreign key, index lịch, phiên bản, quan hệ tài khoản–nhóm, kết quả từng đích. *(Migration0002 có26 bảng STRICT, composite FK danh tính/đích/content, snapshot/media/approval bất biến, intent/attempt/observation/lease/scan/preset; docs/data-model.md, ADR0005.)*
- [x] P02.2. Migration có phiên bản; kiểm tra nâng cấp và quay về bản sao lưu; không tự xóa DB để cập nhật. *(DB tạm v1→v2/noop/rollback, backup online với WAL rồi restore đường dẫn riêng và upgrade giữ dữ liệu. Không sửa0001; chưa có UI/restore vận hành P11.)*
- [x] P02.3. Repository/transaction cho nhận job, lưu phiên bản, đổi trạng thái; lỗi nghiệp vụ dùng chung. *(Product/content/approval snapshots, batch idempotency, CAS claim/receipt/marker/result/recovery; BusinessError qua #domain. 19 test mới, gồm3 tiến trình/60job và fake end-to-end; ADR0007. Chưa scheduler/khóa profile/physical files hoặc API/UI.)*
- [x] P02.4. MediaStore: chép vào vùng tạm, kiểm tra file, đưa vào kho và hoàn tất metadata; xử lý lỗi giữa chừng, không coi máy có ảnh mất là hợp lệ. *(UUID kho ngoài repo, staging→ready, sharp giải mã JPEG/PNG/WebP thật, SHA256/size verify và missing/failed chặn batch;4test luồng chính, ADR0008. Chưa API/UI/thumbnail hoặc quét orphan sau crash.)*
- [ ] P02.5. Chọn cách bảo vệ secrets trên Windows/quyền thư mục; khóa không nằm cạnh ciphertext trong mã nguồn. Mất khóa thì báo cần kết nối lại.
- [x] P02.6. Giao ước publisher/scanner, trạng thái, adapter giả; phân biệt published/pending/unknown. *(Approved context + runtime validation, fake snapshot/evidence/verify/stop; scanner joined/keyword nguồn/thời điểm/account/unknown/partial/limit; ADR0006. 18/18 contract tests đạt. DB wiring/scheduler/P06 và adapter thật chưa triển khai.)*
- [ ] P02.7. Validation, phân trang, giới hạn upload, bảo vệ đường dẫn; metadata client không được dẫn tới đọc/xóa file ngoài kho.
- [ ] P02.8. Dữ liệu fixture giả và DB test tách khỏi dữ liệu vận hành.

**Đầu ra:** schema, migration, storage, API nền và adapter giả.

**Đạt khi:** dữ liệu tồn tại sau restart; migration không mất dữ liệu; lỗi file nhất quán; API/log không lộ secrets; kiểm tra được nhận job có điều kiện.

### P03 — Tab Quản lý tài khoản

**Mục tiêu:** quản lý hai phiên Facebook đúng danh tính.

- [ ] P03.1. Bảng nhãn, UID/link khi quan sát được, tên/avatar, trạng thái, proxy, lần kiểm tra, tác vụ hiện tại; thống kê có căn cứ.
- [ ] P03.2. Thêm/sửa nhãn/mở/đóng phiên/gỡ; ngăn vượt phạm vi hai tài khoản.
- [ ] P03.3. Tích hợp đăng nhập thủ công và mở lại profile P01; không lưu mật khẩu/2FA vào bảng.
- [ ] P03.4. Kiểm tra danh tính trước tác vụ; không xác nhận được hoặc khác mong đợi thì dừng.
- [ ] P03.5. Khóa profile đang dùng; mở thủ công phải tạm dừng/nhường quyền, không tranh điều khiển worker.
- [ ] P03.6. Tạm dừng từng tài khoản/toàn bộ; gỡ tài khoản thì dừng lịch phụ thuộc, không chuyển sang tài khoản còn lại.
- [ ] P03.7. Phân biệt mất mạng, cần đăng nhập, cần xác minh, chưa rõ; không suy bị khóa từ một lần lỗi trang.

**Đầu ra:** trang tài khoản và BrowserProfileManager.

**Đạt khi:** hai tài khoản mở lại đúng profile, không lẫn phiên; dừng/gỡ xử lý đúng job; UI không lộ mật khẩu/cookie/2FA.

### P04 — Tab Quản lý proxy

**Mục tiêu:** cấu hình mạng theo tài khoản, kiểm tra và báo lỗi rõ.

- [ ] P04.1. Form nhãn/giao thức/host/port/xác thực; chỉ chọn tổ hợp đã kiểm chứng P01.
- [ ] P04.2. Test kết nối với timeout/cancel; IP đầu ra, độ trễ, thời điểm, lỗi. Không suy an toàn tài khoản từ kết quả này.
- [ ] P04.3. Gán/bỏ gán và chế độ trực tiếp; bảng tài khoản phản ánh cấu hình thực sự áp dụng.
- [ ] P04.4. Đổi proxy: tạm dừng, chờ thao tác đang chạy có kết quả xác định, đóng/mở phiên nếu cần, kiểm tra lại trước tiếp tục.
- [ ] P04.5. Proxy lỗi thì dừng job liên quan, không tự fallback trực tiếp; thử cả lỗi giữa lượt chạy.
- [ ] P04.6. Chặn xóa proxy đang dùng; bảo vệ mật khẩu, lọc khỏi URL/log/lỗi.
- [ ] P04.7. Ghi rõ cấu hình mạng browser/Page API/LLM; proxy browser không tự áp vào server.

**Đầu ra:** trang proxy, kiểm tra kết nối và gán cấu hình phiên.

**Đạt khi:** đúng kết nối được gán; lỗi/đổi proxy không làm job tự tiếp tục bằng mạng khác; không lộ xác thực trong log.

### P05 — Nhập máy, ảnh và caption từ mẫu

**Mục tiêu:** luồng sản phẩm hoàn chỉnh không cần Facebook hoặc LLM.

- [ ] P05.1. Form chỉ bắt buộc ít nhất một ảnh, tên, tình trạng; giữ nội dung đang nhập khi validation lỗi.
- [ ] P05.2. Lưu bản sao ảnh, thumbnail và thứ tự; xóa/di chuyển file nguồn không làm hỏng bản đã lưu.
- [ ] P05.3. Tự sinh mã, sửa máy, đánh dấu đã bán/ngừng bán; giá/thông số thiếu là null, không thành 0 hoặc khẳng định tốt.
- [ ] P05.4. Caption mẫu từ tên/tình trạng, bỏ dòng tùy chọn thiếu, xem trước/chỉnh tay. *(Đã có hàm domain thuần `generateProductCaption` và 8 test; phần xem trước/chỉnh tay/UI chưa triển khai nên chưa đóng mục.)*
- [ ] P05.5. Lưu phiên bản máy, caption, ảnh có thứ tự; duyệt gắn đúng phiên bản.
- [ ] P05.6. Phiên bản theo đích và cảnh báo giống nội dung; chưa cần semantic phức tạp hoặc AI.
- [ ] P05.7. Máy sửa sau duyệt thì bài/lịch cần kiểm tra; máy đã bán/ngừng bán ngăn lịch mới và dừng lịch chờ.
- [ ] P05.8. Chỉ xóa ảnh khi không còn tham chiếu cần giữ; ưu tiên ẩn/lưu trữ thay vì mất bằng chứng bài cũ.

**Đầu ra:** trang phụ quản lý máy, thư viện ảnh, soạn bài và phiên bản trong khu vực đăng.

**Đạt khi:** ba đầu vào tạo được caption có ảnh, không bịa giá/pin/bảo hành; giữ thứ tự ảnh và nội dung duyệt; không cần LLM.

### P06 — Tab Quét nhóm và danh sách đích

**Mục tiêu:** tìm/lưu/chọn nhóm theo tài khoản và chuyển sang đăng.

- [ ] P06.1. Nhập link/ID thủ công, chuẩn hóa đích, quan hệ tài khoản–nhóm, nội quy do người dùng ghi nhận.
- [ ] P06.2. Nhóm đã tham gia: chọn tài khoản, đọc theo P01; nhóm vắng trong lượt dở không bị coi đã rời.
- [ ] P06.3. Từ khóa: nhập từ khóa/phạm vi, ghi nguồn/thời điểm; tìm thấy không đồng nghĩa đã tham gia/có quyền.
- [ ] P06.4. ScanRun có tiến độ, điều kiện dừng, kết quả một phần, hủy; tiếp tục nếu hỗ trợ, nếu không chạy lại có loại trùng.
- [ ] P06.5. Lưu tên/link/ID, mô tả, loại nhóm/số thành viên khi quan sát được; thiếu là chưa rõ; không quét thành viên.
- [ ] P06.6. Lọc tên/tài khoản/khu vực có dữ liệu/trạng thái; ghi chú/ưu tiên/không phù hợp; loại trùng nhóm nhưng giữ quan hệ tài khoản.
- [ ] P06.7. Chuyển nhóm chọn sang Đăng nhóm, giữ đúng tài khoản; đích thiếu điều kiện không tự vào hàng chờ.
- [ ] P06.8. Dùng chung khóa phiên; cảnh báo/mất phiên dừng thu thập liên quan.

**Đầu ra:** hai chế độ quét và dữ liệu đích có nguồn gốc.

**Đạt khi:** ghi đúng độ đầy đủ, không lẫn nhóm hai tài khoản, dừng không mất kết quả; chuyển đúng cặp tài khoản–đích. Chế độ chưa đọc tự động được ghi chưa hỗ trợ, không coi nhập tay là hoàn thành quét tự động.

### P07 — Hàng chờ, lịch và dừng bằng mô phỏng

**Mục tiêu:** kiểm chứng điều phối trước khi nối gửi thật.

- [ ] P07.1. Job từ cặp tài khoản–đích được chọn, một đích một kết quả; mã yêu cầu chống bấm gửi hai lần.
- [ ] P07.2. Lưu UTC, hiển thị/lập lịch `Asia/Ho_Chi_Minh`; khoảng cách/giới hạn là chính sách vận hành, không phải ngưỡng chống ban.
- [ ] P07.3. Worker nhận job bằng transaction, khóa tài khoản/Page, heartbeat, kiểm tra worker cũ; tuần tự trong từng tài khoản.
- [ ] P07.4. Trước gửi kiểm tra phiên bản duyệt, máy được đăng, đủ ảnh, tài khoản/đích/quyền và mạng.
- [ ] P07.5. Chạy ngay/hẹn giờ/tạm dừng/tiếp tục/hủy phần chưa gửi; UI đọc trạng thái lưu bền, không chỉ bộ nhớ.
- [ ] P07.6. Mốc chuẩn bị/gửi/kết quả; crash trước gửi khác sau gửi, không tự nhận lại job có thể đã gửi.
- [ ] P07.7. Sau restart liệt kê lịch quá hạn để tiếp tục/bỏ; không phát dồn bài cũ.
- [ ] P07.8. Kiểm tra nhiều đích lỗi xen kẽ: A thành công không ngăn B; mốc lịch theo slot thực tế, không theo số lượt thành công.
- [ ] P07.9. Cảnh báo ngăn job tiếp theo; phân biệt dừng một tài khoản và toàn bộ.

**Đầu ra:** scheduler và state machine chạy trọn với adapter giả.

**Đạt khi:** không nhận trùng job, scan/publish chung khóa; crash/quá hạn/ảnh mất/đổi nguồn không gây phát lại hoặc sai nội dung. Mô phỏng tốt chưa đồng nghĩa được bật scheduler thật.

### P08 — Adapter đăng TCN và group

**Mục tiêu:** chuyển P01 thành bộ đăng có kiểm tra và trạng thái đầy đủ.

- [ ] P08.1. Chia browser session/danh tính/composer dùng chung, đặc thù TCN/group riêng.
- [ ] P08.2. Trước gửi xác nhận đúng người đăng và link/ID đích; kiểm tra điều kiện nhóm qua dữ liệu hiện có và UI.
- [ ] P08.3. Điền caption, đủ ảnh đúng thứ tự, chờ upload có căn cứ; lỗi ảnh/selector thì dừng trước gửi.
- [ ] P08.4. Ghi mốc gửi, chỉ gửi một lần theo lượt; xác nhận bằng bằng chứng quan sát được.
- [ ] P08.5. Group phân biệt pending/published; thiếu căn cứ thì trả unknown/trạng thái thích hợp, không giả thành công.
- [ ] P08.6. Nhận diện lỗi phiên/cảnh báo/UI thay đổi theo phạm vi P01; không tự giải CAPTCHA/checkpoint.
- [ ] P08.7. Dừng/hủy kiểm tra trước gửi; phần đã phát đi được ghi trung thực khi không hủy trước gửi được.
- [ ] P08.8. Kiểm tra offline bằng fixture UI/lỗi mô phỏng; thử thật theo đích được chọn và đối chiếu người đăng/nội dung/ảnh.

**Đầu ra:** hai adapter cùng hàng chờ P07, báo cáo khả năng/giới hạn.

**Đạt khi:** từng kênh có bằng chứng gửi/xác nhận đúng và dừng đúng; kênh chưa đạt tắt rõ. Chỉ một kênh hoạt động chưa đủ đánh dấu P08 hoàn thành.

### P09 — Kết nối và đăng fanpage

**Mục tiêu:** đăng Page qua API, độc lập browser.

- [ ] P09.1. Chọn kết nối theo quyền ứng dụng thực tế; kiểm tra Page/quyền/token. Không mô tả token là không bao giờ bị thu hồi.
- [ ] P09.2. Bảo vệ token, API danh sách Page chỉ trả metadata/trạng thái/khả năng, không token thô.
- [ ] P09.3. Upload ảnh cục bộ bằng dữ liệu file; đủ ảnh đúng thứ tự trước tạo bài, không phụ thuộc URL công khai.
- [ ] P09.4. Tạo bài chữ/ảnh theo khả năng đã kiểm chứng, lưu ID/nguồn xác nhận; phân loại hết quyền/hết hạn/rate limit/mạng.
- [ ] P09.5. Lịch giữ cục bộ; gửi khi đến hạn và sau kiểm tra dữ liệu theo mục 3.
- [ ] P09.6. Timeout sau yêu cầu tạo bài trả unknown khi chưa rõ; không tự tạo lại.
- [ ] P09.7. Gỡ Page dừng lịch phụ thuộc, không đổi Page; xác định riêng cấu hình mạng API.
- [ ] P09.8. Đối chiếu quyền/phiên bản qua [Meta](https://developers.facebook.com/docs/pages-api/posts/) khi làm. Trang này trả lỗi giới hạn truy cập trong phiên lập kế hoạch; chưa xác minh hợp đồng API hiện hành qua trang đó.

**Đầu ra:** PageConnection và PagePublisher dùng hàng chờ chung.

**Đạt khi:** đúng Page nhận đủ nội dung/ảnh, lưu ID/trạng thái, không lộ token; unknown xử lý riêng. Còn chờ quyền Meta thì ghi bị chặn bên ngoài, không xong.

### P10 — Hoàn thiện ba trang đăng bài

**Mục tiêu:** dùng được từ nhập máy đến kết quả trong UI.

- [ ] P10.1. Composer chung: máy, ảnh, caption/phiên bản, tài khoản/đích/lịch; không mất nội dung khi đổi màn hình.
- [ ] P10.2. Đăng nhóm nhận P06 hoặc link/ID, hiển thị điều kiện/nội quy từng nhóm.
- [ ] P10.3. Đăng cá nhân chọn một/hai tài khoản, hiển thị đúng TCN; không tự dùng danh sách group làm đích.
- [ ] P10.4. Đăng fanpage chọn Page có quyền; trạng thái kết nối tách khỏi browser.
- [ ] P10.5. Preset theo cặp tài khoản–đích/mẫu/lịch; hai tài khoản không mặc định nhân đôi mọi group.
- [ ] P10.6. Preview từng phiên bản, đủ ảnh/thứ tự/đích/giờ; cảnh báo trùng giữa hai tài khoản.
- [ ] P10.7. Duyệt theo phiên bản, tạo job theo mã yêu cầu; ghi rõ mô phỏng/tự động/bán tự động/chưa hỗ trợ.
- [ ] P10.8. Kết quả từng đích, bắt đầu/tạm dừng/dừng và lý do chưa chạy; không thành công chung khi chỉ một đích thành công.
- [ ] P10.9. Máy đã bán/nguồn đổi phản ánh ở bài/lịch; mở được phiên bản cũ, không âm thầm sửa bài đã duyệt.

**Đầu ra:** ba trang đăng cùng bố cục và backend/worker.

**Đạt khi:** ba đầu vào tạo máy, dùng preset, preview và theo dõi job độc lập. Một nhóm yêu cầu giá chỉ chặn đích đó hoặc yêu cầu bổ sung, không chặn mọi bản nháp.

### P11 — Nhật ký, đối chiếu và phục hồi

**Mục tiêu:** biết việc gì đã xảy ra khi lỗi/restart, giữ dữ liệu sử dụng được.

- [ ] P11.1. Lọc lịch sử theo máy/tài khoản/đích/giờ/trạng thái, xem caption/ảnh phiên bản thực tế và lần thử.
- [ ] P11.2. Unknown có verify chỉ đọc hoặc xác nhận thủ công kèm nguồn; không có thử lại mù.
- [ ] P11.3. Group pending giữ đúng trạng thái; quan sát lại trong giới hạn hoặc xác nhận thủ công, không tự thành published sau khoảng chờ.
- [ ] P11.4. Crash: phân loại trước/sau gửi, xử lý khóa treo, không tạo worker thứ hai khi tiến trình cũ còn chạy.
- [ ] P11.5. Backup DB nhất quán cùng manifest và ảnh tham chiếu, kiểm tra hashes khi restore. Tham khảo [SQLite Online Backup](https://sqlite.org/backup.html), không copy tùy ý DB đang ghi.
- [ ] P11.6. Bản xuất thông thường loại cookie/profile/token/khóa. Restore sang máy mới báo cần đăng nhập/kết nối lại; không giả định bí mật bảo vệ theo Windows chuyển được giữa máy.
- [ ] P11.7. Restore vào vùng tạm, kiểm tra trước thay dữ liệu; không ghi đè bộ dữ liệu tốt bằng backup hỏng.
- [ ] P11.8. Chẩn đoán lọc secrets; screenshot/trace nhạy cảm chỉ thu khi bật rõ và có thời hạn lưu.
- [ ] P11.9. Nhập tay nguồn khách hỏi/đơn hàng; không bắt tự đọc tương tác TCN/group.

**Đầu ra:** lịch sử, đối chiếu unknown, phục hồi/backup, hướng dẫn chẩn đoán.

**Đạt khi:** restore vùng sạch đủ máy/ảnh/lịch sử; lịch không tự chạy khi thiếu điều kiện; log/bản xuất không có bí mật thô.

### P12 — Kiểm thử tổng thể và bàn giao Windows

**Mục tiêu:** người dùng mở/dùng/dừng/cập nhật mà không sửa mã.

- [ ] P12.1. Chạy ma trận mục 7: quy tắc offline, Facebook thật khi cần bằng đích đã chọn.
- [ ] P12.2. Đóng/mở UI/server/worker, chỉ một scheduler; tắt app ngừng nhận việc và báo job chưa rõ kết quả.
- [ ] P12.3. Launcher và hướng dẫn Windows; thử đường dẫn có dấu/khoảng trắng, thiếu runtime/browser, cổng bị chiếm; không đường dẫn cứng.
- [ ] P12.4. Build và phục vụ UI cục bộ; không phục vụ file nhạy cảm như static; không tự mở truy cập từ xa.
- [ ] P12.5. Backup trước cập nhật, migration/quay về dữ liệu đã kiểm tra; cập nhật không xóa session/media.
- [ ] P12.6. Hướng dẫn ba đầu vào, hai tài khoản/proxy, chọn nhóm/Page, preview/dừng/unknown/đánh dấu đã bán.
- [ ] P12.7. Nghiệm thu một chu trình với cấu hình thật, ghi phiên bản/khả năng đạt hoặc chưa đạt/tồn đọng.
- [ ] P12.8. Cập nhật README đúng hành vi thực tế, ghi máy phải hoạt động để chạy lịch cục bộ.

**Đầu ra:** bản cơ bản chạy Windows, hướng dẫn dùng/khôi phục, báo cáo nghiệm thu.

**Đạt khi:** người vận hành dùng trọn chu trình, từng kênh tuyên bố hỗ trợ có bằng chứng, không cần LLM. Một kênh chính chưa đạt thì chưa bàn giao đủ phạm vi.

### P13 — Nâng cấp LLM theo ngữ cảnh

**Mục tiêu:** bài phù hợp từng nhóm khách, giữ dữ kiện và không làm bản cơ bản phụ thuộc AI.

- [ ] P13.1. Endpoint/model/key được bảo vệ, test kết nối/timeout/giới hạn chi phí; tắt AI hoàn toàn được.
- [ ] P13.2. Payload tên/tình trạng, tùy chọn thực sự có, ngữ cảnh nhóm/lịch sử cần thiết. Mặc định không gửi ảnh cho vision, cookie/token/mật khẩu proxy.
- [ ] P13.3. Tách dữ kiện khỏi chỉ dẫn viết; nội dung nhóm/URL là dữ liệu tham khảo, không chỉ dẫn điều khiển app.
- [ ] P13.4. Caption theo đích, sửa tay, lưu model/prompt/phiên bản nguồn và usage; không log secrets.
- [ ] P13.5. Kiểm tra khẳng định giá/pin/bảo hành/nguyên zin/ưu đãi, cảnh báo hoặc loại đầu ra không có căn cứ; vẫn duyệt. Không coi bộ kiểm tra phát hiện được mọi sai sót model.
- [ ] P13.6. So trùng theo đích/lịch sử; đánh giá phù hợp, không chứng minh tránh spam bằng số biến thể.
- [ ] P13.7. AI lỗi giữ máy/ảnh, dùng mẫu hoặc sửa tay; không tự gửi bản thay thế chưa preview.
- [ ] P13.8. Thử dữ liệu thiếu giá/pin/bảo hành và tình trạng không đẹp; không đổi thành khẳng định tốt hơn dữ kiện.
- [ ] P13.9. Đánh giá thời gian chỉnh bài/chất lượng/khách hỏi/đơn nhập tay; không tự quy thay đổi doanh số cho AI.

**Đầu ra:** AI trong composer chung, có kiểm soát chi phí và quy trình duyệt/phiên bản.

**Đạt khi:** bật/tắt AI không phá bản cơ bản; không âm thầm thêm dữ kiện; người dùng xem bài từng đích trước lập lịch.

## 7. Ma trận kiểm tra xuyên suốt

Tự động hóa kiểm tra quy tắc/dữ liệu/lỗi mô phỏng. Chỉ thử Facebook thật khi cần xác nhận tích hợp, không lặp bài thử hàng loạt để tạo tải.

| Mã | Tình huống | Kết quả mong đợi | Bằng chứng |
| --- | --- | --- | --- |
| T01 | Chỉ ảnh/tên/tình trạng, thiếu tùy chọn | Tạo caption được, không giá 0/pin/bảo hành bịa thêm | Nghiệp vụ + UI |
| T02 | Ảnh hỏng/mất hoặc ảnh thứ hai upload lỗi | Không tự đăng thiếu ảnh/chỉ chữ, giữ dữ liệu để sửa | Media/publisher lỗi + kiểm chứng kênh |
| T03 | A đăng group X, B đăng TCN B, Page Y | Ba job, đúng danh tính và ảnh/thứ tự | Job + đối chiếu kênh |
| T04 | Bấm hai lần hoặc hai worker nhận một job | Một ý định đăng, request lặp xử lý nhất quán | Transaction/concurrency |
| T05 | Scan/publish/mở thủ công cùng profile | Chờ/nhường quyền rõ, không tranh phiên | Khóa + UI |
| T06 | Group chưa tham gia/chưa rõ quyền/yêu cầu giá | Không tự đăng, lý do và bổ sung/bỏ chọn rõ | Điều kiện đích |
| T07 | Group kiểm duyệt | pending_approval, không tự published | Nhóm thử thực tế |
| T08 | Timeout/crash sau gửi | unknown, không phát lại, có đối chiếu | Mô phỏng + phục hồi |
| T09 | Nguồn đổi sau duyệt hoặc máy đã bán | Chờ xem lại/dừng; giữ lịch sử cũ | Phiên bản/job |
| T10 | Proxy lỗi/đổi, phiên hết hạn, cảnh báo | Dừng đúng tài khoản, không tự đổi mạng/danh tính | Mô phỏng + kết nối đã chọn |
| T11 | Một đích thành công, đích khác lỗi | Độc lập, không bỏ quên đích lỗi hoặc đăng lại đích tốt | Nhiều đích |
| T12 | Slot lỗi xen kẽ thành công | Lưu slot thực tế, không theo đếm thành công | Scheduler |
| T13 | Restart với nhiều lịch quá hạn | Hiển thị để xử lý, không phát dồn | Recovery + Windows |
| T14 | Hủy khi đang gửi | Báo phần đã gửi, không giả thu hồi | Ranh giới gửi/hủy |
| T15 | Backup/restore vùng sạch | Đủ máy/ảnh/lịch sử, secrets không xuất thô; thiếu login thì không chạy | Backup + restore |
| T16 | Origin lạ/path ngoài kho/thiếu xác thực cần thiết | Không thực hiện lệnh hoặc truy cập file vượt phạm vi | API/file |
| T17 | AI lỗi hoặc thêm dữ kiện không có nguồn | Giữ gốc, cảnh báo/lỗi, không tự đăng bản mới | P13 |
| T18 | Quét được một phần nhóm/nội quy | Nguồn/giờ và cờ thiếu; nhóm vắng không tự coi đã rời | Scanner/dữ liệu |

## 8. Các mốc đánh giá

| Mốc | Sau phần | Điều phải chứng minh |
| --- | --- | --- |
| M0 — Quyết định khả thi | P01 | Bằng chứng riêng từng kênh/quét/proxy, biết phần chưa đạt |
| M1 — Tạo bài offline | P05 với P02 | Ba đầu vào tạo caption, ảnh độc lập file nguồn |
| M2 — Điều phối mô phỏng | P07 | Đúng job/đích/phiên bản, không nhận trùng/phát lại unknown |
| M3 — Ba trang đăng tích hợp | P10 | TCN/group/Page đạt riêng, UI phản ánh đúng hỗ trợ |
| M4 — Bản nội bộ | P12 | Chạy Windows, dữ liệu bền, dừng/phục hồi/backup và dùng thật |
| M5 — AI | P13 | Nội dung theo đích, giữ dữ kiện, chi phí và duyệt được kiểm soát |

Đánh giá bằng bằng chứng đạt yêu cầu, không bằng số trang UI hoặc checkbox.

## 9. Điều kiện bên ngoài và cách xử lý

| Điều kiện | Ảnh hưởng | Cách xử lý |
| --- | --- | --- |
| Chưa đăng nhập hai tài khoản | Chưa kiểm chứng đủ phạm vi | Làm nền/mô phỏng; giữ thử thật chưa hoàn thành |
| Thiếu TCN/group/Page phù hợp để thử | Chưa xác nhận gửi/kết quả | Chỉ chuẩn bị/dry-run, không tự chọn nơi công khai |
| Chờ quyền Meta/API | Page chưa xong | Làm phần độc lập, Page chưa sẵn sàng |
| Thiếu proxy hoặc tổ hợp chưa hỗ trợ | Chưa nghiệm thu kết nối đó | Trực tiếp nếu người dùng chọn, không giả kết quả test |
| UI đổi/phiên cần xác minh | Browser adapter dừng/không đáng tin | Dừng, ghi tình huống, người dùng xác minh; sửa/kiểm chứng lại |
| Kết quả gửi không rõ | Có thể trùng nếu thử lại | Đối chiếu bằng chứng/xác nhận thủ công trước lượt tiếp |
| Máy ngủ/tắt/mất mạng | Lịch cục bộ trễ | Hiển thị quá hạn lúc mở lại, không cam kết chạy khi tắt máy |

## 10. Cách làm việc từng lượt triển khai

1. Chọn phần Pxx hoặc nhóm việc cùng phụ thuộc; đọc yêu cầu README và tiến độ hiện tại.
2. Làm thay đổi đủ nhỏ để kiểm tra; giữ dữ liệu có sẵn, không tự mở rộng sang seeding/UID/nhiều tài khoản.
3. Chạy kiểm tra phù hợp: typecheck/build, nghiệp vụ, UI; thử tích hợp thật khi cần và có đích đã chọn.
4. Ghi cách kiểm tra/kết quả; nêu riêng chưa chạy, thiếu điều kiện ngoài và mới chỉ mô phỏng.
5. Đánh dấu việc đạt, cập nhật trạng thái phần/tồn đọng. Xong mã nhưng chưa nghiệm thu thì ghi chờ kiểm chứng.
6. Cập nhật README khi hành vi thực tế khác giả định; không mô tả tính năng chưa hoạt động là đã có.

### Nhật ký tiến độ

| Ngày | Phần | Thay đổi | Kiểm tra/kết quả | Việc tiếp |
| --- | --- | --- | --- | --- |
| 26/10/2026 | Tài liệu | Lập kế hoạch theo README | Rà soát phạm vi/phụ thuộc; chưa thử ứng dụng | Bắt đầu P00 |
| 26/10/2026 | P00.1–P00.3 | Git, cấu trúc thư mục, khung TS, ADR 0001, CLAUDE.md | typecheck, chạy server/worker, build web đạt | P00.4 SQLite |
| 26/10/2026 | P00.4 | `node:sqlite`, WAL, transaction, migration runner, `npm test`, ADR 0002 | 13/13 test ×3 lần, gồm 4 tiến trình nhận 2.000 job không trùng | P00.5 Fastify health + UI 4 mục |
| 26/10/2026 | P00.5 + hạ tầng | Fastify health, UI 4 mục; chuyển repo ra `D:/Project` vì OneDrive làm hỏng node_modules | 15/15 test; server thật + proxy trả health đúng, chỉ nghe loopback | P00.6 cấu hình dev/test + adapter giả |
| 26/10/2026 | P00.6 | Cấu hình env (`APM_INTEGRATIONS`), giao ước publisher phác thảo + adapter giả, banner mô phỏng | 27/27 test; worker/server thật chạy fake, `live` bị từ chối | P00.7 lint/build/log lọc bí mật |
| 26/10/2026 | P00.7 | Biome + lệnh check tổng; logger chung lọc bí mật, dev pretty; ADR 0003 | typecheck/lint/build đạt, 34/34 test; lint từ chối 4 cú pháp/import sai; smoke server/worker/migration thật trên dữ liệu tạm | P00.8 origin/CSRF và truy cập cục bộ |
| 27/10/2026 | P00.8 | Guard API cục bộ + client session trong bộ nhớ, ADR 0004 | 11 server tests + 7 client tests; real server/Vite proxy và raw Host trùng bị chặn | P01 tooling và kiểm chứng tích hợp |
| 27/10/2026 | P01.1 chuẩn bị offline | CLI chủ động fake-only và ma trận khả thi P01 | 5/5 harness tests; unknown chỉ submit1 lần, stop/block không submit; chưa driver/kiểm chứng thật | Chuẩn bị driver và đầu vào thử thật; tiếp tục module offline độc lập |
| 27/10/2026 | P05.4 chuẩn bị offline | Hàm domain sinh caption từ dữ kiện đã cung cấp, không LLM | 8/8 test T01/thiếu optional/validation/input bất biến | Nối media/schema và UI soạn/xem trước trước khi nghiệm thu P05 |
| 27/10/2026 | P02.1–P02.2 | Migration0002 nền nghiệp vụ26 bảng, snapshot/identity/order/history/fence, ADR0005 | 29/29 storage tests; v1→v2, backup/restore WAL thật, FK/REPLACE/DO NOTHING/UPSERT; reviewer độc lập đạt | P02.3 repository/transaction và các phần media/secrets |
| 27/10/2026 | P02.6 | Publisher/scanner contracts + fake có context/provenance/unknown/stop/partial, ADR0006 | 18/18 contracts, 27/27 ghép worker+harness; cổng tích hợp94/94 + typecheck/lint/build đạt | P02.3/P02.4/P02.5/P02.7/P02.8; P01 thật chưa đủ đầu vào |
| 27/10/2026 | P02.3 | Repository product/content/job, transaction version/idempotency/claim/state/result/recovery, ADR0007 | 113/113 test + typecheck/lint/build đạt;3 tiến trình nhận60job không trùng, DB restart còn lịch sử | P02.4 MediaStore; P02.5 secrets/P02.7 validation/P02.8 fixtures |
| 27/10/2026 | P02.4 | MediaStore UUID/staging/decode/hash/verify, sharp0.35.5, ADR0008 | 4/4 test MediaStore sau sửa2mã lỗi;113 test cũ đạt ở lượt tổng; typecheck/lint/build đạt, không lặp full suite | P02.5 secrets Windows; P02.7 API/validation và P02.8 fixtures |

Nhật ký chi tiết từng lượt (có giờ, lệnh kiểm tra, tồn đọng) ghi trong [report_daily.md](report_daily.md).

## 11. Việc làm ở lượt triển khai đầu tiên

- [x] Kiểm tra môi trường/đường dẫn tại `D:/Project/Auto_Post_MKT` (hai máy đồng bộ qua git; đã bỏ OneDrive — ADR 0001).
- [x] P00: khung bốn mục, API health, SQLite tối thiểu, adapter giả.
- [x] Chuẩn bị P01 và liệt kê đầu vào người dùng cần cung cấp: đăng nhập hai tài khoản, đích thử, proxy nếu dùng. *(docs/feasibility.md; đây là chuẩn bị, chưa nghiệm thu P01.)*
- [ ] Chưa bật lịch đăng thật trước khi adapter và dừng/đối chiếu đạt yêu cầu.

Hiện tại chỉ lập kế hoạch; các thư mục, công cụ và chức năng trên sẽ được tạo khi bắt đầu triển khai.
