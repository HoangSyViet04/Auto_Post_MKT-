/**
 * Thử ĐĂNG THẬT qua toàn bộ ứng dụng (P08.8): tạo máy thử (2 ảnh xanh/đỏ), bản caption cho đích, duyệt và xếp một job chạy ngay.
 *   node scripts/live-test-post.ts --account=<nhãn tài khoản> --group=<ID số nhóm> --confirm-post
 * Điều kiện: đã chạy `npm run dev:server`, `npm run dev:worker` và `dev:web` với APM_INTEGRATIONS=live, worker có APM_BROWSER=real,
 * tài khoản đã đăng nhập (trang Quản lý tài khoản) và nhóm đã có trong danh sách. Script từ chối chạy nếu server không ở chế độ THẬT.
 * Khai báo "được phép đăng" cho cặp tài khoản–nhóm này: chỉ dùng cho nhóm BẠN quản trị hoặc được phép đăng thử.
 * Bài thử có dòng định danh [APM-P08-<giờ>]; bạn tự xóa bài trên Facebook sau khi kiểm tra.
 */
import sharp from 'sharp';
import { createLogger } from '#logging';

const log = createLogger({ env: 'development', name: 'live-test' });
const fail = (message: string): never => { log.error({ code: 2 }, message); process.exit(2); };
const flags = new Map(process.argv.slice(2).map((arg) => {
  const [key = '', ...value] = arg.replace(/^--/u, '').split('=');
  return [key, value.join('=') || 'true'] as const;
}));
const accountLabel = flags.get('account') ?? '';
const groupId = flags.get('group') ?? '';
if (!accountLabel || !/^\d{10,25}$/u.test(groupId)) fail('Dùng: node scripts/live-test-post.ts --account=<nhãn> --group=<ID số nhóm> --confirm-post');
if (!flags.has('confirm-post')) fail('Thiếu --confirm-post: lệnh này ĐĂNG BÀI THẬT lên Facebook.');

const base = 'http://127.0.0.1:5173';
const health = (await (await fetch(`${base}/api/health`)).json()) as { integrations: string; worker: { alive: boolean; browser: string } };
if (health.integrations !== 'live') fail('Server không ở chế độ THẬT (APM_INTEGRATIONS=live). Dừng, không đăng gì.');
if (!health.worker.alive || health.worker.browser !== 'real') fail('Worker chưa chạy hoặc chưa bật APM_BROWSER=real. Dừng, không đăng gì.');

const { token } = (await (await fetch(`${base}/api/session`)).json()) as { token: string };
const auth = { 'x-apm-token': token, origin: base };
const call = (method: string, path: string, body?: unknown) => fetch(base + path, { method, headers: { ...auth, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

const accounts = ((await (await fetch(`${base}/api/accounts`)).json()) as { items: Array<{ id: string; label: string; sessionStatus: string }> }).items;
const account = accounts.find((item) => item.label.toLowerCase() === accountLabel.toLowerCase());
if (!account) fail('Không có tài khoản với nhãn này.');
if (account?.sessionStatus !== 'logged_in') fail('Tài khoản chưa ở trạng thái đã đăng nhập. Dùng "Đăng nhập"/"Kiểm tra phiên" trước.');
const groups = ((await (await fetch(`${base}/api/groups?pageSize=100&includeArchived=false`)).json()) as { items: Array<{ id: string; externalId: string | null; name: string | null }> }).items;
const group = groups.find((item) => item.externalId === groupId);
if (!group) fail('Nhóm này chưa có trong danh sách (nhập ở trang Nhóm).');
if (!account || !group) process.exit(2);

log.info({ account: account.label, group: group.name ?? group.externalId }, 'Chuẩn bị đăng bài thử THẬT');
const permission = await call('PUT', `/api/groups/${group.id}/accounts/${account.id}`, { permission: 'allowed' });
if (!permission.ok) fail('Không khai báo được quyền đăng.');
const image = async (color: string) => {
  const bytes = await sharp({ create: { width: 640, height: 480, channels: 3, background: color } }).png().toBuffer();
  const response = await fetch(`${base}/api/media`, { method: 'POST', headers: { ...auth, 'content-type': 'image/png' }, body: new Uint8Array(bytes) });
  return ((await response.json()) as { id: string }).id;
};
const [blue, red] = [await image('#2563eb'), await image('#dc2626')];
const marker = `APM-P08-${new Date().toISOString().replace(/\D/gu, '').slice(0, 14)}`;
const product = (await (await call('POST', '/api/products', { name: 'Máy thử P08', condition: 'Bài thử nghiệm, không bán', mediaIds: [blue, red] })).json()) as { productId: string; revisionId: string };
const caption = `[${marker}] Bài thử nghiệm của ứng dụng, sẽ được xóa.\nDòng hai: ảnh xanh rồi ảnh đỏ.`;
const version = (await (await call('POST', `/api/products/${product.productId}/content-versions`, { revisionId: product.revisionId, caption, source: 'manual', destinationId: group.id })).json()) as { id: string };
const approval = await call('POST', '/api/approvals', { contentVersionId: version.id, accountId: account.id });
if (!approval.ok) fail('Không duyệt được (kiểm tra tài khoản đã xác nhận danh tính và nhóm đủ điều kiện).');
const { approvalId } = (await approval.json()) as { approvalId: string };
const queued = await call('POST', '/api/jobs', { requestKey: `live-test-${Date.now()}`, jobs: [{ approvalId, scheduledAt: Date.now() }] });
if (!queued.ok) fail('Không xếp được job.');
log.info({ marker }, 'Đã xếp job. Worker sẽ mở trình duyệt và đăng; xem kết quả ở trang "Hàng chờ đăng". Nhớ xóa bài thử trên Facebook.');
