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
if (command !== 'post' && command !== 'find') fail(USAGE);
if (command === 'post' && !flags.has('confirm-post')) fail(`Thiếu --confirm-post.\n${USAGE}`);
const findMarker = flags.get('marker') ?? '';
if (command === 'find' && (!flags.has('confirm-real') || !/^APM-TEST-\d{14}$/u.test(findMarker))) {
  fail('Dùng: node spikes/fb-profile-post.ts find --label=<nhãn> --marker=APM-TEST-<14 số> --confirm-real (chỉ đọc)');
}
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
  if (command === 'find') {
    // Chỉ đọc: tìm lại một bài thử theo dấu vết (cuộn tối đa 8 lần).
    let scrolls = 0;
    while ((await page.getByText(findMarker).count()) === 0 && scrolls < 8) {
      await page.mouse.wheel(0, 1_500);
      await page.waitForTimeout(2_000);
      scrolls += 1;
    }
    say({ event: 'ket_thuc', status: (await page.getByText(findMarker).count()) > 0 ? 'published' : 'unknown', cuon: scrolls });
    await opened.close();
    process.exit(0);
  }

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
        // Trang cá nhân có hai bước: soạn → "Tiếp" → "Đăng". "Tiếp" không đăng gì nên được phép bấm (một lần).
        const next = dialog.getByRole('button', { name: /^(tiếp|next)$/i });
        const nextCount = await next.count();
        let step = dialog;
        if (typed && nextCount === 1 && (await dialog.getByRole('button', { name: POST_BUTTON }).count()) === 0) {
          for (let i = 0; i < 16 && !(await next.first().isEnabled()); i += 1) await page.waitForTimeout(500);
          await next.first().click();
          await page.waitForTimeout(3_000);
          // Bước hai là hộp thoại có nút Đăng; kiểm lại đối tượng ở đây trước khi đăng.
          step = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: POST_BUTTON }) });
          say({ event: 'buoc_hai', soHopThoai: await step.count() });
        }
        const submit = step.getByRole('button', { name: POST_BUTTON });
        const submitCount = (await step.count()) === 1 ? await submit.count() : 0;
        let enabled = false;
        // Nút Đăng thường bật chậm; chờ tối đa ~8 giây, không bấm khi chưa bật.
        for (let i = 0; i < 16 && submitCount === 1 && !enabled; i += 1) {
          enabled = await submit.first().isEnabled();
          if (!enabled) await page.waitForTimeout(500);
        }
        const stepText = submitCount === 1 ? ((await step.first().textContent()) ?? '') : '';
        const stepAudienceOk = nextCount === 1 ? matchesExpected(stepText) : true; // đã kiểm ở bước một nếu không có bước hai
        say({ event: 'san_sang', daGoChu: typed, soNutDang: submitCount, nutBat: enabled, doiTuongBuocHaiKhop: stepAudienceOk });
        if (!typed || submitCount !== 1 || !enabled || !stepAudienceOk) {
          // Liệt kê tên các nút (rút gọn) để chọn cách nhận diện đúng; không bấm gì thêm.
          const names = await page.getByRole('dialog').first().getByRole('button').evaluateAll((nodes) => nodes
            .map((node) => (node.getAttribute('aria-label') ?? node.textContent ?? '').trim().slice(0, 40)).filter(Boolean).slice(0, 25));
          say({ event: 'ket_thuc', status: stepAudienceOk ? 'khong_san_sang_de_dang' : 'doi_tuong_buoc_hai_khong_khop_khong_dang', nutTrongHopThoai: names.join(' | ') });
          exitCode = stepAudienceOk ? 7 : 8;
        }
        else if (dryRun) say({ event: 'ket_thuc', status: 'dry_run_xong_khong_dang', marker });
        else {
          await submit.first().click(); // ĐÚNG MỘT LẦN — không bao giờ bấm lại
          say({ event: 'da_bam_dang', marker });
          const closed = await step.first().waitFor({ state: 'hidden', timeout: 60_000 }).then(() => true, () => false);
          // Trang cá nhân cập nhật chậm sau khi đăng (lần thử đầu không thấy dù bài đã lên): tải lại tối đa 3 lần, chỉ đọc.
          let scrolls = 0;
          let found = false;
          for (let attempt = 0; attempt < 3 && !found; attempt += 1) {
            await page.waitForTimeout(attempt === 0 ? 8_000 : 5_000);
            await page.goto('https://www.facebook.com/me', { waitUntil: 'load', timeout: 45_000 });
            await page.waitForTimeout(4_000);
            for (let i = 0; i < 4 && (await page.getByText(marker).count()) === 0; i += 1) {
              await page.mouse.wheel(0, 1_500);
              await page.waitForTimeout(2_000);
              scrolls += 1;
            }
            found = (await page.getByText(marker).count()) > 0;
          }
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
