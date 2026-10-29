/**
 * P06.3 — thử TÌM nhóm theo từ khóa trên Facebook thật (chỉ đọc: không bấm Tham gia, không đăng, không rời nhóm):
 *   node spikes/fb-groups-search.ts --label=<nhãn> --keyword="<từ khóa>" [--rounds=3] --confirm-real
 * Màn hình chỉ in số lượng và tên các trường đọc được; danh sách đầy đủ ghi vào <dataDir>/spikes/evidence (ngoài repo).
 * Kết quả luôn là MỘT PHẦN. Mục đích: biết cấu trúc trang tìm kiếm để viết bộ đọc cho ứng dụng.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getAppEnv } from '#config';
import { normalizeGroupReference } from '#domain';
import { createLogger } from '#logging';
import { openVerifiedProfile, sessionOf, spikesDir } from './fb-common.ts';

const log = createLogger({ env: 'development', name: 'spike-fb-groups-search' });
const USAGE = 'Dùng: node spikes/fb-groups-search.ts --label=<nhãn> --keyword="<từ khóa>" [--rounds=1..6] --confirm-real\nChỉ đọc kết quả tìm nhóm; mở Facebook thật bằng profile đã đăng nhập.';
function fail(message: string, code = 2): never {
  log.error({ code }, message);
  process.exit(code);
}
const say = (fields: Record<string, string | number | boolean>) => log.info(fields, String(fields.event));

const flags = new Map(process.argv.slice(2).map((arg) => {
  const [key = '', ...value] = arg.replace(/^--/u, '').split('=');
  return [key, value.join('=') || 'true'] as const;
}));
if (!flags.has('confirm-real')) fail(`Thiếu --confirm-real.\n${USAGE}`);
if (getAppEnv() === 'test') fail('Không chạy trong APM_ENV=test.');
const label = flags.get('label') ?? '';
if (!/^[a-z0-9_-]{1,30}$/u.test(label)) fail('--label không hợp lệ.');
const keyword = (flags.get('keyword') ?? '').trim();
if (keyword.length < 2 || keyword.length > 100) fail('--keyword phải từ 2 đến 100 ký tự.');
const rounds = Number(flags.get('rounds') ?? 3);
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 6) fail('--rounds phải từ 1 đến 6.');

interface Card { href: string; reference: string | null; name: string; lines: string[]; buttons: string[] }

let opened: Awaited<ReturnType<typeof openVerifiedProfile>> | undefined;
let exitCode = 0;
try {
  say({ event: 'start', label, keywordLength: keyword.length, rounds, note: 'chỉ đọc' });
  try {
    opened = await openVerifiedProfile(label);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown';
    say({ event: 'dung', reason });
    process.exit(reason === 'identity_mismatch' ? 6 : 4);
  }
  say({ event: 'danh_tinh', status: 'match', identity: opened.baselineMasked });
  const { page, context } = opened;
  await page.goto(`https://www.facebook.com/search/groups/?q=${encodeURIComponent(keyword)}`, { waitUntil: 'load', timeout: 45_000 });
  await page.waitForTimeout(4_000);
  say({ event: 'trang', path: new URL(page.url()).pathname, coMain: (await page.locator('[role="main"]').count()) > 0 });

  const cards = new Map<string, Card>();
  let stop = 'round_cap';
  for (let round = 0; round < rounds; round += 1) {
    if ((await sessionOf(context, page)) !== 'logged_in') { stop = 'session_lost'; break; }
    // Với mỗi liên kết tới /groups/<id>: đi lên tầng gần nhất có nút bấm (thẻ kết quả), lấy các dòng chữ và nhãn các nút. Chỉ đọc.
    const found = await page.locator('[role="main"] a[href*="/groups/"]').evaluateAll((nodes) => nodes.map((node) => {
      type El = { parentElement: El | null; textContent: string | null; getAttribute(name: string): string | null; querySelectorAll(selector: string): ArrayLike<El> };
      let box = node as unknown as El;
      for (let level = 0; level < 8 && box.parentElement; level += 1) {
        if (box.querySelectorAll('[role="button"], button').length > 0) break;
        box = box.parentElement;
      }
      const lines = Array.from(box.querySelectorAll('*')).filter((el) => el.querySelectorAll('*').length === 0).map((el) => (el.textContent ?? '').trim()).filter(Boolean).slice(0, 14);
      const buttons = Array.from(box.querySelectorAll('[role="button"], button')).map((button) => (button.getAttribute('aria-label') ?? button.textContent ?? '').trim()).filter(Boolean).slice(0, 6);
      return { href: node.getAttribute('href') ?? '', lines, buttons };
    }));
    const before = cards.size;
    for (const item of found) {
      const normalized = normalizeGroupReference(item.href.startsWith('/') ? `https://www.facebook.com${item.href}` : item.href);
      if (!normalized) continue;
      const key = normalized.canonicalUrl;
      const name = item.lines[0] ?? '';
      const current = cards.get(key);
      if (!current || item.lines.length > current.lines.length) cards.set(key, { href: item.href.slice(0, 200), reference: normalized.externalId, name, lines: item.lines, buttons: item.buttons });
    }
    say({ event: 'vong', round, soNhom: cards.size, moi: cards.size - before });
    if (round === rounds - 1) break;
    await page.mouse.wheel(0, 2_500);
    await page.waitForTimeout(2_000);
  }

  const results = [...cards.entries()].map(([url, card]) => ({ url, ...card }));
  const buttonLabels = new Map<string, number>();
  for (const card of results) for (const button of card.buttons) buttonLabels.set(button, (buttonLabels.get(button) ?? 0) + 1);
  say({ event: 'ket_thuc', status: 'partial', stop, soNhom: results.length, coIdSo: results.filter((card) => card.reference).length,
    nhanNut: JSON.stringify([...buttonLabels.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) });
  mkdirSync(join(spikesDir(), 'evidence'), { recursive: true });
  writeFileSync(join(spikesDir(), 'evidence', `${label}-group-search.json`), JSON.stringify({ label, keyword, stop, observedAt: new Date().toISOString(), complete: false, results }, null, 2));
  if (stop === 'session_lost') exitCode = 4;
} catch (error) {
  const detail = error instanceof Error ? (error.message.split(/[\r\n]/u)[0] ?? '').replace(/https?:[^\s]+/gu, '<url>').slice(0, 160) : '';
  say({ event: 'loi', status: error instanceof Error ? error.name : 'unknown', detail });
  exitCode = 1;
} finally {
  await opened?.close();
}
process.exit(exitCode);
