import type { Page } from 'playwright-core';
import { readIdentityRef, sessionOf } from './facebook-ui.ts';
import { JOIN_BUTTON, JOINED_BUTTON, REQUESTED_BUTTON } from './group-search.ts';
import { type LaunchedProfile, launchProfile } from './profile-session.ts';

/** Thông báo Facebook đang hạn chế việc tham gia nhóm (vi/en). Gặp là dừng toàn bộ, không thử lại. */
export const JOIN_BLOCKED_TEXT = /(tạm thời bị chặn|tạm thời không thể tham gia|không thể tham gia nhóm|bạn đã đạt giới hạn|temporarily blocked|can'?t join (more )?groups|you'?ve reached the limit|try again later)/i;
const CLOSE_BUTTON = /^(đóng|close|hủy|cancel|để sau|not now)$/i;

export interface GroupJoinInput {
  profileDir: string;
  expectedIdentity: string;
  /** ID số của nhóm; chỉ nhóm đã chọn, không bao giờ tự đổi sang nhóm khác. */
  externalId: string;
  shouldCancel(): boolean;
  onTick(): void;
  /** Ghi mốc gửi và kiểm tra hạn mức lần cuối. Trả false thì KHÔNG bấm. */
  beforeSend(): boolean;
}
export interface GroupJoinResult {
  status: 'requested' | 'joined' | 'skipped' | 'failed' | 'unknown' | 'cancelled';
  reason: string | null;
  /** true khi đã bấm "Tham gia" (từ đó không bao giờ gửi lại). */
  clicked: boolean;
}
export type GroupJoiner = (input: GroupJoinInput) => Promise<GroupJoinResult>;

const visible = async (page: Page, role: 'button', name: RegExp): Promise<number> => page.getByRole(role, { name }).count();

/**
 * Gửi MỘT yêu cầu tham gia nhóm. Chỉ bấm khi: phiên/danh tính đúng, đúng nhóm đã chọn, đúng một nút "Tham gia" và `beforeSend` cho phép.
 * Nhóm có câu hỏi/điều khoản (hộp thoại) thì đóng lại và bỏ qua, không trả lời hộ. Không bấm lần hai kể cả khi không thấy xác nhận.
 */
export function createGroupJoiner(deps: {
  launch?: (dir: string) => Promise<LaunchedProfile>;
  settleMs?: number;
  confirmMs?: number;
} = {}): GroupJoiner {
  return async (input) => {
    if (!/^\d{5,30}$/u.test(input.externalId)) throw new Error('Invalid group id');
    let profile: LaunchedProfile | undefined;
    let clicked = false;
    const result = (status: GroupJoinResult['status'], reason: string | null): GroupJoinResult => ({ status, reason, clicked });
    try {
      if (input.shouldCancel()) return result('cancelled', 'cancelled');
      profile = await (deps.launch ?? launchProfile)(input.profileDir);
      const { page, context } = profile;
      await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForTimeout(deps.settleMs ?? 2000);
      input.onTick();
      const state = await sessionOf(context, page);
      if (state !== 'logged_in') return result('failed', state === 'verification_required' ? 'checkpoint' : 'session_expired');
      const identity = await readIdentityRef(page);
      if (!identity || identity !== input.expectedIdentity) return result('failed', 'identity_mismatch');
      if (input.shouldCancel()) return result('cancelled', 'cancelled');

      await page.goto(`https://www.facebook.com/groups/${input.externalId}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForTimeout(deps.settleMs ?? 2000);
      input.onTick();
      const after = await sessionOf(context, page);
      if (after !== 'logged_in') return result('failed', after === 'verification_required' ? 'checkpoint' : 'session_expired');
      // Đúng nhóm khi URL còn ID, hoặc trang có liên kết chứa ID (nhóm có tên rút gọn thì Facebook đổi URL).
      const id = input.externalId;
      const sameGroup = page.url().includes(`/groups/${id}`) || (await page.locator(`a[href*="/groups/${id}"]`).count()) > 0;
      if (!sameGroup) return result('failed', 'wrong_group');
      if (await visible(page, 'button', JOINED_BUTTON) > 0) return result('skipped', 'already_joined');
      if (await visible(page, 'button', REQUESTED_BUTTON) > 0) return result('skipped', 'already_requested');
      if (JOIN_BLOCKED_TEXT.test(await noticeText(page))) return result('failed', 'action_blocked');
      const joinButton = page.getByRole('button', { name: JOIN_BUTTON });
      if (await joinButton.count() !== 1) return result('failed', 'ui_changed'); // không thấy hoặc không phân biệt được: không đoán
      if (input.shouldCancel()) return result('cancelled', 'cancelled');
      if (!input.beforeSend()) return result('skipped', 'daily_cap');

      clicked = true; // mốc gửi đã ghi; từ đây mọi kết quả không rõ đều là `unknown`, không gửi lại
      await joinButton.first().click({ timeout: 10_000 });
      const deadline = Date.now() + (deps.confirmMs ?? 12_000);
      for (;;) {
        await page.waitForTimeout(500);
        // Trạng thái đã đổi thì ưu tiên hơn hộp thoại: nhóm công khai cho vào ngay thường hiện hộp thoại chào sau khi vào
        // (lần thử thật 29/10/2026: coi hộp thoại đó là câu hỏi đã làm ghi sai "bỏ qua" dù nick đã vào nhóm).
        const nowRequested = await visible(page, 'button', REQUESTED_BUTTON) > 0;
        const nowJoined = !nowRequested && await visible(page, 'button', JOINED_BUTTON) > 0;
        if (nowRequested || nowJoined) {
          if (await page.locator('[role="dialog"]').count() > 0) await closeDialog(page);
          return nowRequested ? result('requested', null) : result('joined', null);
        }
        if (await page.locator('[role="dialog"]').count() > 0) {
          const dialogText = await page.locator('[role="dialog"]').first().textContent().catch(() => '') ?? '';
          if (JOIN_BLOCKED_TEXT.test(dialogText)) { await closeDialog(page); return result('failed', 'action_blocked'); }
          // Hộp thoại mà trạng thái chưa đổi: câu hỏi, điều khoản hoặc bước chưa rõ. Đóng lại, chưa gửi gì, người dùng tự làm tay.
          await closeDialog(page);
          return result('skipped', 'needs_answers');
        }
        if (JOIN_BLOCKED_TEXT.test(await noticeText(page))) return result('failed', 'action_blocked');
        if (Date.now() >= deadline) return result('unknown', 'unconfirmed');
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'profile_in_use') return result('failed', 'profile_in_use');
      if (clicked) return result('unknown', 'unconfirmed');
      return result('failed', error instanceof Error && /net::ERR_/u.test(error.message) ? 'network_error' : 'join_error');
    } finally {
      await profile?.close();
    }
  };
}

/** Chữ trong hộp thoại/thông báo, KHÔNG phải cả trang: nội dung bài trong nhóm không được làm dừng cả lượt. */
const noticeText = async (page: Page): Promise<string> => (await page.locator('[role="dialog"], [role="alert"]').allTextContents().catch(() => [] as string[])).join(' ');

async function closeDialog(page: Page): Promise<void> {
  const close = page.locator('[role="dialog"]').getByRole('button', { name: CLOSE_BUTTON });
  if (await close.count() > 0) await close.first().click({ timeout: 3000 }).catch(() => undefined);
  else await page.keyboard.press('Escape').catch(() => undefined);
}
