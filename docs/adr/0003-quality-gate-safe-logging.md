# ADR 0003 — Biome và logger chung lọc bí mật trước đầu ra

- Ngày: 2026-10-26
- Trạng thái: Đã chấp nhận
- Phạm vi: P00.7

## Bối cảnh

Node 24 chạy TypeScript bằng type stripping; TypeScript 7 kiểm tra riêng hai môi trường Node/web. Cần lint mà không thêm bước transpile, cùng một cổng kiểm tra và log an toàn cho server/worker/công cụ migration.

## Quyết định

1. Dùng **@biomejs/biome 2.6.3** (devDependency, khóa chính xác). Một công cụ có parser TypeScript/TSX riêng, không cần ghép ESLint với parser/plugin TypeScript hay phụ thuộc khả năng hỗ trợ TypeScript 7 của bộ parser đó. Chạy binary Windows do npm cài, không biên dịch mã ứng dụng. Theo [hướng dẫn cài Biome](https://biomejs.dev/installation/install-biome/).
2. `biome.json` bật bộ recommended, cấm enum/namespace/parameter properties, yêu cầu import type và đuôi import tương đối (`forceJsExtensions: false`, giữ `.ts`/`.tsx`). `erasableSyntaxOnly` và NodeNext trong typecheck vẫn là hàng rào cho Node 24. Import xuyên module tiếp tục qua `#...`, thêm `#logging`. Không dùng formatter/organize imports để tránh đổi hàng loạt mã không liên quan. [Quy tắc import extensions](https://biomejs.dev/linter/rules/use-import-extensions/).
3. `npm run lint` thất bại cả khi có warning; `npm run check` chạy tuần tự typecheck → lint → test → build:web, dừng ở bước lỗi. Typecheck và Node test không phát sinh bản build server/worker.
4. Khai báo **pino 10.4.0** trực tiếp (đã được Fastify dùng gián tiếp, nay mã ứng dụng import trực tiếp). Thêm **pino-pretty 13.2.0** làm dependency runtime vì Node chạy trực tiếp cả chế độ development. Development dùng pretty đồng bộ, test/production dùng JSON; không tạo file log trong repo. [Pino API](https://github.com/pinojs/pino/blob/main/docs/api.md), [pino-pretty](https://github.com/pinojs/pino-pretty).
5. Mọi log server (bao gồm Fastify request/error/child), worker, migration dùng `#logging`. Destination của Pino parse từng bản ghi JSON, gọi hàm chung `redactSecrets`, rồi mới chuyển sang stdout/pretty. Lọc sau serializer, format arguments, bindings và `toJSON` để chúng không đi vòng qua bộ lọc. Khi lọc lỗi chỉ xuất thông báo cố định, không xuất bản ghi/lỗi gốc. Không dùng console trực tiếp (lint cấm).
6. Hàm lọc không sửa input; đi qua object/array mọi tầng, che key cookie/token/authorization/password/proxy password/API key/secret/credentials/session, không phân biệt hoa thường hoặc dấu ngăn cách. Che toàn bộ `headers`, `body`, `rawBody`, `payload` vì nội dung có thể không có key nhận diện. Chuỗi có dấu hiệu bí mật (JSON/form/query, Bearer/Basic, URL có userinfo, cookie Facebook) bị che toàn bộ; kiểm tra cả tên query được percent-encode. Header/form dạng name-value cũng được che. Error message/stack/cause, vòng tham chiếu và giới hạn độ sâu được xử lý.

## Hệ quả và giới hạn

- Log giữ ID công việc/request, trạng thái, thời gian và metadata an toàn; có thể che dư cả thông báo chứa từ `token`/`password`. Đây là đánh đổi có chủ ý. Body/header gốc không dùng để chẩn đoán qua log.
- Không có bộ lọc nào nhận diện được một chuỗi bí mật trần không có tên/ngữ cảnh. Không đưa bí mật vào message tự do, tên field hay metadata tùy ý. Khi bổ sung integration phải log mã lỗi/ID và bổ sung test dạng dữ liệu mới trước khi dùng.
- Lọc tại destination bổ sung chi phí parse/serialize mỗi dòng; phù hợp quy mô ứng dụng cục bộ hiện tại. Chưa xây lưu trữ/rotation/xuất nhật ký P11.
- Kiểm tra nghiệp vụ hiện có chỉ gồm config fake/live, fake publisher stop/unknown/pending và transaction/concurrency/migration. Chưa có quy tắc sản phẩm/scheduler để nghiệm thu các phần P02–P12; không coi mô phỏng là bằng chứng Facebook thật.

## Bằng chứng

Test kiểm tra chính đầu ra Pino JSON và pretty, Fastify inject có query/header/body/error, child bindings, format args và toJSON; sentinel giả không xuất hiện. Không sử dụng bí mật thật, không gọi Facebook.
