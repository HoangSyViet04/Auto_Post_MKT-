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

Đã tạo ở P00.3. Bản làm việc đặt tại `D:/Project/Auto_Post_MKT` (ngoài OneDrive), hai máy đồng bộ qua git/GitHub. Dùng **một `package.json` npm, không workspaces/pnpm**. Các module tham chiếu nhau qua `#domain`, `#config`, `#storage`, ... (xem [ADR 0001](docs/adr/0001-onedrive-single-package.md)). Theo yêu cầu người dùng 28/10/2026, code và dữ liệu cùng một folder: dữ liệu vận hành mặc định `<project>/data/` (DB, media, log, browser profiles, cache), Git bỏ qua; bản dự phòng chuyển vị trí ở `local-backups/`. Ghi đè bằng `APM_DATA_DIR`, đường dẫn tương đối theo project root; xem ADR 0012.

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
| P01 | Bằng chứng khả thi các tích hợp | P00 | Đang làm (nick phụ `phu1`, 1 nhóm quản trị): P01.2 đăng nhập/danh tính đạt một profile; P01.5 đăng chữ + 2 ảnh đạt với quản trị (chưa thử chờ duyệt/từ chối); P01.6 đọc 130 nhóm đã tham gia (một phần). Chưa làm: P01.3 proxy (hoãn), P01.4 TCN, P01.7 Page API, nửa sau P01.6 (từ khóa), P01.8 |
| P02 | DB, media, bí mật, giao ước | P00, kết luận P01 | Offline xong (P02.1–P02.8); tích hợp thật chờ P01 |
| P03 | Quản lý tài khoản | P01, P02 | P03.3 xong (đăng nhập tay + kiểm tra phiên qua worker, đã chạy thật); P03.1/P03.2/P03.4/P03.5/P03.6/P03.7 làm một phần; cũ: Offline: P03.1/P03.2/P03.6 (bảng, thêm/đổi nhãn/tạm dừng/gỡ); từng cần trình duyệt/P01 |
| P04 | Quản lý proxy | P02, P03 | **Hoãn có chủ đích (27/10/2026)** — chưa cần với 1–2 nick dùng mạng nhà; làm khi mở rộng quy mô. Không xóa. |
| P05 | Ba đầu vào, mẫu bài, phiên bản | P02 | Offline xong phần làm được: P05.1–P05.4, P05.8; P05.5/P05.6/P05.7 làm một phần (chờ tài khoản/đích/lịch từ P03/P06/P07) |
| P06 | Quét nhóm và danh sách đích | P01–P03 (P04 hoãn: kết nối trực tiếp) | Có quét joined trong app, tiến độ/hủy/khóa profile, đạt offline + UI (40 nhóm → chọn 30 → xếp 30 job); chờ nghiệm thu Facebook thật. Keyword chưa hỗ trợ; P06.5 một phần |
| P07 | Hàng chờ/lịch với mô phỏng | P02–P06 | Xong phần mô phỏng (P07.1, P07.3–P07.9); P07.2 còn ô nhập lịch (P10) và giới hạn/ngày |
| P08 | Adapter TCN/group hoàn chỉnh | P01, P03–P07 | Đạt offline (Facebook giả) và **đạt thật một lần mỗi kênh** (nhóm, TCN) qua trang giao diện, 28/10/2026; người dùng đã đối chiếu bằng mắt (P08.8 đạt); còn chờ duyệt/từ chối (P08.5), nick không phải quản trị, lặp lại sau restart |
| P09 | Kết nối và đăng fanpage | P01, P02, P05, P07 | **Xong (P09.1–P09.8)**: đã đăng thật một bài 2 ảnh lên Page thử và người dùng xác nhận bằng mắt (28/10/2026). Chưa thử lỗi thật từ Meta (token hết hạn, bị từ chối), `unknown` thật, 1 ảnh/nhiều ảnh hơn, giới hạn số ảnh |
| P10 | Ba trang đăng tích hợp | P05–P09 | Trang đăng nhóm và trang cá nhân xong (P10.2/3/5/6/7/8/9), đạt mô phỏng và đã đăng thử thật; còn fanpage (P10.4) và composer chung (P10.1) |
| P11 | Nhật ký, đối chiếu, phục hồi | P07–P10 | **Xong (P11.1–P11.9)**, đạt mô phỏng; đã thử trên trình duyệt và script thật trên dữ liệu tạm. Chưa thử mất điện/kill giữa lúc đăng thật, chưa thử backup/restore trên dữ liệu thật của người dùng |
| P12 | Kiểm thử tổng thể, chạy Windows, bàn giao | P00–P11 | **Xong P12.1–P12.8**: đạt trên mô phỏng/dữ liệu tạm và một chu trình THẬT qua launcher (28/10/2026). Chưa bàn giao đủ phạm vi vì fanpage chưa làm |
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
- [ ] P01.2. Tạo hai profile riêng, người dùng đăng nhập thủ công; mở lại và xác nhận danh tính. Không mở cùng thư mục profile bằng hai tiến trình. *(Đang làm: có `npm run spike:fb -- login|verify`, khóa profile, bằng chứng chỉ lưu băm danh tính; Edge mở được trang đăng nhập Facebook. Kết quả 27/10/2026: một profile (`phu1`, nick phụ) đăng nhập tay được (có qua bước xác minh của Facebook), mở lại bằng tiến trình mới → danh tính khớp. Chưa làm: profile thứ hai, mở lại sau khi khởi động lại máy, lặp lại nhiều lần — nên chưa đóng mục.)*
- [ ] P01.3. Thử trực tiếp/proxy do người dùng cung cấp; ghi giao thức/xác thực hỗ trợ, lỗi mạng và cách đổi cấu hình.
- [ ] P01.4. *(Đã đăng thử 1 bài chữ công khai lên TCN `phu1` bằng `spikes/fb-profile-post.ts`: có chốt đối tượng, hai bước Tiếp/Đăng, `find` thấy bài. Chưa thử nhiều ảnh, ID/link bài, lặp lại sau restart — nên chưa tick.)* Thử TCN: caption, nhiều ảnh, đúng danh tính, đúng đích được chọn; lấy kết quả/link khi đủ căn cứ.
- [ ] P01.5. Thử group: quyền tham gia/đăng, caption/ảnh, phân biệt đã gửi, chờ duyệt, từ chối và unknown. *(Đang làm: trên group người dùng chỉ định — đúng nick, tìm thấy 1 ô soạn bài, soạn chữ/2 ảnh bằng dry-run đạt, đã đăng thử 1 bài chữ. Đã đăng thử 2 bài (chữ; chữ + 2 ảnh) bằng quản trị nick phụ: bài chữ người dùng xác nhận đã hiện. Nhận diện `published`, `postId` và số ảnh đã khớp đáp án thật cho nick quản trị. Còn thiếu: chờ duyệt/từ chối (cần nick không phải quản trị hoặc nhóm bật duyệt), ID bài của nick thường, lặp lại sau restart — nên chưa tick.)*
- [ ] P01.6. Thử đọc nhóm đã tham gia theo tài khoản và tìm theo từ khóa; ghi trường đọc được, kết quả một phần và điều kiện dừng. *(Đã thử đọc nhóm đã tham gia của nick `phu1`: 130 nhóm, 81 có ID số, 49 chỉ có tên rút gọn, dừng khi không còn nhóm mới; chưa đối chiếu tổng số thật. Chưa thử tìm theo từ khóa.)*
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
- [x] P02.5. Chọn cách bảo vệ secrets trên Windows/quyền thư mục; khóa không nằm cạnh ciphertext trong mã nguồn. Mất khóa thì báo cần kết nối lại. *(DPAPI CurrentUser qua PowerShell stdin, ciphertext UUID ngoài repo, ACL secrets chỉ user/SYSTEM, lost/revoke;2test Windows thật đạt ngoài sandbox, ADR0009. Chưa UI kết nối/profile ACL.)*
- [x] P02.6. Giao ước publisher/scanner, trạng thái, adapter giả; phân biệt published/pending/unknown. *(Approved context + runtime validation, fake snapshot/evidence/verify/stop; scanner joined/keyword nguồn/thời điểm/account/unknown/partial/limit; ADR0006. 18/18 contract tests đạt. DB wiring/scheduler/P06 và adapter thật chưa triển khai.)*
- [x] P02.7. Validation, phân trang, giới hạn upload, bảo vệ đường dẫn; metadata client không được dẫn tới đọc/xóa file ngoài kho. *(Strict Fastify schemas, ảnh raw20MiB + UUID read/verify, product create/list phân trang1..100; không client filepath, không delete API;3test API chính đạt, ADR0010. Chưa UI/thumbnail.)*
- [x] P02.8. Dữ liệu fixture giả và DB test tách khỏi dữ liệu vận hành. *(Runner `scripts/test.ts` ép test/fake + dataDir tạm; `#test-support` workspace/fixture dùng lại; 125/125 test theo người dùng. build:web vướng quyền `dist` do sandbox Codex, build ra thư mục tạm đạt.)*

**Đầu ra:** schema, migration, storage, API nền và adapter giả.

**Đạt khi:** dữ liệu tồn tại sau restart; migration không mất dữ liệu; lỗi file nhất quán; API/log không lộ secrets; kiểm tra được nhận job có điều kiện.

### P03 — Tab Quản lý tài khoản

**Mục tiêu:** quản lý hai phiên Facebook đúng danh tính.

- [ ] P03.1. Bảng nhãn, UID/link khi quan sát được, tên/avatar, trạng thái, proxy, lần kiểm tra, tác vụ hiện tại; thống kê có căn cứ. *(Đã có bảng: nhãn/chỗ, danh tính (hiện "Chưa xác nhận" tới khi có P03.3–P03.4), trạng thái phiên, proxy, số tác vụ đang chạy/chờ đếm từ DB, tạm dừng. Đã có thêm "kiểm tra lúc …" từ lệnh trình duyệt gần nhất. Chưa có avatar.)*
- [ ] P03.2. Thêm/sửa nhãn/mở/đóng phiên/gỡ; ngăn vượt phạm vi hai tài khoản. *(Đã có: thêm, đổi nhãn (không trùng, không phân biệt hoa/thường), gỡ có xác nhận, tối đa hai tài khoản kèm hồ sơ trình duyệt riêng. Đã có "Đăng nhập" và "Kiểm tra phiên" (P03.3); chưa có "đóng phiên" riêng.)*
- [x] P03.3. Tích hợp đăng nhập thủ công và mở lại profile P01; không lưu mật khẩu/2FA vào bảng. *(Nút "Đăng nhập"/"Kiểm tra phiên" ở trang tài khoản → server ghi lệnh vào `browser_commands` → worker (`APM_BROWSER=real`) mở Edge với hồ sơ riêng `<dataDir>/profiles/<khóa ngẫu nhiên>`; người dùng tự đăng nhập; chỉ lưu tham chiếu danh tính (không lưu mật khẩu/cookie). Đã chạy thật trên nick phụ `phu1`: đăng nhập → `identity_saved`, kiểm tra phiên → `match`. Mới 1 tài khoản, 1 lần; hồ sơ app tách biệt với hồ sơ thử P01.)*
- [ ] P03.4. Kiểm tra danh tính trước tác vụ; không xác nhận được hoặc khác mong đợi thì dừng. *(Đã có: lệnh "Kiểm tra phiên" đối chiếu danh tính đã lưu; khác nick → `identity_mismatch`, đặt phiên `unknown`, không đổi danh tính; đăng nhập nhầm nick bị từ chối. Test bằng driver giả; chạy thật chỉ mới trường hợp khớp. Chưa gắn vào bước trước mỗi job — P07/P08.)*
- [ ] P03.5. Khóa profile đang dùng; mở thủ công phải tạm dừng/nhường quyền, không tranh điều khiển worker. *(Đã có: khóa trình duyệt theo tài khoản trong `resource_leases` (fence chỉ tăng, gia hạn theo nhịp, hết hạn thì nhường) + khóa tệp từng hồ sơ; lệnh gặp hồ sơ đang bận → `profile_in_use`; một tài khoản chỉ một lệnh đang hoạt động. Chưa xử lý trường hợp người dùng tự mở thư mục hồ sơ bằng Edge ngoài app.)*
- [ ] P03.6. Tạm dừng từng tài khoản/toàn bộ; gỡ tài khoản thì dừng lịch phụ thuộc, không chuyển sang tài khoản còn lại. *(Đã có ở tầng dữ liệu + UI và đã test với tác vụ giả: tạm dừng chặn nhận/gửi (readiness) và yêu cầu dừng tác vụ đang chạy; gỡ thu hồi bản duyệt, hủy tác vụ chưa gửi. Chưa thử với worker/scheduler thật — P07.)*
- [ ] P03.7. Phân biệt mất mạng, cần đăng nhập, cần xác minh, chưa rõ; không suy bị khóa từ một lần lỗi trang. *(Đã có phân loại `login_required`/`verification_required`/`network_error`/`timeout`/`window_closed`; hết giờ hoặc đóng cửa sổ không đổi trạng thái phiên. Gặp thật: `verification_required` lúc đăng nhập. `network_error` mới được test bằng chuỗi lỗi, chưa thử ngắt mạng thật.)*

**Đầu ra:** trang tài khoản và BrowserProfileManager.

**Đạt khi:** hai tài khoản mở lại đúng profile, không lẫn phiên; dừng/gỡ xử lý đúng job; UI không lộ mật khẩu/cookie/2FA.

### P04 — Tab Quản lý proxy

> **Trạng thái: HOÃN, làm sau (quyết định người dùng 27/10/2026).** Với một đến hai nick đăng bằng mạng nhà thì chưa cần proxy; proxy lạ còn có thể gây checkpoint và không bảo đảm tránh khóa. Toàn bộ mục P04.1–P04.7 giữ nguyên bên dưới để triển khai khi cần (ví dụ tăng số nick, cần tách IP, hoặc mỗi nick một proxy cố định).
> Trong lúc hoãn: mọi tài khoản dùng **kết nối trực tiếp**, cột Proxy hiển thị "Không dùng" (đã đúng ở trang tài khoản), các phần khác (P06, P07, P08) coi là không có proxy. Schema đã có sẵn bảng `proxies` và `browser_profiles.proxy_id` nên khi làm P04 không cần đổi cấu trúc nền. Lưu ý khi làm: Chromium không hỗ trợ SOCKS5 có user/password (xem báo cáo ngày 22:40); mật khẩu proxy phải qua kho secrets DPAPI (P02.5).

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

- [x] P05.1. Form chỉ bắt buộc ít nhất một ảnh, tên, tình trạng; giữ nội dung đang nhập khi validation lỗi. *(Trang "Quản lý máy" trong mục Chức năng đăng bài; đã chạy thật trên Edge headless: lỗi hiện đủ, file không phải ảnh bị từ chối, nội dung giữ khi giá sai.)*
- [x] P05.2. Lưu bản sao ảnh, thumbnail và thứ tự; xóa/di chuyển file nguồn không làm hỏng bản đã lưu. *(MediaStore P02.4 + thumbnail `GET /api/media/:id?size=thumb` (320px, tạo theo yêu cầu, không lưu thêm); đổi thứ tự ↑/↓, thứ tự lưu theo phiên bản máy.)*
- [x] P05.3. Tự sinh mã, sửa máy, đánh dấu đã bán/ngừng bán; giá/thông số thiếu là null, không thành 0 hoặc khẳng định tốt. *(`GET/PUT /api/products/:id` (sửa = revision mới, kiểm tra phiên bản cũ → 409), `POST /api/products/:id/status`; chưa có phân trang tìm kiếm/lọc theo trạng thái.)*
- [x] P05.4. Caption mẫu từ tên/tình trạng, bỏ dòng tùy chọn thiếu, xem trước/chỉnh tay. *(Hàm domain `generateProductCaption` nhận thêm dung lượng/pin/khu vực dạng chữ; UI xem trước và chỉnh tay đã có nhưng phần chỉnh tay **chưa được lưu** — lưu phiên bản ở P05.5.)*
- [ ] P05.5. Lưu phiên bản máy, caption, ảnh có thứ tự; duyệt gắn đúng phiên bản. *(Đã có: phiên bản máy, lưu/liệt kê bản caption kèm ảnh theo thứ tự, từ chối phiên bản cũ/máy đã bán. Chưa có: duyệt — cần tài khoản và đích từ P03/P06; repository `approve` đã có nhưng chưa có API/UI.)*
- [ ] P05.6. Phiên bản theo đích và cảnh báo giống nội dung; chưa cần semantic phức tạp hoặc AI. *(Đã có: cảnh báo giống nội dung (so khớp từ, ngưỡng 80%) giữa các bản của một máy. Chưa có: phiên bản theo đích — chờ đích từ P06.)*
- [ ] P05.7. Máy sửa sau duyệt thì bài/lịch cần kiểm tra; máy đã bán/ngừng bán ngăn lịch mới và dừng lịch chờ. *(Quy tắc dữ liệu đã có và đã test từ P02.3 — sửa máy thu hồi duyệt/chuyển job cần xem lại, bán/ngừng bán chặn bản mới và dừng job; UI máy đã báo "không thể tạo bài/lịch mới". Chưa có UI bài/lịch để hiển thị "cần kiểm tra" — P07/P10.)*
- [x] P05.8. Chỉ xóa ảnh khi không còn tham chiếu cần giữ; ưu tiên ẩn/lưu trữ thay vì mất bằng chứng bài cũ. *(UI không có thao tác xóa ảnh: "Bỏ" chỉ gỡ khỏi phiên bản mới, bản cũ giữ ảnh. `purgeUnreferenced` chỉ giải phóng file ảnh chưa gắn máy/bản caption nào và đã tải lên >24 giờ; dòng media giữ lại, chuyển `missing`. Nút "Dọn ảnh chưa dùng".)*

**Đầu ra:** trang phụ quản lý máy, thư viện ảnh, soạn bài và phiên bản trong khu vực đăng.

**Đạt khi:** ba đầu vào tạo được caption có ảnh, không bịa giá/pin/bảo hành; giữ thứ tự ảnh và nội dung duyệt; không cần LLM.

### P06 — Tab Quét nhóm và danh sách đích

**Mục tiêu:** tìm/lưu/chọn nhóm theo tài khoản và chuyển sang đăng.

- [x] P06.1. Nhập link/ID thủ công, chuẩn hóa đích, quan hệ tài khoản–nhóm, nội quy do người dùng ghi nhận. *(Trang "Nhóm đã tham gia": nhập link/ID, một nhóm một bản ghi dù nhiều tài khoản, quan hệ tham gia/quyền đăng riêng từng tài khoản (nguồn `manual`, ghi rõ chưa kiểm chứng). Link chỉ có tên rút gọn lưu được nhưng chưa đăng được — ADR 0011.)*
- [ ] P06.2. Nhóm đã tham gia: chọn tài khoản, đọc theo P01; nhóm vắng trong lượt dở không bị coi đã rời. *(28/10: đã có nút quét trong ứng dụng, API và worker đọc trang nhóm đã tham gia, kiểm tra danh tính, lưu từng vòng và loại trùng ID số; bỏ qua/đếm nhóm chỉ có tên rút gọn; không cấp quyền đăng, không xóa nhóm vắng. Chỉ hoạt động live + browser real, do người dùng bấm. Đạt kiểm thử offline + Facebook giả + giao diện; chưa nghiệm thu quét thật trên tài khoản đã chọn nên chưa tick. Xem docs/joined-groups.md.)*
- [ ] P06.3. *(Chưa hỗ trợ — cần P01.)* Từ khóa: nhập từ khóa/phạm vi, ghi nguồn/thời điểm; tìm thấy không đồng nghĩa đã tham gia/có quyền.
- [ ] P06.4. ScanRun có tiến độ, điều kiện dừng, kết quả một phần, hủy; tiếp tục nếu hỗ trợ, nếu không chạy lại có loại trùng. *(Đã có cho joined: migration 0006 thêm chủ xử lý/heartbeat/yêu cầu hủy, một lượt active mỗi tài khoản, dừng giữ kết quả, worker mất → partial/worker_lost; quét lại có loại trùng, không resume tự động. Giao diện hiện tiến độ + lý do dừng; luôn ghi một phần. Đạt offline; còn nghiệm thu joined thật và keyword chưa hỗ trợ.)*
- [ ] P06.5. Lưu tên/link/ID, mô tả, loại nhóm/số thành viên khi quan sát được; thiếu là chưa rõ; không quét thành viên. *(Đã lưu tên, link, ID, khu vực, chủ đề, nội quy, duyệt bài; thiếu hiển thị "chưa rõ". Chưa có mô tả/công khai-riêng tư/số thành viên — chỉ có khi đọc tự động.)*
- [x] P06.6. Lọc tên/tài khoản/khu vực có dữ liệu/trạng thái; ghi chú/ưu tiên/không phù hợp; loại trùng nhóm nhưng giữ quan hệ tài khoản. *(Tìm không dấu/không phân biệt hoa thường, lọc theo tài khoản không lẫn nhóm của tài khoản kia, ưu tiên/không phù hợp/ngừng dùng, ghi chú. Hạn chế: cùng một nhóm nhập một lần bằng tên rút gọn và một lần bằng ID số vẫn là hai bản ghi.)*
- [x] P06.7. Chuyển nhóm chọn sang Đăng nhóm, giữ đúng tài khoản; đích thiếu điều kiện không tự vào hàng chờ. *(Chỉ chọn được nhóm đủ điều kiện của tài khoản đang chọn: có ID số, đã tham gia, được đăng, chưa đánh dấu không phù hợp/ngừng dùng, tài khoản không tạm dừng. Trang Đăng nhóm hiện chỉ nhận và hiển thị lựa chọn; hàng chờ thuộc P10.)*
- [ ] P06.8. Dùng chung khóa phiên; cảnh báo/mất phiên dừng thu thập liên quan. *(Đã nối joined scanner với resource lease + khóa tệp profile; chủ lease riêng cho scan, chờ hồ sơ bận; dừng khi mất lease/hủy/tài khoản tạm dừng/gỡ/đổi danh tính; phiên hết hạn/checkpoint/sai danh tính cập nhật trạng thái tài khoản. Có test offline; chưa thử xung đột/cảnh báo trên Facebook thật.)*

**Đầu ra:** hai chế độ quét và dữ liệu đích có nguồn gốc.

**Đạt khi:** ghi đúng độ đầy đủ, không lẫn nhóm hai tài khoản, dừng không mất kết quả; chuyển đúng cặp tài khoản–đích. Chế độ chưa đọc tự động được ghi chưa hỗ trợ, không coi nhập tay là hoàn thành quét tự động.

### P07 — Hàng chờ, lịch và dừng bằng mô phỏng

**Mục tiêu:** kiểm chứng điều phối trước khi nối gửi thật.

- [x] P07.1. Job từ cặp tài khoản–đích được chọn, một đích một kết quả; mã yêu cầu chống bấm gửi hai lần. *(API `POST /api/approvals` (gắn danh tính đã xác nhận) và `POST /api/jobs` (một mục = một đích; `requestKey` cùng nội dung → trả lại kết quả cũ, khác nội dung → 409). Giao diện tạo job thuộc P10.)*
- [ ] P07.2. Lưu UTC, hiển thị/lập lịch `Asia/Ho_Chi_Minh`; khoảng cách/giới hạn là chính sách vận hành, không phải ngưỡng chống ban. *(Đã có: lưu epoch UTC, hiển thị giờ Việt Nam, `parseVnLocal` cho ô nhập lịch, giãn cách là chính sách cấu hình. Chưa có ô nhập lịch trên giao diện — P10; chưa có giới hạn số bài mỗi ngày.)*
- [x] P07.3. Worker nhận job bằng transaction, khóa tài khoản/Page, heartbeat, kiểm tra worker cũ; tuần tự trong từng tài khoản. *(worker nhận job có điều kiện, giữ khóa trình duyệt theo tài khoản, gia hạn quyền nhận theo nhịp, khôi phục job của worker chết; tuần tự trong từng tài khoản.)*
- [x] P07.4. Trước gửi kiểm tra phiên bản duyệt, máy được đăng, đủ ảnh, tài khoản/đích/quyền và mạng. *(trước gửi kiểm tra bản duyệt còn hiệu lực, máy còn bán, ảnh còn trong kho (ảnh mất → failed, không đăng chỉ chữ), tài khoản/đích/quyền, `prepare` của adapter; có móc `preflight` cho danh tính/phiên/mạng khi dùng adapter thật (P08).)*
- [x] P07.5. Chạy ngay/hẹn giờ/tạm dừng/tiếp tục/hủy phần chưa gửi; UI đọc trạng thái lưu bền, không chỉ bộ nhớ. *(chạy ngay (đổi giờ hẹn), tạm dừng, tiếp tục, hủy phần chưa gửi, yêu cầu dừng job đang chạy; trang "Hàng chờ đăng" đọc từ dữ liệu bền, tự cập nhật.)*
- [x] P07.6. Mốc chuẩn bị/gửi/kết quả; crash trước gửi khác sau gửi, không tự nhận lại job có thể đã gửi. *(mốc gửi ghi TRƯỚC khi gửi; chết trước mốc → paused, sau mốc → unknown; không tự nhận lại job có thể đã gửi.)*
- [x] P07.7. Sau restart liệt kê lịch quá hạn để tiếp tục/bỏ; không phát dồn bài cũ. *(job hẹn trễ hơn `APM_OVERDUE_MINUTES` (mặc định 15) không tự chạy, giao diện cảnh báo và cho "Chạy ngay"/"Bỏ" từng job; không phát dồn bài cũ.)*
- [x] P07.8. Kiểm tra nhiều đích lỗi xen kẽ: A thành công không ngăn B; mốc lịch theo slot thực tế, không theo số lượt thành công. *(đích lỗi không chặn đích khác; giãn cách `APM_MIN_GAP_SECONDS` (mặc định 60) tính từ mốc gửi thực tế của cùng tài khoản.)*
- [x] P07.9. Cảnh báo ngăn job tiếp theo; phân biệt dừng một tài khoản và toàn bộ. *(phiên hết hạn/checkpoint/sai danh tính khi gửi chỉ chặn đúng tài khoản đó (job đã xếp sau bị `blocked`, job mới bị từ chối); tạm dừng từng tài khoản hoặc tất cả có từ P03.6.)*

**Đầu ra:** scheduler và state machine chạy trọn với adapter giả.

**Đạt khi:** không nhận trùng job, scan/publish chung khóa; crash/quá hạn/ảnh mất/đổi nguồn không gây phát lại hoặc sai nội dung. Mô phỏng tốt chưa đồng nghĩa được bật scheduler thật.

### P08 — Adapter đăng TCN và group

**Mục tiêu:** chuyển P01 thành bộ đăng có kiểm tra và trạng thái đầy đủ.

- [x] P08.1. Chia browser session/danh tính/composer dùng chung, đặc thù TCN/group riêng. *(Phần dùng chung trong `#browser` (`launchProfile`, `facebook-ui`, `createBrowserPublisher`); phần riêng trong `#fb-group` và `#fb-profile` (URL đích, xác nhận đích, hai bước Tiếp/Đăng của trang cá nhân, đối tượng bài).)*
- [x] P08.2. Trước gửi xác nhận đúng người đăng và link/ID đích; kiểm tra điều kiện nhóm qua dữ liệu hiện có và UI. *(Đã có và đạt trên trang Facebook giả: kiểm tra phiên, checkpoint, so danh tính người đăng, xác nhận đúng nhóm/đúng trang cá nhân; sai thì dừng trước khi gửi. Chưa chạy thật qua ứng dụng.)* *(đạt thật 28/10/2026: nhóm `1357510931662685` và trang cá nhân `phu1` — đúng người đăng (so băm danh tính) và đúng đích trước khi đăng)*
- [x] P08.3. Điền caption, đủ ảnh đúng thứ tự, chờ upload có căn cứ; lỗi ảnh/selector thì dừng trước gửi. *(Đã có và đạt trên trang giả: điền caption, đính đúng số ảnh theo thứ tự đã duyệt và chờ xem trước, lỗi ảnh/ô soạn bài → dừng trước gửi. Chưa chạy thật qua ứng dụng.)* *(đạt thật: nhóm và TCN đính đủ 2 ảnh. Phát hiện ảnh trong kho tên `.blob` làm lần chạy đầu dừng `media_invalid`; đã sửa bằng cách gửi ảnh kèm tên/loại đúng, có test hồi quy)*
- [x] P08.4. Ghi mốc gửi, chỉ gửi một lần theo lượt; xác nhận bằng bằng chứng quan sát được. *(Đã có và đạt trên trang giả: mốc gửi do bộ chạy job ghi trước khi `submit`, bấm Đăng đúng một lần, xác nhận bằng bài mới trong feed (số lần đoạn chữ xuất hiện tăng). Chưa chạy thật qua ứng dụng.)* *(đạt thật: mốc gửi trước, đúng một lần, xác nhận bằng bài mới trong feed (số lần đoạn chữ xuất hiện tăng), ID bài đọc được)*
- [ ] P08.5. Group phân biệt pending/published; thiếu căn cứ thì trả unknown/trạng thái thích hợp, không giả thành công. *(Group: chỉ `published` khi thấy bài mới, ngược lại `unknown`; chưa nhận diện chờ duyệt/từ chối (không đoán).)* *(mới thấy `published` (người dùng là quản trị); chờ duyệt/từ chối chưa được nhận diện thật)*
- [x] P08.6. Nhận diện lỗi phiên/cảnh báo/UI thay đổi theo phạm vi P01; không tự giải CAPTCHA/checkpoint. *(Đã có theo phạm vi P01: phiên hết hạn/checkpoint/sai danh tính/mạng/giao diện đổi (`ui_changed`) → mã lý do riêng và dừng trước gửi; không giải CAPTCHA.)* *(dừng trước gửi đúng mã lý do đã thấy thật (`media_invalid`); phiên/checkpoint/giao diện đổi đã đạt trên Facebook giả và ở P01; không giải CAPTCHA)*
- [ ] P08.7. Dừng/hủy kiểm tra trước gửi; phần đã phát đi được ghi trung thực khi không hủy trước gửi được. *(stop() đóng phiên chưa bấm Đăng và chặn việc sau; yêu cầu dừng trước mốc gửi do bộ chạy job xử lý; phần đã bấm Đăng được ghi trung thực (không giả đã hủy).)*
- [x] P08.8. Kiểm tra offline bằng fixture UI/lỗi mô phỏng; thử thật theo đích được chọn và đối chiếu người đăng/nội dung/ảnh. *(Offline: 9 test với Facebook giả chạy trên Edge ngầm, chặn mọi yêu cầu ra ngoài. Thử thật qua ứng dụng: **chưa chạy** — bị chặn quyền ở phiên này; có sẵn `scripts/live-test-post.ts` (cần `--confirm-post`, server/worker ở chế độ live).)* *(Thử thật qua ứng dụng 28/10/2026: nhóm (published, ID 2307259096687859) và TCN công khai (published, ID 1549103153905018), qua trang Đăng nhóm/Đăng cá nhân. **Người dùng xác nhận 28/10/2026: vào nick phụ thấy bài đã đăng.** Thứ tự ảnh và từng dòng nội dung chưa được người dùng xác nhận riêng, nên chưa tick)* *(Người dùng xác nhận tiếp 28/10/2026: đã thấy bài đã đăng ở CẢ nhóm `1357510931662685` và trang cá nhân. Còn thiếu xác nhận riêng về thứ tự ảnh (xanh rồi đỏ), đủ 2 dòng nội dung, và đúng người đăng; có đủ mới tick)* *(Người dùng xác nhận đạt 28/10/2026: bài thử ở cả nhóm và trang cá nhân đúng như mong đợi.)*

**Đầu ra:** hai adapter cùng hàng chờ P07, báo cáo khả năng/giới hạn.

**Đạt khi:** từng kênh có bằng chứng gửi/xác nhận đúng và dừng đúng; kênh chưa đạt tắt rõ. Chỉ một kênh hoạt động chưa đủ đánh dấu P08 hoàn thành.

### P09 — Kết nối và đăng fanpage

**Mục tiêu:** đăng Page qua API, độc lập browser.

- [x] P09.1. Chọn kết nối theo quyền ứng dụng thực tế; kiểm tra Page/quyền/token. Không mô tả token là không bao giờ bị thu hồi. *(Đã làm phần mã: client Graph `packages/integrations/facebook-page/src/graph-client.ts` (đổi token dài hạn, liệt kê Page kèm `tasks`, kiểm tra token chỉ-đọc; phiên bản `APM_GRAPH_VERSION`, mặc định v23.0 CHƯA đối chiếu với Meta) và luồng `npm run page:connect`. Người dùng đã tạo ứng dụng Meta (loại Kinh doanh, chế độ Phát triển) và `me/accounts` trả Page "Góc Nghiện Đồ Hay" (ID 107892312229541) với đủ `tasks` gồm CREATE_CONTENT trong Graph API Explorer. CHƯA tick: chưa chạy `page:connect` thật, chưa thử đăng, chưa biết chế độ Development có đăng được không cần App Review)* *(Đạt 28/10/2026: kết nối Page thật thành công và bài thử thật được Meta nhận ở chế độ Phát triển với người dùng là quản trị; không cần App Review cho trường hợp này)*
- [x] P09.2. Bảo vệ token, API danh sách Page chỉ trả metadata/trạng thái/khả năng, không token thô. *(Đã làm: `page-repository.ts` lưu Page token trong SecretStore (DPAPI), DB chỉ giữ tham chiếu, `list()` chỉ metadata, test chứng minh token không nằm dạng rõ ở file nào; token chỉ đi qua header/thân POST, lỗi không chứa nguyên văn thông báo của Meta. CHƯA tick: chưa có API HTTP và giao diện liệt kê Page)* *(Hoàn tất 28/10/2026: ngoài kho token DPAPI đã ghi ở trên, thêm `GET /api/pages` chỉ trả metadata/trạng thái/`canPost`, không route nào nhận hoặc trả token (`pages-api.test.ts` khẳng định không có khóa token/secret trong JSON))*
- [x] P09.3. Upload ảnh cục bộ bằng dữ liệu file; đủ ảnh đúng thứ tự trước tạo bài, không phụ thuộc URL công khai. *(Đã làm phần mã: tải từng ảnh bằng DỮ LIỆU FILE (multipart `source`, `published=false`) theo đúng thứ tự, kiểm tra tất cả ảnh bằng chữ ký file TRƯỚC khi tải ảnh nào, không dùng URL công khai; lỗi giữa chừng thì xóa ảnh đã tải và dừng trước khi gửi (`page-publisher.test.ts`). CHƯA tick: Meta có chấp nhận tải bằng file và đính nhiều ảnh theo `attached_media[i]` hay không chưa thử (xem `docs/fanpage.md`))* *(Bài thử thật 28/10/2026: Meta NHẬN ảnh tải bằng file và đính 2 ảnh (tạo bài, trả ID `107892312229541_1104216589257690`). Chờ người dùng xác nhận bằng mắt đủ 2 ảnh và đúng thứ tự trước khi tick)* *(Người dùng xác nhận bằng mắt 28/10/2026: bài thật trên Page "Góc Nghiện Đồ Hay" đủ 2 ảnh đúng thứ tự, đúng nội dung, công khai, đúng Page. Chưa thử 1 ảnh/nhiều ảnh hơn và lỗi thật từ Meta)*
- [x] P09.4. Tạo bài chữ/ảnh theo khả năng đã kiểm chứng, lưu ID/nguồn xác nhận; phân loại hết quyền/hết hạn/rate limit/mạng. *(Đã làm phần mã: tạo bài `POST /{page-id}/feed` kèm ảnh đã tải, lưu ID/liên kết với nguồn `api_response`; phân loại token hết hạn / bị từ chối quyền / giới hạn tần suất / mạng và đánh dấu kết nối để job sau bị chặn. Mọi ảnh bắt buộc ≥1 nên bài fanpage luôn là bài có ảnh. CHƯA tick: chưa đăng thật lần nào nên chưa kiểm chứng "theo khả năng đã kiểm chứng")* *(Bài thử thật 28/10/2026: tạo bài thành công, lưu ID và liên kết, nguồn `api_response`. Phân loại lỗi mới kiểm với Graph giả (chưa gặp lỗi thật). Chờ xác nhận bằng mắt rồi tick)* *(Người dùng xác nhận bằng mắt 28/10/2026: bài thật trên Page "Góc Nghiện Đồ Hay" đủ 2 ảnh đúng thứ tự, đúng nội dung, công khai, đúng Page. Chưa thử 1 ảnh/nhiều ảnh hơn và lỗi thật từ Meta)*
- [x] P09.5. Lịch giữ cục bộ; gửi khi đến hạn và sau kiểm tra dữ liệu theo mục 3. *(Job fanpage đi qua hàng chờ chung: duyệt theo kết nối Page (không cần tài khoản trình duyệt), lịch giữ cục bộ, worker gửi khi đến hạn sau khi kiểm tra lại quyền/token/phiên bản (`page-post.test.ts`, `page-job.test.ts`, `pages-api.test.ts`); Page hết hạn → job bị chặn, không gọi Meta. Mới kiểm với Graph giả)*
- [x] P09.6. Timeout sau yêu cầu tạo bài trả unknown khi chưa rõ; không tự tạo lại. *(Mất kết nối, quá giờ, lỗi tạm thời hoặc phản hồi lạ sau khi gửi → `unknown`, đúng MỘT yêu cầu tạo bài, gọi lại cũng không gửi thêm; qua runner job là `unknown` và không bao giờ tự thử lại (`page-publisher.test.ts`, `page-job.test.ts`). Mới kiểm với Graph giả)*
- [x] P09.7. Gỡ Page dừng lịch phụ thuộc, không đổi Page; xác định riêng cấu hình mạng API. *(Gỡ Page: thu hồi token, lưu trữ kết nối, hủy job chưa gửi, yêu cầu dừng job đang chạy, giữ nguyên job đã có kết quả, không đổi sang Page khác (`page-post.test.ts`, `pages-api.test.ts`). Lời gọi Graph đi thẳng từ máy (proxy hoãn, P04): chưa có cấu hình mạng riêng cho API)*
- [ ] P09.8. Đối chiếu quyền/phiên bản qua [Meta](https://developers.facebook.com/docs/pages-api/posts/) khi làm. Trang này trả lỗi giới hạn truy cập trong phiên lập kế hoạch; chưa xác minh hợp đồng API hiện hành qua trang đó. *(Đã đọc được trang chính thức của Meta ngày 28/10/2026 (khác lần lập kế hoạch bị chặn): quyền, Page token, `tasks`, endpoint `/feed` và `/photos`. Bảng "đã/chưa đối chiếu" ở `docs/fanpage.md`; các điểm chưa đối chiếu (đăng ở chế độ Phát triển, nhiều ảnh, tải bằng file, giới hạn, phiên bản API) cần bài thử thật)* *(Cập nhật 28/10/2026: đã xác minh bằng bài thật — đăng được ở chế độ Phát triển, nhận ảnh tải bằng file, nhận `attached_media[i]`; còn lại giới hạn ảnh, thời hạn token Page, phiên bản API (xem `docs/fanpage.md`))*

**Đầu ra:** PageConnection và PagePublisher dùng hàng chờ chung.

**Đạt khi:** đúng Page nhận đủ nội dung/ảnh, lưu ID/trạng thái, không lộ token; unknown xử lý riêng. Còn chờ quyền Meta thì ghi bị chặn bên ngoài, không xong.

### P10 — Hoàn thiện ba trang đăng bài

**Mục tiêu:** dùng được từ nhập máy đến kết quả trong UI.

**Giao diện theo bản tham khảo v1 (28/10/2026):** đã áp dụng shell/sidebar mới, màn Đăng nhóm hai cột chọn máy/nhóm + preview/lịch, quét ngay trong trang, chọn số lượng, caption riêng theo nhóm và cấu hình thu gọn; responsive desktop/mobile. Giữ các luồng duyệt/xếp lịch và trang fanpage vừa bổ sung. Có test UI offline 40 → chọn 30 → sửa caption → lưu cấu hình → giữ nháp khi đổi trang → xếp đúng 30 job, menu mobile/no-overflow. Xem `docs/design/ui-implementation.md`; không coi việc đổi bố cục là hoàn thành phần tích hợp còn mở ở P10.1/P10.4.

- [ ] P10.1. Composer chung: máy, ảnh, caption/phiên bản, tài khoản/đích/lịch; không mất nội dung khi đổi màn hình. *(Phần cho kênh nhóm xong: máy, ảnh theo thứ tự, caption mẫu/sửa tay, tài khoản, nhóm, lịch; bản nháp đang soạn được giữ khi chuyển trang trong phiên. Chưa có phiên bản chọn lại từ bản đã lưu, trang cá nhân và fanpage dùng lại sau.)*
- [x] P10.2. Đăng nhóm nhận P06 hoặc link/ID, hiển thị điều kiện/nội quy từng nhóm. *(Trang "Đăng bài viết nhóm" nhận nhóm đã chọn từ trang Nhóm; liệt kê nhóm theo tài khoản kèm nội quy, duyệt bài, lý do chưa đăng được; nhóm chưa đủ điều kiện bị khóa. Mới: nhập 1–100 nhóm, tự chọn trong bộ lọc hiện tại, ưu tiên curation rồi tên/id, thay lựa chọn cũ, báo thiếu số lượng, không mượn quyền nick khác; chọn không tạo job, vẫn xem trước/duyệt. UI offline quét 40 → chọn 30 → duyệt đúng 30 job đạt. Thêm nhóm bằng link/ID làm ở trang Nhóm.)*
- [x] P10.3. Đăng cá nhân chọn một/hai tài khoản, hiển thị đúng TCN; không tự dùng danh sách group làm đích. *(Trang "Đăng bài viết cá nhân": chọn một hoặc hai tài khoản (chỉ tài khoản đã đăng nhập, có danh tính, không tạm dừng); đích luôn là trang cá nhân của CHÍNH tài khoản đó (`profile-destination`), xem trước hiển thị đúng trang/danh tính; mỗi tài khoản một job và một kết quả riêng; cảnh báo cùng caption giữa hai tài khoản (P10.6); không dùng danh sách nhóm làm đích. Mới đạt mô phỏng; chưa đăng thật.)*
- [x] P10.4. Đăng fanpage chọn Page có quyền; trạng thái kết nối tách khỏi browser. *(Trang "Đăng fanpage" (`PostPagePage.tsx`): chọn Page (kèm lý do chưa đăng được), máy, caption, lịch, xem trước, xác nhận đăng thật công khai, kết quả; trạng thái kết nối tách khỏi trình duyệt; gỡ Page. Test logic (`page-plan.test.ts`) và API; CHƯA tick vì chưa thử trang trên trình duyệt và chưa đăng thật)* *(Cập nhật 28/10/2026: trang "Đăng fanpage" đã chạy trên trình duyệt thật (Edge): chọn Page, xem trước đủ 2 ảnh theo thứ tự, xác nhận đăng thật, kết quả "Đã đăng" kèm ID bài; chờ người dùng xác nhận bằng mắt trên Facebook rồi tick)* *(Người dùng xác nhận bằng mắt 28/10/2026: bài thật trên Page "Góc Nghiện Đồ Hay" đủ 2 ảnh đúng thứ tự, đúng nội dung, công khai, đúng Page. Chưa thử 1 ảnh/nhiều ảnh hơn và lỗi thật từ Meta)*
- [x] P10.5. Preset theo cặp tài khoản–đích/mẫu/lịch; hai tài khoản không mặc định nhân đôi mọi group. *(Cấu hình lưu theo CẶP tài khoản–nhóm do người dùng chọn rõ (bảng `posting_presets`/`preset_targets`), mẫu caption có chỗ trống `{ten} {gia}…` (dòng thiếu dữ kiện tự bỏ, không bịa), lịch "ngay" hoặc "hằng ngày HH:MM giờ Việt Nam". Trang "Đăng bài viết nhóm": lưu/cập nhật/ngừng dùng/áp dụng; áp dụng chỉ điền sẵn form, chọn nhóm của ĐÚNG tài khoản và còn đủ điều kiện, nhóm bị bỏ qua được báo rõ; không có đường nào tự nhân nhóm sang tài khoản khác; lưu/áp dụng không tạo job. Đã thử trên trình duyệt (mô phỏng). Giới hạn: trang cá nhân và fanpage chưa dùng cấu hình; "hằng ngày" là điền sẵn giờ hẹn kế tiếp khi áp dụng, chưa có bộ lập lịch tự lặp.)*
- [x] P10.6. Preview từng phiên bản, đủ ảnh/thứ tự/đích/giờ; cảnh báo trùng giữa hai tài khoản. *(Xem trước từng nhóm: ảnh theo thứ tự, caption (sửa riêng được), giờ hẹn theo giờ Việt Nam, chế độ mô phỏng/THẬT; cảnh báo cùng caption cho nhiều nhóm và giống bản đã lưu cho cùng nhóm. Cảnh báo trùng giữa hai tài khoản chưa có (chỉ một tài khoản mỗi lần).)*
- [x] P10.7. Duyệt theo phiên bản, tạo job theo mã yêu cầu; ghi rõ mô phỏng/tự động/bán tự động/chưa hỗ trợ. *(`POST /api/posts`: tạo bản caption riêng từng đích, duyệt theo phiên bản máy và danh tính đã xác nhận, xếp job; mã yêu cầu chống bấm hai lần (kể cả mất phản hồi); tất cả hoặc không gì, nhóm bị chặn được liệt kê; chế độ THẬT cần tick xác nhận trước khi gửi.)*
- [x] P10.8. Kết quả từng đích, bắt đầu/tạm dừng/dừng và lý do chưa chạy; không thành công chung khi chỉ một đích thành công. *(Kết quả từng nhóm hiển thị riêng (đã đăng/chờ duyệt/không rõ/lỗi kèm lý do); tạm dừng, hủy, chạy ngay, yêu cầu dừng từng job ở "Hàng chờ đăng".)*
- [x] P10.9. Máy đã bán/nguồn đổi phản ánh ở bài/lịch; mở được phiên bản cũ, không âm thầm sửa bài đã duyệt. *(Hàng chờ hiện thông báo máy đã sửa/đã bán trên từng job; chi tiết job luôn hiển thị đúng caption/ảnh của bản đã duyệt (không âm thầm sửa); server chuyển job chưa gửi sang "Cần xem lại" khi máy sửa và hủy khi bán/ngừng bán. Mới: trang Máy xem trước tác động (`GET /api/products/:id/impact`) và hỏi xác nhận trước khi lưu bản sửa/đổi trạng thái nếu có bài bị ảnh hưởng; không kiểm tra được thì không lưu. Đã thử trên trình duyệt (mô phỏng). Giới hạn: xem lại bản máy cũ chỉ qua bản duyệt trong chi tiết job và lịch sử caption, chưa có màn xem toàn bộ dữ kiện máy ở phiên bản cũ.)*

**Đầu ra:** ba trang đăng cùng bố cục và backend/worker.

**Đạt khi:** ba đầu vào tạo máy, dùng preset, preview và theo dõi job độc lập. Một nhóm yêu cầu giá chỉ chặn đích đó hoặc yêu cầu bổ sung, không chặn mọi bản nháp.

### P11 — Nhật ký, đối chiếu và phục hồi

**Mục tiêu:** biết việc gì đã xảy ra khi lỗi/restart, giữ dữ liệu sử dụng được.

- [x] P11.1. Lọc lịch sử theo máy/tài khoản/đích/giờ/trạng thái, xem caption/ảnh phiên bản thực tế và lần thử. *(Hàng chờ có bộ lọc trạng thái/tài khoản/máy/đích/giờ/mã job; "Chi tiết" hiện caption và ảnh theo thứ tự của bản đã duyệt, từng lần thử, quan sát có nguồn, nhật ký hoạt động. Đã thử trên trình duyệt (mô phỏng).)*
- [x] P11.2. Unknown có verify chỉ đọc hoặc xác nhận thủ công kèm nguồn; không có thử lại mù. *(Đối chiếu bằng xác nhận thủ công kèm nguồn `manual` (đã đăng / chờ admin duyệt / chưa đăng), hai bước xác nhận, quan sát mới được thêm (không xóa quan sát cũ); không có đường đưa job về hàng chờ để gửi lại. Chưa có verify chỉ đọc tự động qua trình duyệt (tiêu chí cho phép "hoặc"). Đã thử trên trình duyệt (mô phỏng).)*
- [x] P11.3. Group pending giữ đúng trạng thái; quan sát lại trong giới hạn hoặc xác nhận thủ công, không tự thành published sau khoảng chờ. *(pending_approval giữ nguyên cho tới khi người dùng xác nhận (đã duyệt/bị từ chối), có test chặn đổi bừa; chưa có quan sát lại tự động.)*
- [x] P11.4. Crash: phân loại trước/sau gửi, xử lý khóa treo, không tạo worker thứ hai khi tiến trình cũ còn chạy. *(Job bị bỏ dở được phân loại theo mốc gửi: trước gửi → tạm dừng, sau gửi → unknown (worker gọi `recoverExpired` mỗi vòng); khóa worker mồ côi tự dọn, bản worker thứ hai bị từ chối (`worker.lock`, test chạy tiến trình thật). Chưa thử mất điện/kill giữa lúc đăng thật.)*
- [x] P11.5. Backup DB nhất quán cùng manifest và ảnh tham chiếu, kiểm tra hashes khi restore. Tham khảo [SQLite Online Backup](https://sqlite.org/backup.html), không copy tùy ý DB đang ghi. *(`npm run backup`: DB qua API sao lưu trực tuyến của SQLite + ảnh tham chiếu + `manifest.json` (SHA-256, ghi cuối cùng); từ chối ghi vào repo; xem `docs/backup.md`.)*
- [x] P11.6. Bản xuất thông thường loại cookie/profile/token/khóa. Restore sang máy mới báo cần đăng nhập/kết nối lại; không giả định bí mật bảo vệ theo Windows chuyển được giữa máy. *(Không chứa `profiles`, `secrets`, `logs`, `backups`, `spikes`, `cache` (test dùng dữ liệu mồi). Sau khi phục hồi tài khoản về `login_required`, job chờ chuyển sang tạm dừng (không tự chạy).)*
- [x] P11.7. Restore vào vùng tạm, kiểm tra trước thay dữ liệu; không ghi đè bộ dữ liệu tốt bằng backup hỏng. *(`npm run restore -- <thư mục> [--verify-only] [--replace]`: kiểm tra mã băm/integrity/schema, phục hồi vào thư mục tạm rồi mới thay; bản hỏng hoặc dở dang không đụng tới dữ liệu hiện tại; dữ liệu cũ được đổi tên, không xóa; từ chối khi worker đang chạy. Đã chạy thử script trên dữ liệu tạm.)*
- [x] P11.8. Chẩn đoán lọc secrets; screenshot/trace nhạy cảm chỉ thu khi bật rõ và có thời hạn lưu. *(`npm run diagnostics` chỉ in số đếm/mã trạng thái/kích thước (test chứng minh không lộ caption, tên, mã đích, đường dẫn, nội dung log/hồ sơ/khóa/ảnh chụp). Ảnh chụp màn hình khi một lần đăng THẬT dừng vì lỗi hoặc kết quả chưa rõ: **tắt mặc định**, chỉ bật bằng `APM_DIAG_CAPTURE=on` (giá trị khác `on`/`off` bị từ chối), worker ghi cảnh báo to khi bật; hạn lưu `APM_DIAG_RETENTION_HOURS` (mặc định 24, tối đa 168) và ảnh quá hạn tự bị xóa khi worker khởi động + mỗi 10 phút (kể cả khi đã tắt thu); tối đa 100 ảnh; dọn ngay bằng `npm run diagnostics -- --purge-captures`; không nằm trong bản sao lưu; **không bao giờ ghi trace** (trace chứa cả cookie/header). Hook chụp lỗi không làm đổi kết quả đăng. Đã thử trên Facebook giả (Edge ngầm): chụp PNG thật khi dừng trước gửi và khi unknown, không chụp khi đăng thành công hoặc khi dừng chủ động. Chưa thử trên một lỗi đăng thật vì chưa có lỗi thật nào xảy ra khi bật.)*
- [x] P11.9. Nhập tay nguồn khách hỏi/đơn hàng; không bắt tự đọc tương tác TCN/group. *(Trang "Khách hỏi và đơn hàng" + bảng `sales_events` (migration 0005): tự ghi nhận khách hỏi/đơn hàng của một máy, tùy chọn gắn bài đã gửi đi làm nguồn (phải đúng máy), giá trị đơn tùy chọn; lọc, tổng hợp theo máy và theo nơi đăng; nhập nhầm thì "Hủy ghi nhận" hai bước (đánh dấu, không xóa; DB chặn sửa/xóa). Không có gì đọc tin nhắn/bình luận từ Facebook. Đã thử trên trình duyệt (mô phỏng). Giới hạn: chưa hiện số khách hỏi/đơn ngay trong chi tiết job, chưa xuất CSV, tổng hợp chỉ là số người dùng nhập.)*

**Đầu ra:** lịch sử, đối chiếu unknown, phục hồi/backup, hướng dẫn chẩn đoán.

**Đạt khi:** restore vùng sạch đủ máy/ảnh/lịch sử; lịch không tự chạy khi thiếu điều kiện; log/bản xuất không có bí mật thô.

### P12 — Kiểm thử tổng thể và bàn giao Windows

**Mục tiêu:** người dùng mở/dùng/dừng/cập nhật mà không sửa mã.

- [x] P12.1. Chạy ma trận mục 7: quy tắc offline, Facebook thật khi cần bằng đích đã chọn. *(Đã chạy ma trận T01–T18 và ghi bằng chứng/giới hạn từng dòng ở `docs/nghiem-thu.md`: 10 Đạt, 6 Một phần, 2 Chưa. Các dòng chưa đạt đều thuộc phần chưa xong (Page P09, proxy P04, quét nhóm P06, LLM P13) hoặc cố ý chưa thử trên Facebook thật; Facebook thật đã thử một lần cho nhóm và TCN.)*
- [x] P12.2. Đóng/mở UI/server/worker, chỉ một scheduler; tắt app ngừng nhận việc và báo job chưa rõ kết quả. *(Test tiến trình thật: `tests/e2e/launcher.test.ts` (một cổng phục vụ giao diện+API; chỉ một worker, bản thứ hai bị từ chối; launcher bị giết đột ngột thì server và worker tự dừng nhờ `APM_PARENT_PID` và lần khởi động sau không bị khóa mồ côi chặn), `tests/e2e/lifecycle.test.ts` (worker thật khởi động lại: lịch quá hạn không phát dồn; job bị bỏ dở sau mốc gửi → unknown, trước mốc gửi → tạm dừng, không lần thử mới). Mô phỏng; chưa thử mất điện/kill giữa lúc đăng thật.)*
- [x] P12.3. Launcher và hướng dẫn Windows; thử đường dẫn có dấu/khoảng trắng, thiếu runtime/browser, cổng bị chiếm; không đường dẫn cứng. *(`Auto-Post-MKT.cmd` / `npm start` + `packages/ops` (preflight: Node sai phiên bản, thiếu thư viện, cổng bị chiếm — phân biệt "đã đang chạy" với chương trình khác —, thư mục dữ liệu không ghi được, thiếu Edge, worker đang chạy). Không đường dẫn cứng (suy từ vị trí file, biến môi trường). Đã chạy thật bằng chính file `.cmd` từ `...Thử Nghiệm Có DấuAuto Post MKT` với thư mục dữ liệu có dấu: kiểm tra, khởi động, trang và API đều đạt. Chưa thử trên máy sạch chưa cài Node/Git.)*
- [x] P12.4. Build và phục vụ UI cục bộ; không phục vụ file nhạy cảm như static; không tự mở truy cập từ xa. *(`apps/server/src/static-ui.ts` (`APM_SERVE_WEB=on`, launcher tự bật): chỉ `/` và file phẳng trong `/assets/` theo danh sách đuôi, CSP, nosniff, không `.map`, không thoát đường dẫn, vẫn chặn Host/Origin lạ, chỉ nghe 127.0.0.1; 3 test gồm 19 đường dẫn thử tải file nhạy cảm đều bị chặn.)*
- [x] P12.5. Backup trước cập nhật, migration/quay về dữ liệu đã kiểm tra; cập nhật không xóa session/media. *(`npm run update` / `Cap-nhat-Auto-Post-MKT.cmd` (`packages/ops/src/update.ts`): từ chối khi ứng dụng đang chạy hoặc mã nguồn có thay đổi chưa commit; sao lưu và kiểm tra mã băm TRƯỚC khi đổi gì; `git pull --ff-only`; `npm ci` chỉ khi package-lock đổi; migration; build; dừng ngay khi lỗi và in cách quay về (git checkout bản cũ + `npm run restore`); không lệnh phá hủy. Test cập nhật thật trên dữ liệu tạm giữ nguyên hồ sơ đăng nhập/khóa/ảnh và quay về được từ sao lưu. Phát hiện và sửa: sao lưu khi DB còn schema cũ (chưa có bảng media) bị lỗi. Chưa chạy trọn vẹn trên bản cài thật (cần kho từ xa); đã chạy thật bước chặn "mã nguồn chưa commit".)*
- [x] P12.6. Hướng dẫn ba đầu vào, hai tài khoản/proxy, chọn nhóm/Page, preview/dừng/unknown/đánh dấu đã bán. *(`docs/huong-dan.md` (cài đặt, khởi động/dừng, chế độ mô phỏng/thật, tài khoản, máy, nhóm, đăng nhóm/TCN, cấu hình thường dùng, hàng chờ/unknown, sửa/bán máy, khách hỏi/đơn, sao lưu/cập nhật/chẩn đoán, sự cố, an toàn). Ghi rõ fanpage và proxy chưa có. Chưa có người dùng ngoài tác giả đọc thử.)*
- [x] P12.7. Nghiệm thu một chu trình với cấu hình thật, ghi phiên bản/khả năng đạt hoặc chưa đạt/tồn đọng. *(Đạt 28/10/2026 cho một chu trình: launcher chế độ THẬT (commit `eee44bb`), nick phụ `phu1` đăng một bài (chữ + 2 ảnh) vào nhóm `1357510931662685` do người dùng cho phép riêng; `published` sau ~43 giây (ID `2307345636679205`, nguồn `ui_observation`); giết launcher rồi mở lại không đăng lại; sao lưu khi đang chạy + `--verify-only` + phục hồi sang thư mục tạm đạt. Phát hiện/sửa: script backup tự migrate. Giao diện do Edge ngầm của tôi điều khiển, chưa phải người dùng tự bấm; chưa thử đóng giữa lúc đang gửi trên Facebook thật. Chi tiết `docs/nghiem-thu.md`.)*
- [x] P12.8. Cập nhật README đúng hành vi thực tế, ghi máy phải hoạt động để chạy lịch cục bộ. *(README mục 11 viết lại theo hành vi thật (đã dùng được / chưa có / cách chạy), nêu rõ máy phải bật và cửa sổ launcher phải mở thì lịch cục bộ mới chạy; `docs/environment.md` thêm biến mới.)*

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
| 27/10/2026 | P02.5 | DPAPI CurrentUser + ACL kho secrets, put/get/revoke/lost, ADR0009 | 2/2 Windows tests thật ngoài sandbox; typecheck/lint đạt; không thêm dependency | P02.7 API/validation và P02.8 test fixtures |
| 27/10/2026 | P02.7 | Upload/read media bằng bytes/ID, product create/list, strict schemas/body bounds/pagination, ADR0010 | 3/3 API tests; typecheck đạt; full gate cùng P02.8 | P02.8 test runner/fixtures, sau đó phần độc lập P03/P05 |
| 27/10/2026 | P05.1–P05.4 | Trang Quản lý máy: form ảnh/thứ tự/thumbnail, sửa = revision mới, đã bán/ngừng bán, caption mẫu + chỉnh tay (chưa lưu) | 133/133 test, typecheck/lint đạt; chạy thật server+Vite+Edge headless; build:web vướng quyền dist cũ (build tạm đạt) | P05.5 lưu/duyệt phiên bản, P05.7, P05.8 |
| 27/10/2026 | P05.5–P05.8 | Lưu bản caption theo phiên bản máy, cảnh báo giống nội dung, dọn ảnh mồ côi an toàn | Test theo phần mới; cổng tổng cuối phase: 139/139 test, typecheck/lint đạt, build web ra thư mục tạm đạt | P03/P04/P06 hoặc P01 thật khi có đầu vào |
| 27/10/2026 | P03.1/P03.2/P03.6 (một phần) | Trang Quản lý tài khoản: thêm/đổi nhãn/tạm dừng/gỡ, tối đa hai, hồ sơ trình duyệt riêng | Test theo phần mới (repository 2, API 7 trong file); chạy thật Edge headless; chưa chạy cổng tổng | P03.3+ cần trình duyệt/P01; P04 proxy |
| 27/10/2026 | P06.1/P06.6/P06.7 | Trang Nhóm đã tham gia (nhập tay): chuẩn hóa link/ID, quan hệ theo tài khoản, lọc, ưu tiên, chuyển sang Đăng nhóm; migration 0003, ADR 0011 | Test theo phần mới (domain 3, repository 3, API); chạy thật Edge headless; chưa chạy cổng tổng | P01 thật để mở P06.2–P06.4; P05.5/P05.6 nay làm được với đích |

Nhật ký chi tiết từng lượt (có giờ, lệnh kiểm tra, tồn đọng) ghi trong [report_daily.md](report_daily.md).

## 11. Việc làm ở lượt triển khai đầu tiên

- [x] Kiểm tra môi trường/đường dẫn tại `D:/Project/Auto_Post_MKT` (hai máy đồng bộ qua git; đã bỏ OneDrive — ADR 0001).
- [x] P00: khung bốn mục, API health, SQLite tối thiểu, adapter giả.
- [x] Chuẩn bị P01 và liệt kê đầu vào người dùng cần cung cấp: đăng nhập hai tài khoản, đích thử, proxy nếu dùng. *(docs/feasibility.md; đây là chuẩn bị, chưa nghiệm thu P01.)*
- [ ] Chưa bật lịch đăng thật trước khi adapter và dừng/đối chiếu đạt yêu cầu.

Hiện tại chỉ lập kế hoạch; các thư mục, công cụ và chức năng trên sẽ được tạo khi bắt đầu triển khai.
