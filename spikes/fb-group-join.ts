/**
 * P06.3 — gửi ĐÚNG MỘT yêu cầu tham gia nhóm trên Facebook thật bằng bộ gửi của ứng dụng (`createGroupJoiner`):
 *   node spikes/fb-group-join.ts --label=<nhãn> --group=<ID số> --confirm-send-one
 * Hoặc lấy nhóm công khai đầu tiên từ kết quả tìm đã lưu: --from-search (đọc <dataDir>/spikes/evidence/<nhãn>-group-search.json).
 * Chỉ MỘT lần bấm "Tham gia" (beforeSend chỉ cho phép một lần); nhóm có câu hỏi thì không gửi. Không đăng bài, không rời nhóm.
 * Bằng chứng ghi vào <dataDir>/spikes/evidence (ngoài repo): nhãn các nút trên trang nhóm và kết quả.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createGroupJoiner } from '#browser';
import { getAppEnv } from '#config';
import { createLogger } from '#logging';
import { openVerifiedProfile, spikesDir } from './fb-common.ts';

const log = createLogger({ env: 'development', name: 'spike-fb-group-join' });
const USAGE = 'Dùng: node spikes/fb-group-join.ts --label=<nhãn> (--group=<ID số> | --from-search) --confirm-send-one\nGửi đúng một yêu cầu tham gia nhóm bằng profile đã đăng nhập.';
function fail(message: string, code = 2): never {
  log.error({ code }, message);
  process.exit(code);
}
const say = (fields: Record<string, string | number | boolean>) => log.info(fields, String(fields.event));

const flags = new Map(process.argv.slice(2).map((arg) => {
  const [key = '', ...value] = arg.replace(/^--/u, '').split('=');
  return [key, value.join('=') || 'true'] as const;
}));
if (!flags.has('confirm-send-one') && !flags.has('dump-only')) fail(`Thiếu --confirm-send-one.\n${USAGE}`);
if (getAppEnv() === 'test') fail('Không chạy trong APM_ENV=test.');
const label = flags.get('label') ?? '';
if (!/^[a-z0-9_-]{1,30}$/u.test(label)) fail('--label không hợp lệ.');

let groupId = flags.get('group') ?? '';
let groupName = '';
if (flags.has('from-search')) {
  const evidence = JSON.parse(readFileSync(join(spikesDir(), 'evidence', `${label}-group-search.json`), 'utf8')) as { results: Array<{ url: string; name: string; lines: string[] }> };
  const pick = evidence.results.find((card) => /\/groups\/\d{5,30}$/u.test(card.url) && card.lines.slice(1).some((line) => /^công khai\s*·/iu.test(line)));
  if (!pick) fail('Không có nhóm công khai có ID số trong kết quả tìm.');
  groupId = pick.url.split('/').pop() ?? '';
  groupName = pick.name;
}
if (!/^\d{5,30}$/u.test(groupId)) fail(`--group phải là ID số.\n${USAGE}`);

let opened: Awaited<ReturnType<typeof openVerifiedProfile>> | undefined;
let exitCode = 0;
try {
  say({ event: 'start', label, group: groupId, name: groupName, note: 'gửi đúng MỘT yêu cầu tham gia' });
  try {
    opened = await openVerifiedProfile(label);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown';
    say({ event: 'dung', reason });
    process.exit(reason === 'identity_mismatch' ? 6 : 4);
  }
  say({ event: 'danh_tinh', status: 'match', identity: opened.baselineMasked });
  const { page } = opened;
  // Ghi lại nhãn các nút trên trang nhóm (không bấm) để đối chiếu giao diện thật.
  await page.goto(`https://www.facebook.com/groups/${groupId}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForTimeout(4_000);
  const buttons = await page.locator('[role="main"] [role="button"], [role="main"] button').evaluateAll((nodes) => nodes.map((node) => (node.getAttribute('aria-label') ?? node.textContent ?? '').trim().slice(0, 100)).filter(Boolean).slice(0, 40));
  say({ event: 'trang_nhom', path: new URL(page.url()).pathname.replace(/\d{6,}/gu, '<id>'), soNut: buttons.length, nutThamGia: JSON.stringify(buttons.filter((text) => /tham gia|join/i.test(text))) });

  if (flags.has('dump-only')) { say({ event: 'chi_doc', nutDau: JSON.stringify(buttons.slice(0, 12)), nutCoChuYeuCau: JSON.stringify(buttons.filter((text) => /yêu cầu|request|đã tham gia|joined/i.test(text))) }); process.exit(0); }
  // Danh tính đã được xác nhận bằng băm khi mở profile; đọc lại tham chiếu thô để bộ gửi so sánh.
  const { readIdentityRef } = await import('#browser');
  const identity = await readIdentityRef(page);
  if (!identity) fail('Không đọc được danh tính.', 6);

  let sends = 0;
  const profile = opened;
  const joiner = createGroupJoiner({ launch: async () => profile });
  const result = await joiner({
    profileDir: 'unused', expectedIdentity: identity, externalId: groupId, shouldCancel: () => false, onTick: () => undefined,
    beforeSend: () => { sends += 1; say({ event: 'truoc_khi_bam', lan: sends }); return sends === 1; },
  });
  opened = undefined; // bộ gửi đã đóng profile
  say({ event: 'ket_qua', status: result.status, reason: result.reason ?? 'none', daBam: result.clicked });
  mkdirSync(join(spikesDir(), 'evidence'), { recursive: true });
  writeFileSync(join(spikesDir(), 'evidence', `${label}-group-join.json`), JSON.stringify({ label, groupId, groupName, observedAt: new Date().toISOString(), pageButtons: buttons, result }, null, 2));
  if (result.status === 'failed' || result.status === 'unknown') exitCode = 1;
} catch (error) {
  const detail = error instanceof Error ? (error.message.split(/[\r\n]/u)[0] ?? '').replace(/https?:[^\s]+/gu, '<url>').slice(0, 160) : '';
  say({ event: 'loi', status: error instanceof Error ? error.name : 'unknown', detail });
  exitCode = 1;
} finally {
  await opened?.close();
}
process.exit(exitCode);
