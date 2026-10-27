import type { Locator, Page } from 'playwright-core';
import type {
  ApprovedPublishRequest,
  IntegrationEvidence,
  OperationReasonCode,
  PrepareResult,
  Publisher,
  PublishRequest,
  StopResult,
  SubmitResult,
  VerifyResult,
} from '#contracts';
import { assertApprovedPublishRequest } from '#contracts';
import {
  AUDIENCE_BUTTON,
  bigImages,
  captionSnippet,
  COMPOSER_NAME,
  countText,
  nearestPostId,
  NEXT_BUTTON,
  PHOTO_BUTTON,
  POST_BUTTON,
  readIdentityRef,
  sessionOf,
  waitEnabled,
} from './facebook-ui.ts';
import { type LaunchedProfile, launchProfile } from './profile-session.ts';
import { refDigest } from './session.ts';

/** Phần riêng của từng kênh (nhóm / trang cá nhân); phần còn lại của động cơ dùng chung. */
export interface ChannelStrategy {
  channel: 'group' | 'profile';
  /** Trang chứa ô soạn bài của đích. */
  targetUrl(request: ApprovedPublishRequest): string;
  /** Xác nhận đang đứng đúng đích sau khi mở trang (đúng ID nhóm / đúng trang cá nhân). */
  confirmTarget(page: Page, request: ApprovedPublishRequest): Promise<boolean>;
  /** Trang cá nhân: soạn → "Tiếp" → "Đăng", và có nút đối tượng để kiểm tra. */
  twoStep: boolean;
  /** Trang xem lại bài đã đăng để xác nhận. */
  feedUrl(request: ApprovedPublishRequest): string;
}

export interface BrowserPublisherDeps {
  strategy: ChannelStrategy;
  /** Thư mục hồ sơ trình duyệt của tài khoản (do worker quyết định, ngoài repo). */
  profileDirFor(accountId: string): string;
  /** Mở hồ sơ; mặc định là Edge thật. Test thay bằng trình duyệt chạy ngầm + trang giả. */
  launch?: (profileDir: string) => Promise<LaunchedProfile>;
  /**
   * Trang cá nhân: nếu đặt, đối tượng của bài PHẢI khớp (ví dụ "Công khai"/"Chỉ mình tôi"), không khớp thì dừng trước khi gửi.
   * Không đặt thì chỉ ghi lại đối tượng đọc được, không kiểm tra.
   */
  requiredAudience?: string;
  /** Thời gian chờ (ms); test rút ngắn. */
  timing?: { uploadMs?: number; closeMs?: number; settleMs?: number; retryMs?: number; pageMs?: number; stepMs?: number; scrollMs?: number };
}

interface Session {
  profile: LaunchedProfile;
  request: ApprovedPublishRequest;
  snippet: string;
  /** Số lần đoạn chữ đã có trên trang đích TRƯỚC khi đăng; bài mới làm số này tăng. */
  baseline: number;
  /** Hộp thoại có nút Đăng (bước cuối). */
  dialog: Locator;
  submitting: boolean;
}

const fail = (reasonCode: OperationReasonCode, reason: string): PrepareResult => ({ ok: false, reasonCode, reason });

/**
 * Động cơ đăng bài qua trình duyệt cho nhóm/TCN. `prepare` làm MỌI việc trừ bấm Đăng (đúng người, đúng đích, soạn chữ, đính đủ ảnh,
 * tìm nút Đăng): lỗi ở đây là dừng TRƯỚC khi gửi. `submit` chỉ bấm Đăng đúng một lần rồi tìm lại bài; không tìm thấy thì `unknown`,
 * không bao giờ tự thử lại. Không tự giải CAPTCHA/checkpoint.
 */
export function createBrowserPublisher(deps: BrowserPublisherDeps): Publisher {
  const { strategy } = deps;
  const launch = deps.launch ?? launchProfile;
  const timing = { uploadMs: deps.timing?.uploadMs ?? 30_000, closeMs: deps.timing?.closeMs ?? 60_000, settleMs: deps.timing?.settleMs ?? 5_000,
    retryMs: deps.timing?.retryMs ?? 5_000, pageMs: deps.timing?.pageMs ?? 2_000, stepMs: deps.timing?.stepMs ?? 3_000, scrollMs: deps.timing?.scrollMs ?? 2_000 };
  const sessions = new Map<string, Session>();
  let stopped = false;

  function evidence(request: ApprovedPublishRequest, remoteUrl?: string): IntegrationEvidence {
    return Object.freeze({ source: 'browser_observation', observedAt: new Date().toISOString(),
      identityRemoteId: request.context.expectedIdentity.remoteId, destinationRemoteId: request.context.destination.remoteId,
      ...(remoteUrl ? { remoteUrl } : {}) });
  }

  async function closeSession(jobId: string): Promise<void> {
    const session = sessions.get(jobId);
    sessions.delete(jobId);
    await session?.profile.close();
  }

  /** Đăng nhập còn hiệu lực và đúng người đăng; trả mã lý do nếu không. */
  async function confirmPoster(profile: LaunchedProfile, request: ApprovedPublishRequest): Promise<PrepareResult> {
    const { page, context } = profile;
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(timing.pageMs);
    const state = await sessionOf(context, page);
    if (state === 'verification_required') return fail('checkpoint', 'Facebook yêu cầu xác minh; cần người dùng xử lý.');
    if (state !== 'logged_in') return fail('session_expired', 'Phiên đăng nhập không còn hiệu lực.');
    const ref = await readIdentityRef(page);
    if (!ref) return fail('identity_mismatch', 'Không đọc được danh tính người đăng.');
    // So băm để không đưa tham chiếu danh tính vào thông điệp lỗi.
    if (refDigest(ref) !== refDigest(request.context.expectedIdentity.remoteId)) return fail('identity_mismatch', 'Danh tính đang đăng nhập khác tài khoản đã duyệt.');
    return { ok: true };
  }

  async function prepare(request: PublishRequest): Promise<PrepareResult> {
    if (stopped) return fail('stopped', 'Đã dừng.');
    try { assertApprovedPublishRequest(request); } catch { return fail('invalid_request', 'Yêu cầu đã duyệt không hợp lệ.'); }
    if (request.context.destination.channel !== strategy.channel) return fail('destination_not_allowed', 'Kênh đích không khớp adapter.');
    if (sessions.has(request.jobId)) return fail('invalid_request', 'Job này đã có phiên soạn đang mở.');
    const approved: ApprovedPublishRequest = request;

    let profile: LaunchedProfile;
    try {
      profile = await launch(deps.profileDirFor(approved.context.expectedIdentity.localId));
    } catch {
      return fail('unknown', 'Không mở được hồ sơ trình duyệt (có thể đang được dùng).');
    }
    const abort = async (result: PrepareResult): Promise<PrepareResult> => { await profile.close(); return result; };
    try {
      const poster = await confirmPoster(profile, approved);
      if (!poster.ok) return await abort(poster);
      if (stopped) return await abort(fail('stopped', 'Đã dừng.'));

      const { page } = profile;
      await page.goto(strategy.targetUrl(approved), { waitUntil: 'load', timeout: 45_000 });
      await page.waitForTimeout(timing.settleMs);
      if ((await sessionOf(profile.context, page)) !== 'logged_in' || !(await strategy.confirmTarget(page, approved))) {
        return await abort(fail('destination_not_allowed', 'Không xác nhận được đúng đích đăng.'));
      }

      const snippet = captionSnippet(approved.caption);
      if (snippet.length < 4) return await abort(fail('invalid_request', 'Caption quá ngắn để đối chiếu sau khi đăng.'));
      const baseline = await countText(page, snippet);

      const composers = page.getByRole('button', { name: COMPOSER_NAME });
      if ((await composers.count()) !== 1) return await abort(fail('ui_changed', 'Không nhận ra ô soạn bài (giao diện có thể đã đổi).'));
      await composers.first().click();
      let dialogs = page.getByRole('dialog').filter({ has: page.getByRole('textbox') });
      await dialogs.first().waitFor({ state: 'visible', timeout: 20_000 });
      const box = dialogs.first().getByRole('textbox');
      if ((await dialogs.count()) !== 1 || (await box.count()) !== 1) return await abort(fail('ui_changed', 'Hộp soạn bài không đúng như mong đợi.'));

      let audience = '';
      if (strategy.twoStep) {
        const buttons = dialogs.first().getByRole('button', { name: AUDIENCE_BUTTON });
        if ((await buttons.count()) !== 1) return await abort(fail('ui_changed', 'Không đọc được đối tượng của bài.'));
        audience = `${(await buttons.first().getAttribute('aria-label')) ?? ''} ${(await buttons.first().textContent()) ?? ''}`.toLowerCase();
        if (deps.requiredAudience && !audience.includes(deps.requiredAudience.toLowerCase())) {
          return await abort(fail('destination_not_allowed', 'Đối tượng của bài không khớp cấu hình bắt buộc.'));
        }
      }
      if (stopped) return await abort(fail('stopped', 'Đã dừng.'));

      await box.first().click();
      await page.keyboard.insertText(approved.caption);
      if (!(((await box.first().textContent()) ?? '').includes(snippet))) return await abort(fail('ui_changed', 'Chữ vừa điền không hiện trong hộp soạn bài.'));

      const wanted = approved.mediaPaths.length;
      if (wanted > 0) {
        const inputs = dialogs.first().locator('input[type="file"]');
        if ((await inputs.count()) > 0) await inputs.first().setInputFiles([...approved.mediaPaths]); // đúng thứ tự đã duyệt
        else {
          const chooser = page.waitForEvent('filechooser', { timeout: 15_000 });
          await dialogs.first().getByRole('button', { name: PHOTO_BUTTON }).first().click();
          await (await chooser).setFiles([...approved.mediaPaths]);
        }
        let attached = 0;
        for (let waited = 0; waited <= timing.uploadMs && attached < wanted; waited += 1_000) {
          attached = await bigImages(dialogs.first());
          if (attached < wanted) await page.waitForTimeout(1_000);
        }
        if (attached !== wanted) return await abort(fail('media_invalid', 'Số ảnh đính kèm không khớp số ảnh đã duyệt; dừng trước khi gửi.'));
      }
      if (stopped) return await abort(fail('stopped', 'Đã dừng.'));

      let step: Locator = dialogs.first();
      if (strategy.twoStep) {
        const next = dialogs.first().getByRole('button', { name: NEXT_BUTTON });
        if ((await next.count()) !== 1 || !(await waitEnabled(next, 8_000, page))) return await abort(fail('ui_changed', 'Không bấm được "Tiếp".'));
        await next.first().click(); // "Tiếp" chưa đăng gì
        await page.waitForTimeout(timing.stepMs);
        dialogs = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: POST_BUTTON }) });
        step = dialogs.first();
        if (deps.requiredAudience && !(((await step.textContent()) ?? '').toLowerCase().includes(deps.requiredAudience.toLowerCase()))) {
          return await abort(fail('destination_not_allowed', 'Đối tượng ở bước cuối không khớp cấu hình bắt buộc.'));
        }
      }
      const submit = step.getByRole('button', { name: POST_BUTTON });
      if ((await dialogs.count()) !== 1 || (await submit.count()) !== 1 || !(await waitEnabled(submit, 8_000, page))) {
        return await abort(fail('ui_changed', 'Không tìm thấy đúng một nút Đăng đang bật.'));
      }
      sessions.set(approved.jobId, { profile, request: approved, snippet, baseline, dialog: step, submitting: false });
      return { ok: true };
    } catch (error) {
      const network = error instanceof Error && /net::ERR_/u.test(error.message);
      return await abort(fail(network ? 'network_error' : 'ui_changed', network ? 'Lỗi mạng khi chuẩn bị đăng.' : 'Lỗi khi chuẩn bị đăng; dừng trước khi gửi.'));
    }
  }

  /** Tìm lại bài vừa đăng: tải lại trang đích, số lần đoạn chữ xuất hiện phải tăng so với trước khi đăng. */
  async function findPosted(session: Session): Promise<{ found: boolean; postId: string | null }> {
    const { page } = session.profile;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.waitForTimeout(attempt === 0 ? timing.retryMs + timing.stepMs : timing.retryMs);
      await page.goto(strategy.feedUrl(session.request), { waitUntil: 'load', timeout: 45_000 });
      await page.waitForTimeout(timing.settleMs);
      for (let scroll = 0; scroll < 4 && (await countText(page, session.snippet)) <= session.baseline; scroll += 1) {
        await page.mouse.wheel(0, 1_500);
        await page.waitForTimeout(timing.scrollMs);
      }
      if ((await countText(page, session.snippet)) > session.baseline) {
        return { found: true, postId: await nearestPostId(page.getByText(session.snippet)).catch(() => null) };
      }
    }
    return { found: false, postId: null };
  }

  return {
    capabilities: Object.freeze({ channel: strategy.channel, level: 'automatic', simulated: false }),
    prepare,

    async submit(request: PublishRequest): Promise<SubmitResult> {
      const session = sessions.get(request.jobId);
      if (!session) return { status: 'failed', reasonCode: 'invalid_request', reason: 'Chưa có phiên đã chuẩn bị cho job này.' };
      session.submitting = true;
      try {
        const submit = session.dialog.getByRole('button', { name: POST_BUTTON });
        await submit.first().click(); // ĐÚNG MỘT LẦN — không bao giờ bấm lại
        const closed = await session.dialog.waitFor({ state: 'hidden', timeout: timing.closeMs }).then(() => true, () => false);
        const posted = await findPosted(session).catch(() => ({ found: false, postId: null as string | null }));
        const url = posted.postId && strategy.channel === 'group' ? `https://www.facebook.com/groups/${session.request.context.destination.remoteId}/posts/${posted.postId}` : undefined;
        if (posted.found) {
          return { status: 'published', remoteId: posted.postId ?? 'observed:no_id', evidence: evidence(session.request, url) };
        }
        return { status: 'unknown', reasonCode: 'unknown', evidence: evidence(session.request),
          reason: closed ? 'Đã bấm Đăng nhưng không thấy bài trong trang đích; cần đối chiếu bằng mắt.' : 'Đã bấm Đăng nhưng hộp soạn chưa đóng; cần đối chiếu bằng mắt.' };
      } catch {
        return { status: 'unknown', reasonCode: 'unknown', evidence: evidence(session.request), reason: 'Lỗi sau khi bấm Đăng; có thể đã gửi.' };
      } finally {
        await closeSession(request.jobId);
      }
    },

    /** Chỉ đọc: có thấy bài mang đoạn chữ này trên trang đích không. Không thấy KHÔNG có nghĩa được gửi lại. */
    async verify(request: PublishRequest): Promise<VerifyResult> {
      try { assertApprovedPublishRequest(request); } catch { return { status: 'unknown', reasonCode: 'invalid_request' }; }
      let profile: LaunchedProfile;
      try { profile = await launch(deps.profileDirFor(request.context.expectedIdentity.localId)); } catch { return { status: 'unknown', reasonCode: 'unknown' }; }
      try {
        const poster = await confirmPoster(profile, request);
        if (!poster.ok) return { status: 'unknown', reasonCode: poster.reasonCode };
        await profile.page.goto(strategy.feedUrl(request), { waitUntil: 'load', timeout: 45_000 });
        await profile.page.waitForTimeout(timing.settleMs);
        return (await countText(profile.page, captionSnippet(request.caption))) > 0 ? { status: 'published' } : { status: 'not_found' };
      } catch {
        return { status: 'unknown', reasonCode: 'unknown' };
      } finally {
        await profile.close();
      }
    },

    /** Chặn việc chưa làm và đóng các phiên chưa bấm Đăng. Phần đã bấm Đăng không thu hồi được. */
    async stop(): Promise<StopResult> {
      stopped = true;
      const inFlight = [...sessions.values()].some((session) => session.submitting);
      for (const [jobId, session] of [...sessions]) if (!session.submitting) await closeSession(jobId);
      return { requested: true, futureSubmissionsBlocked: true, inFlight: inFlight ? 'unknown' : 'none', remoteRecall: false };
    },
  };
}
