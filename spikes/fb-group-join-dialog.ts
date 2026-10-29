/**
 * P06.3 — chụp CẤU TRÚC hộp thoại câu hỏi/đồng ý nội quy khi bấm "Tham gia nhóm" (không điền, không gửi):
 *   node spikes/fb-group-join-dialog.ts --label=<nhãn> --from-search [--max=3] --confirm-open-dialogs
 * Mỗi nhóm: mở trang nhóm, bấm đúng một lần "Tham gia nhóm", ghi cấu trúc hộp thoại (nhãn nút, ô nhập, ô tick, đoạn chữ), rồi ĐÓNG hộp thoại.
 * Tối đa `--max` lần bấm (cứng, mặc định 3, tối đa 3). Nhóm cho vào thẳng thì nick vào luôn (ghi lại). Không bấm "Gửi", không điền chữ.
 * Bằng chứng ghi vào <dataDir>/spikes/evidence (ngoài repo).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright-core';
import { JOIN_BUTTON, JOINED_BUTTON, REQUESTED_BUTTON, sessionOf } from '#browser';
import { getAppEnv } from '#config';
import { createLogger } from '#logging';
import { openVerifiedProfile, spikesDir } from './fb-common.ts';

const log = createLogger({ env: 'development', name: 'spike-fb-join-dialog' });
const USAGE = 'Dùng: node spikes/fb-group-join-dialog.ts --label=<nhãn> --from-search [--max=1..3] --confirm-open-dialogs';
function fail(message: string, code = 2): never {
  log.error({ code }, message);
  process.exit(code);
}
const say = (fields: Record<string, string | number | boolean>) => log.info(fields, String(fields.event));

const flags = new Map(process.argv.slice(2).map((arg) => {
  const [key = '', ...value] = arg.replace(/^--/u, '').split('=');
  return [key, value.join('=') || 'true'] as const;
}));
if (!flags.has('confirm-open-dialogs')) fail(`Thiếu --confirm-open-dialogs.\n${USAGE}`);
if (getAppEnv() === 'test') fail('Không chạy trong APM_ENV=test.');
const label = flags.get('label') ?? '';
if (!/^[a-z0-9_-]{1,30}$/u.test(label)) fail('--label không hợp lệ.');
const max = Number(flags.get('max') ?? 3);
if (!Number.isInteger(max) || max < 1 || max > 3) fail('--max phải từ 1 đến 3.');

const evidence = JSON.parse(readFileSync(join(spikesDir(), 'evidence', `${label}-group-search.json`), 'utf8')) as { results: Array<{ url: string; name: string; lines: string[] }> };
const joinedBefore = existsJoined();
function existsJoined(): Set<string> {
  try {
    const done = JSON.parse(readFileSync(join(spikesDir(), 'evidence', `${label}-group-join.json`), 'utf8')) as { groupId: string };
    return new Set([done.groupId]);
  } catch { return new Set(); }
}
const candidates = evidence.results
  .filter((card) => /\/groups\/\d{5,30}$/u.test(card.url) && card.lines.slice(1).some((line) => /^công khai\s*·/iu.test(line)))
  .map((card) => ({ id: card.url.split('/').pop() ?? '', name: card.name }))
  .filter((card) => !joinedBefore.has(card.id));
if (candidates.length === 0) fail('Không còn nhóm ứng viên.');

interface Captured { id: string; name: string; outcome: string; dialog?: unknown }

/** Cấu trúc hộp thoại: chỉ nhãn/loại điều khiển và các đoạn chữ ngắn; không điền gì. */
async function describeDialog(page: Page): Promise<unknown> {
  return page.locator('[role="dialog"]').first().evaluate((root) => {
    type El = { textContent: string | null; getAttribute(name: string): string | null; querySelectorAll(selector: string): ArrayLike<El>; tagName: string };
    const box = root as unknown as El;
    const list = (selector: string) => Array.from(box.querySelectorAll(selector));
    return {
      texts: list('*').filter((el) => el.querySelectorAll('*').length === 0).map((el) => (el.textContent ?? '').trim().slice(0, 200)).filter(Boolean).slice(0, 60),
      buttons: list('[role="button"], button').map((el) => (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 80)).filter(Boolean),
      checkboxes: list('[role="checkbox"], input[type="checkbox"]').map((el) => ({ label: (el.getAttribute('aria-label') ?? '').slice(0, 120), checked: el.getAttribute('aria-checked') ?? el.getAttribute('checked') })),
      radios: list('[role="radio"], input[type="radio"]').length,
      textInputs: list('textarea, input[type="text"], [role="textbox"], [contenteditable="true"]').map((el) => ({ tag: el.tagName, label: (el.getAttribute('aria-label') ?? el.getAttribute('placeholder') ?? '').slice(0, 120) })),
      selects: list('[role="combobox"], select').length,
    };
  });
}

async function closeDialog(page: Page): Promise<void> {
  const close = page.locator('[role="dialog"]').getByRole('button', { name: /^(đóng|close|hủy|cancel|để sau|not now)$/i });
  if (await close.count() > 0) await close.first().click({ timeout: 3000 }).catch(() => undefined);
  else await page.keyboard.press('Escape').catch(() => undefined);
  await page.waitForTimeout(800);
}

let opened: Awaited<ReturnType<typeof openVerifiedProfile>> | undefined;
let exitCode = 0;
const captured: Captured[] = [];
try {
  say({ event: 'start', label, toiDa: max, ungVien: candidates.length, note: 'chỉ chụp cấu trúc hộp thoại, không điền, không gửi' });
  try {
    opened = await openVerifiedProfile(label);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown';
    say({ event: 'dung', reason });
    process.exit(reason === 'identity_mismatch' ? 6 : 4);
  }
  say({ event: 'danh_tinh', status: 'match', identity: opened.baselineMasked });
  const { page, context } = opened;
  let clicks = 0;
  for (const group of candidates) {
    if (clicks >= max) break;
    await page.goto(`https://www.facebook.com/groups/${group.id}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(4_000);
    if ((await sessionOf(context, page)) !== 'logged_in') { say({ event: 'dung', reason: 'session_lost' }); exitCode = 4; break; }
    if (!(page.url().includes(`/groups/${group.id}`) || (await page.locator(`a[href*="/groups/${group.id}"]`).count()) > 0)) { captured.push({ ...group, outcome: 'wrong_group' }); continue; }
    if (await page.getByRole('button', { name: JOINED_BUTTON }).count() > 0 || await page.getByRole('button', { name: REQUESTED_BUTTON }).count() > 0) { captured.push({ ...group, outcome: 'already' }); continue; }
    const button = page.getByRole('button', { name: JOIN_BUTTON });
    if (await button.count() !== 1) { captured.push({ ...group, outcome: `nut_${await button.count()}` }); continue; }
    clicks += 1;
    say({ event: 'bam_tham_gia', lan: clicks });
    await button.first().click({ timeout: 10_000 });
    await page.waitForTimeout(3_500);
    const nowJoined = await page.getByRole('button', { name: JOINED_BUTTON }).count() > 0;
    const nowRequested = await page.getByRole('button', { name: REQUESTED_BUTTON }).count() > 0;
    const hasDialog = await page.locator('[role="dialog"]').count() > 0;
    const dialog = hasDialog ? await describeDialog(page) : undefined;
    const outcome = nowRequested ? (hasDialog ? 'requested_with_dialog' : 'requested') : nowJoined ? (hasDialog ? 'joined_with_dialog' : 'joined') : hasDialog ? 'dialog_only' : 'no_change';
    captured.push({ ...group, outcome, ...(dialog ? { dialog } : {}) });
    const summary = dialog as { buttons?: string[]; checkboxes?: unknown[]; radios?: number; textInputs?: unknown[]; selects?: number } | undefined;
    say({ event: 'ket_qua_nhom', outcome, ...(summary ? { nut: JSON.stringify(summary.buttons ?? []), oTick: summary.checkboxes?.length ?? 0, oChon: summary.radios ?? 0, oChu: summary.textInputs?.length ?? 0, hopChon: summary.selects ?? 0 } : {}) });
    if (hasDialog) await closeDialog(page); // KHÔNG bấm Gửi, KHÔNG điền
    if (clicks < max) await page.waitForTimeout(25_000 + Math.floor(Math.random() * 20_000));
  }
  mkdirSync(join(spikesDir(), 'evidence'), { recursive: true });
  writeFileSync(join(spikesDir(), 'evidence', `${label}-group-join-dialogs.json`), JSON.stringify({ label, observedAt: new Date().toISOString(), clicks, captured }, null, 2));
  say({ event: 'ket_thuc', soLanBam: clicks, ketQua: JSON.stringify(captured.map((item) => item.outcome)) });
} catch (error) {
  const detail = error instanceof Error ? (error.message.split(/[\r\n]/u)[0] ?? '').replace(/https?:[^\s]+/gu, '<url>').slice(0, 160) : '';
  say({ event: 'loi', status: error instanceof Error ? error.name : 'unknown', detail });
  exitCode = 1;
} finally {
  await opened?.close();
}
process.exit(exitCode);
