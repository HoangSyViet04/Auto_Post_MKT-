/**
 * P01.5 — thử đăng vào MỘT group do người dùng chỉ định, từng bước, chủ động:
 *   node spikes/fb-group-post.ts prepare --label=<nhãn> --group=<ID số> --confirm-real
 *     Chỉ đọc: kiểm tra đúng nick (so băm danh tính), đúng nhóm, tìm ô soạn bài. Không gõ, không bấm gửi.
 * Bằng chứng nằm ngoài repo (<dataDir>/spikes). Không lưu cookie/mật khẩu; log không chứa URL hay nội dung trang.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type BrowserContext, type Locator, type Page } from 'playwright-core';
import { acquireProfileLock, classifySession, identityRefFromUrl, maskRef, refDigest, type PageSession } from '#browser';
import { getAppEnv, getDataDir } from '#config';
import { createLogger } from '#logging';

const log = createLogger({ env: 'development', name: 'spike-fb-group' });
const USAGE = `Dùng: node spikes/fb-group-post.ts prepare --label=<nhãn> --group=<ID số của nhóm> --confirm-real
Lệnh MỞ FACEBOOK THẬT bằng profile riêng đã đăng nhập (spike:fb login). prepare chỉ đọc, không đăng.`;

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
if (command !== 'prepare') fail(USAGE);
if (!flags.has('confirm-real')) fail(`Thiếu --confirm-real.\n${USAGE}`);
if (getAppEnv() === 'test') fail('Không chạy trong APM_ENV=test.');
const label = flags.get('label') ?? '';
if (!/^[a-z0-9_-]{1,30}$/u.test(label)) fail('--label không hợp lệ.');
const groupId = flags.get('group') ?? '';
if (!/^\d{10,25}$/u.test(groupId)) fail('--group phải là ID số của nhóm.');

const base = join(getDataDir(), 'spikes');
let baseline: { refDigest: string; masked: string };
try {
  baseline = JSON.parse(readFileSync(join(base, 'evidence', `${label}-identity.json`), 'utf8'));
} catch {
  fail('Chưa có danh tính đã lưu cho nhãn này. Chạy spike:fb login trước.', 3);
}

let lock: ReturnType<typeof acquireProfileLock>;
try {
  lock = acquireProfileLock(join(base, 'locks', `${label}.lock`));
} catch {
  fail('Profile đang được tiến trình khác dùng.', 3);
}

async function sessionOf(context: BrowserContext, page: Page): Promise<PageSession> {
  try {
    const hasSessionCookie = (await context.cookies('https://www.facebook.com')).some((cookie) => cookie.name === 'c_user');
    const hasLoginForm = (await page.locator('input[name="email"], input[name="pass"]').count()) > 0;
    return classifySession({ url: page.url(), hasLoginForm, hasSessionCookie });
  } catch {
    return 'unknown';
  }
}

async function readIdentity(page: Page): Promise<string | null> {
  await page.goto('https://www.facebook.com/me', { waitUntil: 'load', timeout: 45_000 });
  for (let i = 0; i < 4; i += 1) {
    const ref = identityRefFromUrl(page.url());
    if (ref) return ref;
    await page.waitForTimeout(2_000);
  }
  return null;
}

/** Ô "Bạn viết gì đi…" / "Write something…" — nhận diện theo tên truy cập được, không theo class CSS. */
const COMPOSER = /viết gì đi|bạn đang nghĩ gì|write something|what'?s on your mind/i; // Playwright không nhận cờ u khi dựng selector

const context = await chromium.launchPersistentContext(join(base, 'profiles', label), { channel: 'msedge', headless: false, viewport: null });
const page = context.pages()[0] ?? await context.newPage();
let exitCode = 0;
try {
  say({ event: 'start', command, label, group: groupId, note: 'chỉ đọc, không gõ, không đăng' });
  await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForTimeout(2_000);
  const state = await sessionOf(context, page);
  if (state !== 'logged_in') { say({ event: 'dung', reason: state === 'unknown' ? 'khong_ro_phien' : state }); exitCode = 4; }
  else {
    const ref = await readIdentity(page);
    if (!ref || refDigest(ref) !== baseline.refDigest) { say({ event: 'dung', reason: 'identity_mismatch', now: ref ? maskRef(ref) : 'khong_doc_duoc', baseline: baseline.masked }); exitCode = 6; }
    else {
      say({ event: 'danh_tinh', status: 'match', identity: baseline.masked });
      await page.goto(`https://www.facebook.com/groups/${groupId}`, { waitUntil: 'load', timeout: 45_000 });
      await page.waitForTimeout(4_000);
      const after = await sessionOf(context, page);
      const onGroup = new URL(page.url()).pathname.toLowerCase().includes('/groups/');
      say({ event: 'trang_nhom', session: after, onGroupPage: onGroup, title: (await page.title()).slice(0, 80) });
      if (after !== 'logged_in' || !onGroup) { say({ event: 'dung', reason: 'khong_vao_duoc_nhom' }); exitCode = 5; }
      else {
        const found: Locator = page.getByRole('button', { name: COMPOSER });
        const count = await found.count();
        say({ event: 'o_soan_bai', soLuongKhop: count });
        if (count === 1) say({ event: 'ket_thuc', status: 'composer_found', visible: await found.first().isVisible() });
        else {
          // Không rõ ô nào: dừng, không bấm. Liệt kê tên các nút nhìn thấy (rút gọn) để chọn cách nhận diện đúng.
          const names = await page.getByRole('button').evaluateAll((nodes) => nodes
            .map((node) => (node.getAttribute('aria-label') ?? node.textContent ?? '').trim().slice(0, 40)).filter(Boolean).slice(0, 25));
          say({ event: 'ket_thuc', status: count === 0 ? 'composer_not_found' : 'composer_ambiguous', nutNhinThay: names.join(' | ') });
          exitCode = 7;
        }
      }
    }
  }
} catch (error) {
  // Chỉ dòng đầu của thông báo, đã thay URL, để chẩn đoán mà không lộ địa chỉ trang.
  const firstLine = (text: string) => text.slice(0, text.search(/[\r\n]/u) === -1 ? text.length : text.search(/[\r\n]/u));
  const detail = error instanceof Error ? firstLine(error.message).replace(/https?:[^\s]+/gu, '<url>').slice(0, 160) : '';
  say({ event: 'loi', status: error instanceof Error ? error.name : 'unknown', detail });
  exitCode = 1;
} finally {
  await context.close().catch(() => undefined);
  lock.release();
}
process.exit(exitCode);
