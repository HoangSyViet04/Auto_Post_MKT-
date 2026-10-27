/**
 * P01.4 — thử đăng lên TRANG CÁ NHÂN của chính nick đã đăng nhập (chỉ chữ, một bài):
 *   node spikes/fb-profile-post.ts post --label=<nhãn> --confirm-post [--expect-audience=<đối tượng>] [--dry-run]
 * An toàn: công cụ ĐỌC đối tượng của bài trong hộp soạn thảo và chỉ đăng khi khớp --expect-audience
 * (mặc định "Chỉ mình tôi"/"Only me"). Không đọc được hoặc khác → dừng, không đăng. Không tự đổi quyền riêng tư.
 * --dry-run: soạn xong dừng, không bấm Đăng. Không có --dry-run: bấm Đăng ĐÚNG MỘT LẦN, không tự thử lại.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getAppEnv } from '#config';
import { createLogger } from '#logging';
import { openVerifiedProfile, spikesDir } from './fb-common.ts';

const log = createLogger({ env: 'development', name: 'spike-fb-profile' });
const USAGE = 'Dùng: node spikes/fb-profile-post.ts post --label=<nhãn> --confirm-post [--expect-audience="Chỉ mình tôi"] [--dry-run]\nĐăng bài thử THẬT lên trang cá nhân (trừ khi --dry-run).';
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
if (command !== 'post') fail(USAGE);
if (!flags.has('confirm-post')) fail(`Thiếu --confirm-post.\n${USAGE}`);
if (getAppEnv() === 'test') fail('Không chạy trong APM_ENV=test.');
const label = flags.get('label') ?? '';
if (!/^[a-z0-9_-]{1,30}$/u.test(label)) fail('--label không hợp lệ.');
const dryRun = flags.has('dry-run');
const expectAudience = (flags.get('expect-audience') ?? 'Chỉ mình tôi').trim();
if (expectAudience.length < 3 || expectAudience.length > 60) fail('--expect-audience không hợp lệ.');
const matchesExpected = (text: string): boolean => {
  const wanted = expectAudience.toLowerCase();
  const have = text.toLowerCase();
  // "Chỉ mình tôi" tương đương "Only me" khi giao diện tiếng Anh.
  return have.includes(wanted) || (wanted === 'chỉ mình tôi' && have.includes('only me'));
};

const COMPOSER = /bạn đang nghĩ gì|viết gì đi|what'?s on your mind|write something/i; // Playwright không nhận cờ u khi dựng selector
const POST_BUTTON = /^(đăng|post)$/i;
const AUDIENCE_BUTTON = /quyền riêng tư|đối tượng|privacy|audience/i;

let opened: Awaited<ReturnType<typeof openVerifiedProfile>> | undefined;
let exitCode = 0;
try {
  say({ event: 'start', command, label, dryRun, doiTuongMongDoi: expectAudience });
  try {
    opened = await openVerifiedProfile(label);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown';
    say({ event: 'dung', reason: reason === 'profile_in_use' ? 'profile_dang_duoc_dung' : reason });
    process.exit(reason === 'identity_mismatch' ? 6 : 4);
  }
  say({ event: 'danh_tinh', status: 'match', identity: opened.baselineMasked });
  const { page } = opened;
  await page.goto('https://www.facebook.com/me', { waitUntil: 'load', timeout: 45_000 });
  await page.waitForTimeout(4_000);

  const composers = page.getByRole('button', { name: COMPOSER });
  const count = await composers.count();
  say({ event: 'o_soan_bai', soLuongKhop: count });
  if (count !== 1) { say({ event: 'ket_thuc', status: count === 0 ? 'composer_not_found' : 'composer_ambiguous' }); exitCode = 7; }
  else {
    const marker = `APM-TEST-${new Date().toISOString().replace(/\D/gu, '').slice(0, 14)}`;
    const caption = `[${marker}] Bài thử nghiệm của ứng dụng trên trang cá nhân, sẽ được xóa.`;
    await composers.first().click();
    const dialogs = page.getByRole('dialog').filter({ has: page.getByRole('textbox') });
    await dialogs.first().waitFor({ state: 'visible', timeout: 20_000 });
    const dialog = dialogs.first();
    const box = dialog.getByRole('textbox');
    const audienceButtons = dialog.getByRole('button', { name: AUDIENCE_BUTTON });
    const audienceCount = await audienceButtons.count();
    say({ event: 'hop_thoai', soHopThoai: await dialogs.count(), soOVanBan: await box.count(), soNutDoiTuong: audienceCount });
    if ((await dialogs.count()) !== 1 || (await box.count()) !== 1 || audienceCount !== 1) {
      say({ event: 'ket_thuc', status: 'dialog_ambiguous' }); exitCode = 7;
    } else {
      const audienceText = `${(await audienceButtons.first().getAttribute('aria-label')) ?? ''} ${(await audienceButtons.first().textContent()) ?? ''}`.trim();
      const audienceOk = matchesExpected(audienceText);
      say({ event: 'doi_tuong', nhanDoc: audienceText.slice(0, 120), khop: audienceOk });
      if (!audienceOk) { say({ event: 'ket_thuc', status: 'doi_tuong_khong_khop_khong_dang' }); exitCode = 8; }
      else {
        await box.first().click();
        await page.keyboard.insertText(caption);
        const typed = ((await box.first().textContent()) ?? '').includes(marker);
        const submit = dialog.getByRole('button', { name: POST_BUTTON });
        const submitCount = await submit.count();
        const enabled = submitCount === 1 ? await submit.first().isEnabled() : false;
        say({ event: 'san_sang', daGoChu: typed, soNutDang: submitCount, nutBat: enabled });
        if (!typed || submitCount !== 1 || !enabled) { say({ event: 'ket_thuc', status: 'khong_san_sang_de_dang' }); exitCode = 7; }
        else if (dryRun) say({ event: 'ket_thuc', status: 'dry_run_xong_khong_dang', marker });
        else {
          await submit.first().click(); // ĐÚNG MỘT LẦN — không bao giờ bấm lại
          say({ event: 'da_bam_dang', marker });
          const closed = await dialog.waitFor({ state: 'hidden', timeout: 60_000 }).then(() => true, () => false);
          await page.goto('https://www.facebook.com/me', { waitUntil: 'load', timeout: 45_000 });
          await page.waitForTimeout(5_000);
          let scrolls = 0;
          while ((await page.getByText(marker).count()) === 0 && scrolls < 5) {
            await page.mouse.wheel(0, 1_500);
            await page.waitForTimeout(2_000);
            scrolls += 1;
          }
          const found = (await page.getByText(marker).count()) > 0;
          const status = found ? 'published' : 'unknown'; // không thấy thì không đoán; người dùng đối chiếu bằng mắt
          say({ event: 'ket_thuc', status, hopThoaiDong: closed, cuon: scrolls, marker });
          mkdirSync(join(spikesDir(), 'evidence'), { recursive: true });
          writeFileSync(join(spikesDir(), 'evidence', `profile-post-${marker}.json`), JSON.stringify({ marker, status, audience: audienceText.slice(0, 120), observedAt: new Date().toISOString() }, null, 2));
          if (status === 'unknown') exitCode = 9;
        }
      }
    }
  }
} catch (error) {
  const detail = error instanceof Error ? (error.message.split(/[\r\n]/u)[0] ?? '').replace(/https?:[^\s]+/gu, '<url>').slice(0, 160) : '';
  say({ event: 'loi', status: error instanceof Error ? error.name : 'unknown', detail });
  exitCode = 1;
} finally {
  await opened?.close();
}
process.exit(exitCode);
