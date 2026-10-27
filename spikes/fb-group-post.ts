/**
 * P01.5 — thử đăng vào MỘT group do người dùng chỉ định, từng bước, chủ động:
 *   node spikes/fb-group-post.ts prepare --label=<nhãn> --group=<ID số> --confirm-real
 *     Chỉ đọc: đúng nick (so băm danh tính), đúng nhóm, tìm ô soạn bài. Không gõ, không gửi.
 *   node spikes/fb-group-post.ts post --label=<nhãn> --group=<ID số> --mode=text|media --expect-title="<tên nhóm>" --confirm-post [--dry-run]
 *     Soạn bài thử. --dry-run: soạn xong DỪNG, không bấm Đăng. Không có --dry-run: bấm Đăng ĐÚNG MỘT LẦN, không tự thử lại.
 * Bằng chứng nằm ngoài repo (<dataDir>/spikes). Không lưu cookie/mật khẩu; log không chứa URL hay nội dung trang.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type BrowserContext, type Locator, type Page } from 'playwright-core';
import sharp from 'sharp';
import { acquireProfileLock, classifySession, identityRefFromUrl, maskRef, refDigest, type PageSession } from '#browser';
import { getAppEnv, getDataDir } from '#config';
import { createLogger } from '#logging';

const log = createLogger({ env: 'development', name: 'spike-fb-group' });
const USAGE = `Dùng:
  node spikes/fb-group-post.ts prepare --label=<nhãn> --group=<ID số> --confirm-real
  node spikes/fb-group-post.ts post --label=<nhãn> --group=<ID số> --mode=text|media --expect-title="<tên nhóm>" --confirm-post [--dry-run]
Lệnh MỞ FACEBOOK THẬT bằng profile riêng đã đăng nhập. post không có --dry-run sẽ ĐĂNG BÀI THẬT một lần.`;

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
if (command !== 'prepare' && command !== 'post') fail(USAGE);
if (getAppEnv() === 'test') fail('Không chạy trong APM_ENV=test.');
const label = flags.get('label') ?? '';
if (!/^[a-z0-9_-]{1,30}$/u.test(label)) fail('--label không hợp lệ.');
const groupId = flags.get('group') ?? '';
if (!/^\d{10,25}$/u.test(groupId)) fail('--group phải là ID số của nhóm.');
if (command === 'prepare' && !flags.has('confirm-real')) fail(`Thiếu --confirm-real.\n${USAGE}`);
const dryRun = flags.has('dry-run');
const mode = flags.get('mode') ?? '';
const expectTitle = (flags.get('expect-title') ?? '').trim();
if (command === 'post') {
  if (!flags.has('confirm-post')) fail(`Thiếu --confirm-post.\n${USAGE}`);
  if (mode !== 'text' && mode !== 'media') fail('--mode phải là text hoặc media.');
  if (expectTitle.length < 4) fail('Thiếu --expect-title (tên nhóm mong đợi, tối thiểu 4 ký tự).');
}

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

/** Ô "Bạn viết gì đi…" / "Write something…" — nhận diện theo tên truy cập, không theo class CSS. */
const COMPOSER = /viết gì đi|bạn đang nghĩ gì|write something|what'?s on your mind/i; // Playwright không nhận cờ u khi dựng selector
const POST_BUTTON = /^(đăng|post)$/i;
const PHOTO_BUTTON = /ảnh\/video|photo\/video|ảnh|photo/i;
const PENDING_TEXT = /đang chờ|chờ phê duyệt|chờ duyệt|pending/i;

const firstLine = (text: string) => text.slice(0, text.search(/[\r\n]/u) === -1 ? text.length : text.search(/[\r\n]/u));

/** Hai ảnh nhỏ do công cụ tự tạo, không dùng ảnh của người dùng. */
async function makeImages(): Promise<string[]> {
  const dir = join(base, 'tmp');
  mkdirSync(dir, { recursive: true });
  const paths: string[] = [];
  for (const [index, color] of ['#2563eb', '#dc2626'].entries()) {
    const path = join(dir, `apm-test-${index + 1}.png`);
    writeFileSync(path, await sharp({ create: { width: 640, height: 480, channels: 3, background: color } }).png().toBuffer());
    paths.push(path);
  }
  return paths;
}

/** Tìm bài có dấu vết duy nhất trong feed nhóm; trả ID bài nếu đọc được. */
/** Đếm ảnh nội dung (bỏ icon/avatar nhỏ). */
const bigImages = (scope: Locator): Promise<number> => scope.locator('img').evaluateAll((nodes) => nodes.filter((node) => (node as unknown as { naturalWidth: number }).naturalWidth >= 150).length);

async function findPost(page: Page, marker: string): Promise<{ found: boolean; postId: string | null; pendingNotice: boolean; images: number }> {
  await page.goto(`https://www.facebook.com/groups/${groupId}`, { waitUntil: 'load', timeout: 45_000 });
  await page.waitForTimeout(6_000);
  const pendingNotice = (await page.getByText(PENDING_TEXT).count()) > 0;
  const article = page.locator('[role="article"]').filter({ hasText: marker }).first();
  if ((await article.count()) === 0) return { found: false, postId: null, pendingNotice, images: 0 };
  const hrefs = await article.locator('a[href*="/posts/"], a[href*="/permalink/"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href') ?? ''));
  const match = hrefs.map((href) => /\/(?:posts|permalink)\/(\d{6,25})/u.exec(href)?.[1]).find(Boolean);
  return { found: true, postId: match ?? null, pendingNotice, images: await bigImages(article) };
}

const context = await chromium.launchPersistentContext(join(base, 'profiles', label), { channel: 'msedge', headless: false, viewport: null });
const page = context.pages()[0] ?? await context.newPage();
let exitCode = 0;
try {
  say({ event: 'start', command, label, group: groupId, mode: command === 'post' ? mode : 'doc', dryRun: command === 'post' ? dryRun : true });
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
      const title = await page.title();
      const onGroup = new URL(page.url()).pathname.toLowerCase().includes('/groups/');
      say({ event: 'trang_nhom', session: after, onGroupPage: onGroup, title: title.slice(0, 80) });
      if (after !== 'logged_in' || !onGroup) { say({ event: 'dung', reason: 'khong_vao_duoc_nhom' }); exitCode = 5; }
      else if (command === 'post' && !title.toLowerCase().includes(expectTitle.toLowerCase())) {
        say({ event: 'dung', reason: 'sai_ten_nhom', mongDoi: expectTitle.slice(0, 60) }); // không đăng vào nhóm không khớp tên
        exitCode = 8;
      } else {
        const composers: Locator = page.getByRole('button', { name: COMPOSER });
        const count = await composers.count();
        say({ event: 'o_soan_bai', soLuongKhop: count });
        if (count !== 1) { say({ event: 'ket_thuc', status: count === 0 ? 'composer_not_found' : 'composer_ambiguous' }); exitCode = 7; }
        else if (command === 'prepare') say({ event: 'ket_thuc', status: 'composer_found', visible: await composers.first().isVisible() });
        else {
          const marker = `APM-TEST-${new Date().toISOString().replace(/\D/gu, '').slice(0, 14)}`;
          const caption = `[${marker}] Bài thử nghiệm của ứng dụng, sẽ được xóa.`;
          await composers.first().click();
          const dialogs = page.getByRole('dialog').filter({ has: page.getByRole('textbox') });
          await dialogs.first().waitFor({ state: 'visible', timeout: 20_000 });
          const dialogCount = await dialogs.count();
          const box = dialogs.first().getByRole('textbox');
          say({ event: 'hop_thoai', soHopThoai: dialogCount, soOVanBan: await box.count() });
          if (dialogCount !== 1 || (await box.count()) !== 1) { say({ event: 'ket_thuc', status: 'dialog_ambiguous' }); exitCode = 7; }
          else {
            await box.first().click();
            await page.keyboard.insertText(caption);
            const typed = ((await box.first().textContent()) ?? '').includes(marker);
            say({ event: 'da_go_chu', khop: typed });
            let attached = 0;
            if (typed && mode === 'media') {
              const files = await makeImages();
              const inputs = dialogs.first().locator('input[type="file"]');
              if ((await inputs.count()) === 0) {
                const chooser = page.waitForEvent('filechooser', { timeout: 15_000 });
                await dialogs.first().getByRole('button', { name: PHOTO_BUTTON }).first().click();
                await (await chooser).setFiles(files);
              } else await inputs.first().setInputFiles(files);
              await page.waitForTimeout(6_000);
              attached = await bigImages(dialogs.first());
              say({ event: 'da_dinh_kem', anhTrongHopThoai: attached });
            }
            const submit = dialogs.first().getByRole('button', { name: POST_BUTTON });
            const submitCount = await submit.count();
            const enabled = submitCount === 1 ? await submit.first().isEnabled() : false;
            say({ event: 'nut_dang', soNut: submitCount, bat: enabled });
            if (!typed || submitCount !== 1 || !enabled) { say({ event: 'ket_thuc', status: 'khong_san_sang_de_dang' }); exitCode = 7; }
            else if (dryRun) say({ event: 'ket_thuc', status: 'dry_run_xong_khong_dang', marker });
            else {
              await submit.first().click(); // ĐÚNG MỘT LẦN — không bao giờ bấm lại
              say({ event: 'da_bam_dang', marker });
              const closed = await dialogs.first().waitFor({ state: 'hidden', timeout: 60_000 }).then(() => true, () => false);
              const seen = await findPost(page, marker);
              const status = seen.found ? 'published' : seen.pendingNotice ? 'pending_approval' : 'unknown';
              say({ event: 'ket_thuc', status, hopThoaiDong: closed, postId: seen.postId ?? 'khong_doc_duoc', anhTrongBai: seen.images, marker });
              mkdirSync(join(base, 'evidence'), { recursive: true });
              writeFileSync(join(base, 'evidence', `group-post-${marker}.json`), JSON.stringify({ marker, mode, status, postId: seen.postId, images: seen.images, groupId, observedAt: new Date().toISOString() }, null, 2));
              if (status === 'unknown') exitCode = 9;
            }
          }
        }
      }
    }
  }
} catch (error) {
  // Chỉ dòng đầu của thông báo, đã thay URL, để chẩn đoán mà không lộ địa chỉ trang.
  const detail = error instanceof Error ? firstLine(error.message).replace(/https?:[^\s]+/gu, '<url>').slice(0, 160) : '';
  say({ event: 'loi', status: error instanceof Error ? error.name : 'unknown', detail });
  exitCode = 1;
} finally {
  await context.close().catch(() => undefined);
  lock.release();
}
process.exit(exitCode);
