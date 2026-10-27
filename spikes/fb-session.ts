/**
 * P01.2 — thử thật, chỉ ĐỌC: mở profile riêng của app, người dùng tự đăng nhập, rồi xác nhận danh tính sau khi mở lại.
 * Không đăng bài, không đọc nhóm, không đọc/ghi mật khẩu hay giá trị cookie. Chạy thủ công, từng bước:
 *   node spikes/fb-session.ts login  --label=<nhãn> --confirm-real [--timeout-min=10]
 *   node spikes/fb-session.ts verify --label=<nhãn> --confirm-real
 * Dữ liệu (profile, bằng chứng) nằm ngoài repo, dưới <dataDir>/spikes/. Bằng chứng chỉ lưu băm danh tính.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { acquireProfileLock, classifySession, identityRefFromUrl, maskRef, refDigest, type PageSession } from '#browser';
import { getAppEnv, getDataDir } from '#config';
import { createLogger } from '#logging';

const log = createLogger({ env: 'development', name: 'spike-fb' });

const USAGE = `Dùng: node spikes/fb-session.ts <login|verify> --label=<nhãn a-z0-9_-> --confirm-real [--timeout-min=10]
Lệnh này MỞ FACEBOOK THẬT bằng profile riêng của app (chỉ đọc, không đăng). Bạn tự đăng nhập; công cụ không thấy mật khẩu.`;

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
if (command !== 'login' && command !== 'verify') fail(USAGE);
if (!flags.has('confirm-real')) fail(`Thiếu --confirm-real.\n${USAGE}`);
if (getAppEnv() === 'test') fail('Không chạy trong APM_ENV=test.');
const label = flags.get('label') ?? '';
if (!/^[a-z0-9_-]{1,30}$/u.test(label)) fail('--label phải gồm a-z, 0-9, _ hoặc - (tối đa 30 ký tự).');
const timeoutMin = Number(flags.get('timeout-min') ?? 10);
if (!Number.isInteger(timeoutMin) || timeoutMin < 1 || timeoutMin > 30) fail('--timeout-min phải từ 1 đến 30.');

const base = join(getDataDir(), 'spikes');
const profileDir = join(base, 'profiles', label);
const evidencePath = join(base, 'evidence', `${label}-identity.json`);
mkdirSync(profileDir, { recursive: true });
mkdirSync(join(base, 'evidence'), { recursive: true });

let lock: ReturnType<typeof acquireProfileLock>;
try {
  lock = acquireProfileLock(join(base, 'locks', `${label}.lock`));
} catch {
  fail('Profile này đang được tiến trình khác dùng. Đóng cửa sổ/tiến trình đó rồi chạy lại.', 3);
}

async function sessionOf(context: BrowserContext, page: Page): Promise<PageSession> {
  try {
    // Chỉ kiểm tra cookie phiên có tồn tại hay không, không đọc giá trị.
    const hasSessionCookie = (await context.cookies('https://www.facebook.com')).some((cookie) => cookie.name === 'c_user');
    const hasLoginForm = (await page.locator('input[name="email"], input[name="pass"]').count()) > 0;
    return classifySession({ url: page.url(), hasLoginForm, hasSessionCookie });
  } catch {
    return 'unknown'; // trang đang chuyển hướng
  }
}

/** Mở /me và đọc URL trang cá nhân sau khi chuyển hướng. */
async function readIdentity(page: Page): Promise<string | null> {
  await page.goto('https://www.facebook.com/me', { waitUntil: 'load', timeout: 45_000 });
  for (let i = 0; i < 4; i += 1) {
    const ref = identityRefFromUrl(page.url());
    if (ref) return ref;
    await page.waitForTimeout(2_000);
  }
  return null;
}

const context = await chromium.launchPersistentContext(profileDir, { channel: 'msedge', headless: false, viewport: null });
let closed = false;
context.on('close', () => { closed = true; });
const page = context.pages()[0] ?? await context.newPage();
let exitCode = 0;

try {
  say({ event: 'start', command, label, profile: 'riêng của app', note: 'chỉ đọc, không đăng' });
  if (command === 'login') {
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    say({ event: 'cho_dang_nhap', message: `Hãy tự đăng nhập trong cửa sổ vừa mở (tối đa ${timeoutMin} phút). Công cụ chỉ chờ, không thao tác.` });
    const deadline = Date.now() + timeoutMin * 60_000;
    let last: PageSession | '' = '';
    let state: PageSession = 'unknown';
    while (Date.now() < deadline && !closed) {
      state = await sessionOf(context, page);
      if (state !== last) say({ event: 'trang_thai', state });
      last = state;
      if (state === 'logged_in') break;
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
    if (closed) { say({ event: 'ket_thuc', status: 'window_closed' }); exitCode = 4; }
    else if (state !== 'logged_in') { say({ event: 'ket_thuc', status: state === 'verification_required' ? 'verification_required' : 'timeout' }); exitCode = 4; }
    else {
      const ref = await readIdentity(page);
      if (!ref) { say({ event: 'ket_thuc', status: 'identity_unreadable' }); exitCode = 5; }
      else {
        writeFileSync(evidencePath, JSON.stringify({ label, refDigest: refDigest(ref), masked: maskRef(ref), observedAt: new Date().toISOString() }, null, 2));
        say({ event: 'ket_thuc', status: 'da_luu_danh_tinh', identity: maskRef(ref), digest: refDigest(ref).slice(0, 8) });
      }
    }
  } else {
    let baseline: { refDigest: string; masked: string; observedAt: string } | undefined;
    try { baseline = JSON.parse(readFileSync(evidencePath, 'utf8')); } catch { /* chưa có */ }
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(2_000);
    const state = await sessionOf(context, page);
    if (state !== 'logged_in') { say({ event: 'ket_thuc', status: state === 'unknown' ? 'khong_ro' : state }); exitCode = 4; }
    else {
      const ref = await readIdentity(page);
      if (!ref) { say({ event: 'ket_thuc', status: 'identity_unreadable' }); exitCode = 5; }
      else if (!baseline) say({ event: 'ket_thuc', status: 'no_baseline', identity: maskRef(ref) });
      else if (baseline.refDigest === refDigest(ref)) say({ event: 'ket_thuc', status: 'match', identity: maskRef(ref), baselineAt: baseline.observedAt });
      else { say({ event: 'ket_thuc', status: 'MISMATCH', now: maskRef(ref), baseline: baseline.masked }); exitCode = 6; }
    }
  }
} catch (error) {
  say({ event: 'loi', status: error instanceof Error ? error.name : 'unknown' }); // không in thông điệp (có thể chứa URL)
  exitCode = 1;
} finally {
  if (!closed) await context.close().catch(() => undefined);
  lock.release();
}
process.exit(exitCode);
