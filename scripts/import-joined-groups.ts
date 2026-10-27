/**
 * Nhập danh sách nhóm đã đọc bằng `spikes/fb-groups-read.ts` vào DB của ứng dụng (không mở Facebook).
 *   node scripts/import-joined-groups.ts --label=<nhãn đã quét> --account=<nhãn tài khoản trong app> [--apply]
 * Mặc định chỉ chạy thử (không ghi). Tài khoản phải đã có trong trang Quản lý tài khoản. Chỉ đặt "đã tham gia";
 * quyền đăng vẫn để người dùng xác nhận. Kết quả đọc luôn là một phần, không phải toàn bộ nhóm của nick.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getAppEnv, getDatabasePath, getDataDir } from '#config';
import { normalizeGroupReference } from '#domain';
import { createLogger } from '#logging';
import { createAccountRepository, createGroupRepository, migrate, openDatabase } from '#storage';

const log = createLogger({ env: getAppEnv(), name: 'import-groups' });
function fail(message: string): never {
  log.error({ code: 2 }, message);
  process.exit(2);
}

const flags = new Map(process.argv.slice(2).map((arg) => {
  const [key = '', ...value] = arg.replace(/^--/u, '').split('=');
  return [key, value.join('=') || 'true'] as const;
}));
const label = flags.get('label') ?? '';
if (!/^[a-z0-9_-]{1,30}$/u.test(label)) fail('Dùng: node scripts/import-joined-groups.ts --label=<nhãn quét> --account=<nhãn tài khoản trong app> [--apply]');
const accountLabel = (flags.get('account') ?? '').trim();
if (!accountLabel) fail('Thiếu --account (nhãn tài khoản đã tạo trong app).');
const apply = flags.has('apply');

let scan: { complete?: unknown; results?: unknown };
try {
  scan = JSON.parse(readFileSync(join(getDataDir(), 'spikes', 'evidence', `${label}-joined-groups.json`), 'utf8'));
} catch {
  fail('Không đọc được kết quả quét. Chạy spikes/fb-groups-read.ts trước.');
}
if (!Array.isArray(scan.results)) fail('Tệp kết quả quét không hợp lệ.');
const items = scan.results.flatMap((entry: unknown) => {
  if (typeof entry !== 'object' || entry === null) return [];
  const { canonicalUrl, name } = entry as { canonicalUrl?: unknown; name?: unknown };
  return typeof canonicalUrl === 'string' ? [{ reference: canonicalUrl, name: typeof name === 'string' ? name : null }] : [];
});

const db = openDatabase(getDatabasePath());
try {
  migrate(db);
  const account = createAccountRepository(db).list().find((item) => item.label.toLocaleLowerCase('vi') === accountLabel.toLocaleLowerCase('vi'));
  if (!account) fail('Không có tài khoản đang dùng với nhãn này trong app. Tạo ở trang Quản lý tài khoản trước.');
  const recognized = items.filter((item) => normalizeGroupReference(item.reference)).length;
  const withId = items.filter((item) => normalizeGroupReference(item.reference)?.externalId).length;
  log.info({ account: account.label, trongTep: items.length, nhanDuoc: recognized, coIdSo: withId, chiCoTenRutGon: recognized - withId, apply, completeTrongTep: scan.complete === true }, apply ? 'Bắt đầu nhập' : 'Chạy thử, chưa ghi gì (thêm --apply để nhập)');
  if (apply) {
    const result = createGroupRepository(db).importObserved(account.id, items);
    log.info(result, 'Đã nhập (kết quả đọc là một phần; quyền đăng chưa được xác nhận)');
  }
} finally {
  db.close();
}
