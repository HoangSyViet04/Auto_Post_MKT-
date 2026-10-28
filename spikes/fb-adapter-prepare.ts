/**
 * Chẩn đoán adapter nhóm trên Facebook THẬT, KHÔNG ĐĂNG: chỉ chạy `prepare` (đúng người, đúng nhóm, điền caption, đính ảnh, tìm nút Đăng)
 * rồi `stop()` đóng trình duyệt. Không bao giờ gọi `submit`.
 *   node spikes/fb-adapter-prepare.ts --account=<nhãn> --group=<ID số> --confirm-real
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import type { ApprovedPublishRequest } from '#contracts';
import { getDatabasePath, getDataDir } from '#config';
import { createGroupPublisher } from '#fb-group';
import { createLogger } from '#logging';
import { createAccountRepository, migrate, openDatabase } from '#storage';

const log = createLogger({ env: 'development', name: 'adapter-prepare' });
const flags = new Map(process.argv.slice(2).map((arg) => {
  const [key = '', ...value] = arg.replace(/^--/u, '').split('=');
  return [key, value.join('=') || 'true'] as const;
}));
const label = flags.get('account') ?? '';
const groupId = flags.get('group') ?? '';
if (!label || !/^\d{10,25}$/u.test(groupId) || !flags.has('confirm-real')) {
  log.error({ code: 2 }, 'Dùng: node spikes/fb-adapter-prepare.ts --account=<nhãn> --group=<ID số> --confirm-real (chỉ chuẩn bị, không đăng)');
  process.exit(2);
}

const db = openDatabase(getDatabasePath());
migrate(db);
const accounts = createAccountRepository(db);
const account = accounts.list().find((item) => item.label.toLowerCase() === label.toLowerCase());
const identity = account ? accounts.identityRef(account.id) : null;
if (!account || !identity) { log.error({ code: 3 }, 'Tài khoản chưa có danh tính xác nhận trong app.'); process.exit(3); }
const dataDir = getDataDir();

const dir = join(dataDir, 'spikes', 'tmp');
mkdirSync(dir, { recursive: true });
const images: string[] = [];
for (const [index, color] of ['#2563eb', '#dc2626'].entries()) {
  const path = join(dir, `prepare-${index + 1}.png`);
  writeFileSync(path, await sharp({ create: { width: 640, height: 480, channels: 3, background: color } }).png().toBuffer());
  images.push(path);
}
const request: ApprovedPublishRequest = { jobId: 'diag-job', destinationId: 'diag-dest', caption: 'Chẩn đoán adapter (không đăng)\nDòng hai', mediaPaths: images,
  context: { requestId: 'diag', approvalId: 'diag', contentVersionId: 'diag', expectedIdentity: { kind: 'account', localId: account.id, remoteId: identity },
    destination: { channel: 'group', remoteId: groupId } } };
const publisher = createGroupPublisher({ profileDirFor: (id) => join(dataDir, 'profiles', accounts.profileKey(id)) });
try {
  log.info({ account: account.label, group: groupId }, 'Chạy prepare (KHÔNG submit)');
  const result = await publisher.prepare(request);
  log.info(result.ok ? { ok: true } : { ok: false, reasonCode: result.reasonCode, reason: result.reason }, 'Kết quả prepare');
} finally {
  await publisher.stop(); // đóng phiên, không đăng
  db.close();
}
process.exit(0);
