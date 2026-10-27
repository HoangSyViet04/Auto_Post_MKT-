/**
 * P01.6 — thử đọc danh sách nhóm ĐÃ THAM GIA của một nick (chỉ đọc, không bấm, không đăng, không tham gia/rời nhóm):
 *   node spikes/fb-groups-read.ts joined --label=<nhãn> [--limit=50] [--expect-group=<ID số>] --confirm-real
 * Màn hình chỉ in số lượng và trường đọc được; danh sách đầy đủ ghi vào <dataDir>/spikes/evidence (ngoài repo).
 * Kết quả luôn là MỘT PHẦN: không khẳng định đã đọc hết mọi nhóm của nick.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright-core';
import { normalizeGroupReference } from '#domain';
import { getAppEnv } from '#config';
import { createLogger } from '#logging';
import { openVerifiedProfile, sessionOf, spikesDir } from './fb-common.ts';

const log = createLogger({ env: 'development', name: 'spike-fb-groups' });
const USAGE = 'Dùng: node spikes/fb-groups-read.ts joined --label=<nhãn> [--limit=1..200] [--expect-group=<ID số>] --confirm-real\nChỉ đọc danh sách nhóm đã tham gia; mở Facebook thật bằng profile đã đăng nhập.';
function fail(message: string, code = 2): never {
  log.error({ code }, message);
  process.exit(code);
}
const say = (fields: Record<string, string | number | boolean>) => log.info(fields, String(fields.event));

const [command, ...rest] = process.argv.slice(2);
const flags = new Map(rest.map((arg) => {
  const [key = '', ...value] = arg.replace(/^--/u, '').split('=');
  return [key, value.join('=') || 'true'] as const;
}));
if (command !== 'joined') fail(USAGE);
if (!flags.has('confirm-real')) fail(`Thiếu --confirm-real.\n${USAGE}`);
if (getAppEnv() === 'test') fail('Không chạy trong APM_ENV=test.');
const label = flags.get('label') ?? '';
if (!/^[a-z0-9_-]{1,30}$/u.test(label)) fail('--label không hợp lệ.');
const limit = Number(flags.get('limit') ?? 50);
if (!Number.isInteger(limit) || limit < 1 || limit > 200) fail('--limit phải từ 1 đến 200.');
const expectGroup = flags.get('expect-group');
if (expectGroup !== undefined && !/^\d{10,25}$/u.test(expectGroup)) fail('--expect-group phải là ID số.');

interface Seen { canonicalUrl: string; externalId: string | null; name: string }

/** Lấy liên kết nhóm đang hiển thị; chuẩn hóa ở phía Node để dùng chung quy tắc với phần còn lại. */
async function collect(page: Page, into: Map<string, Seen>): Promise<void> {
  const anchors = await page.locator('[role="main"] a[href*="/groups/"]').evaluateAll((nodes) => nodes.map((node) => ({
    href: node.getAttribute('href') ?? '',
    text: (node.textContent ?? '').trim().slice(0, 120),
  })));
  for (const anchor of anchors) {
    const normalized = normalizeGroupReference(anchor.href.startsWith('/') ? `https://www.facebook.com${anchor.href}` : anchor.href);
    if (!normalized) continue;
    const name = anchor.text.split(/[\r\n]/u)[0] ?? '';
    const current = into.get(normalized.canonicalUrl);
    // Nhiều liên kết cho cùng một nhóm (ảnh, tên): giữ tên dài nhất.
    if (!current) into.set(normalized.canonicalUrl, { canonicalUrl: normalized.canonicalUrl, externalId: normalized.externalId, name });
    else if (name.length > current.name.length) current.name = name;
  }
}

let opened: Awaited<ReturnType<typeof openVerifiedProfile>> | undefined;
let exitCode = 0;
try {
  say({ event: 'start', command, label, limit, note: 'chỉ đọc' });
  try {
    opened = await openVerifiedProfile(label);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown';
    say({ event: 'dung', reason: reason === 'profile_in_use' ? 'profile_dang_duoc_dung' : reason });
    process.exit(reason === 'identity_mismatch' ? 6 : 4);
  }
  say({ event: 'danh_tinh', status: 'match', identity: opened.baselineMasked });
  const { page, context } = opened;
  await page.goto('https://www.facebook.com/groups/joins/', { waitUntil: 'load', timeout: 45_000 });
  await page.waitForTimeout(4_000);

  const seen = new Map<string, Seen>();
  let stop: 'limit_reached' | 'no_more_results_seen' | 'session_lost' | 'round_cap' = 'round_cap';
  let idleRounds = 0;
  let rounds = 0;
  for (; rounds < 40; rounds += 1) {
    if ((await sessionOf(context, page)) !== 'logged_in') { stop = 'session_lost'; break; }
    const before = seen.size;
    await collect(page, seen);
    if (seen.size >= limit) { stop = 'limit_reached'; break; }
    idleRounds = seen.size === before ? idleRounds + 1 : 0;
    if (idleRounds >= 3) { stop = 'no_more_results_seen'; break; }
    await page.mouse.wheel(0, 2_500);
    await page.waitForTimeout(1_800);
  }

  const results = [...seen.values()].slice(0, limit);
  const withName = results.filter((item) => item.name).length;
  const withId = results.filter((item) => item.externalId).length;
  const known = expectGroup ? results.some((item) => item.externalId === expectGroup) : null;
  say({ event: 'ket_thuc', status: 'partial', stop, rounds, soNhom: results.length, coTen: withName, coIdSo: withId, chiCoTenRutGon: results.length - withId, ...(known === null ? {} : { chuaNhomDaBiet: known }) });
  mkdirSync(join(spikesDir(), 'evidence'), { recursive: true });
  writeFileSync(join(spikesDir(), 'evidence', `${label}-joined-groups.json`), JSON.stringify({ label, stop, observedAt: new Date().toISOString(), complete: false, results }, null, 2));
  if (stop === 'session_lost') exitCode = 4;
} catch (error) {
  const detail = error instanceof Error ? (error.message.split(/[\r\n]/u)[0] ?? '').replace(/https?:[^\s]+/gu, '<url>').slice(0, 160) : '';
  say({ event: 'loi', status: error instanceof Error ? error.name : 'unknown', detail });
  exitCode = 1;
} finally {
  await opened?.close();
}
process.exit(exitCode);
