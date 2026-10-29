import type { Locator, Page } from 'playwright-core';
import { readIdentityRef, sessionOf, waitEnabled } from './facebook-ui.ts';
import { JOIN_BUTTON, JOINED_BUTTON, REQUESTED_BUTTON } from './group-search.ts';
import { type LaunchedProfile, launchProfile } from './profile-session.ts';

/** Thông báo Facebook đang hạn chế việc tham gia nhóm (vi/en). Gặp là dừng toàn bộ, không thử lại. */
export const JOIN_BLOCKED_TEXT = /(tạm thời bị chặn|tạm thời không thể tham gia|không thể tham gia nhóm|bạn đã đạt giới hạn|temporarily blocked|can'?t join (more )?groups|you'?ve reached the limit|try again later)/i;
const CLOSE_BUTTON = /^(đóng|close|hủy|cancel|để sau|not now)$/i;
/** Nút gửi biểu mẫu tham gia (vi/en). Chỉ nhận khi trong hộp thoại có ĐÚNG MỘT nút như vậy. */
export const SUBMIT_BUTTON = /^(gửi|gửi yêu cầu|submit|send|send request|tham gia nhóm|join group|xong|done|hoàn tất)$/i;
/** Nhãn của ô tick mang nghĩa đồng ý nội quy/điều khoản. Ô tick khác (chọn đáp án) không bao giờ được tick hộ. */
export const RULES_LABEL = /nội quy|quy định|điều khoản|đồng ý|rules|agree|terms/i;
const CHOICE_CONTROLS = '[role="radio"], input[type="radio"], [role="combobox"], select, [role="listbox"]';
const BOX_CONTROLS = '[role="checkbox"], input[type="checkbox"]';
const TEXT_CONTROLS = 'textarea, input[type="text"], [role="textbox"]';

export interface GroupJoinInput {
  profileDir: string;
  expectedIdentity: string;
  /** ID số của nhóm; chỉ nhóm đã chọn, không bao giờ tự đổi sang nhóm khác. */
  externalId: string;
  shouldCancel(): boolean;
  onTick(): void;
  /** Ghi mốc gửi và kiểm tra hạn mức lần cuối. Trả false thì KHÔNG bấm. */
  beforeSend(): boolean;
  /** Cách xử lý biểu mẫu câu hỏi/điều khoản. Không có hoặc tắt thì nhóm có biểu mẫu bị bỏ qua. */
  form?: { agreeRules: boolean; defaultAnswer: string };
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
 * Hộp thoại đang hiện (kể cả bảng thông báo luôn có sẵn của Facebook, nên role="dialog" KHÔNG đủ để kết luận có câu hỏi).
 * Trả về chữ của từng hộp thoại hiện có, dùng làm mốc để nhận ra hộp thoại MỚI xuất hiện sau khi bấm.
 */
const dialogTexts = async (page: Page): Promise<string[]> => page.locator('[role="dialog"]:visible').allTextContents().catch(() => [] as string[]);

/** Hộp thoại mới (không có trước khi bấm). */
async function newDialogs(page: Page, baseline: ReadonlySet<string>): Promise<Locator[]> {
  const dialogs = page.locator('[role="dialog"]:visible');
  const texts = await dialogs.allTextContents().catch(() => [] as string[]);
  return texts.flatMap((text, index) => (baseline.has(text) ? [] : [dialogs.nth(index)]));
}

/** Hộp thoại mới có điều khiển nhập liệu = biểu mẫu câu hỏi/điều khoản. */
async function membershipForm(page: Page, baseline: ReadonlySet<string>): Promise<Locator | null> {
  for (const dialog of await newDialogs(page, baseline)) {
    if (await dialog.locator(`${CHOICE_CONTROLS}, ${BOX_CONTROLS}, ${TEXT_CONTROLS}`).count() > 0) return dialog;
  }
  return null;
}

/** Nhãn của một ô tick: aria-label và chữ ở khối chứa gần nhất. */
const boxLabel = (box: Locator): Promise<string> => box.evaluate((element) => {
  type El = { getAttribute(name: string): string | null; closest(selector: string): El | null; parentElement: El | null; textContent: string | null };
  const node = element as unknown as El;
  const holder = node.closest('label') ?? node.parentElement?.parentElement ?? node.parentElement;
  return `${node.getAttribute('aria-label') ?? ''} ${holder?.textContent ?? ''}`.slice(0, 400);
});

/**
 * Điền biểu mẫu theo cách người dùng đã chọn. Kiểm tra TOÀN BỘ trước, chỉ làm khi trả lời được hết: có câu chọn đáp án, ô tick không phải đồng ý
 * nội quy, câu viết tay mà chưa có câu mặc định, hoặc không có đúng một nút gửi thì không đụng gì và trả 'skip'.
 */
async function fillForm(dialog: Locator, rule: { agreeRules: boolean; defaultAnswer: string }): Promise<'ready' | 'skip'> {
  if (await dialog.locator(CHOICE_CONTROLS).count() > 0) return 'skip';
  const boxes = dialog.locator(BOX_CONTROLS);
  const boxCount = await boxes.count();
  if (boxCount > 0 && !rule.agreeRules) return 'skip';
  for (let index = 0; index < boxCount; index += 1) if (!RULES_LABEL.test(await boxLabel(boxes.nth(index)))) return 'skip';
  const texts = dialog.locator(TEXT_CONTROLS);
  const textCount = await texts.count();
  if (textCount > 0 && !rule.defaultAnswer.trim()) return 'skip';
  if (textCount > 10 || await dialog.getByRole('button', { name: SUBMIT_BUTTON }).count() !== 1) return 'skip';
  for (let index = 0; index < boxCount; index += 1) {
    const box = boxes.nth(index);
    const on = (await box.getAttribute('aria-checked')) === 'true' || await box.isChecked().catch(() => false);
    if (!on) await box.click({ timeout: 5000 });
  }
  for (let index = 0; index < textCount; index += 1) await texts.nth(index).fill(rule.defaultAnswer.trim(), { timeout: 5000 });
  return 'ready';
}

/**
 * Gửi MỘT yêu cầu tham gia nhóm. Chỉ bấm khi: phiên/danh tính đúng, đúng nhóm đã chọn, đúng một nút "Tham gia" và `beforeSend` cho phép.
 * Biểu mẫu câu hỏi/điều khoản: tick ô đồng ý nội quy và điền câu mặc định nếu người dùng bật; câu chọn đáp án thì không trả lời hộ (đóng và bỏ qua).
 * Không bấm "Tham gia" lần hai kể cả khi không thấy xác nhận.
 */
export function createGroupJoiner(deps: {
  launch?: (dir: string) => Promise<LaunchedProfile>;
  settleMs?: number;
  confirmMs?: number;
} = {}): GroupJoiner {
  return async (input) => {
    if (!/^\d{5,30}$/u.test(input.externalId)) throw new Error('Invalid group id');
    const rule = input.form ?? { agreeRules: false, defaultAnswer: '' };
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
      if (JOIN_BLOCKED_TEXT.test(await alertText(page))) return result('failed', 'action_blocked');
      const joinButton = page.getByRole('button', { name: JOIN_BUTTON });
      if (await joinButton.count() !== 1) return result('failed', 'ui_changed'); // không thấy hoặc không phân biệt được: không đoán
      if (input.shouldCancel()) return result('cancelled', 'cancelled');
      const baseline = new Set(await dialogTexts(page)); // hộp thoại có sẵn (bảng thông báo...) không phải câu hỏi
      if (!input.beforeSend()) return result('skipped', 'daily_cap');

      clicked = true; // mốc gửi đã ghi; từ đây mọi kết quả không rõ đều là `unknown`, không gửi lại
      await joinButton.first().click({ timeout: 10_000 });
      const deadline = Date.now() + (deps.confirmMs ?? 12_000);
      let formHandled = false;
      for (;;) {
        await page.waitForTimeout(500);
        // Trạng thái đã đổi thì ưu tiên hơn mọi hộp thoại (lần thử thật 29/10/2026: nhóm cho vào thẳng kèm hộp thoại khác).
        const nowRequested = await visible(page, 'button', REQUESTED_BUTTON) > 0;
        const nowJoined = !nowRequested && await visible(page, 'button', JOINED_BUTTON) > 0;
        if (nowRequested || nowJoined) {
          for (const dialog of await newDialogs(page, baseline)) if (await dialog.locator(`${BOX_CONTROLS}, ${TEXT_CONTROLS}`).count() === 0) await closeDialog(dialog);
          return nowRequested ? result('requested', null) : result('joined', null);
        }
        const dialogs = await newDialogs(page, baseline);
        for (const dialog of dialogs) {
          if (JOIN_BLOCKED_TEXT.test(await dialog.textContent().catch(() => '') ?? '')) { await closeDialog(dialog); return result('failed', 'action_blocked'); }
        }
        if (JOIN_BLOCKED_TEXT.test(await alertText(page))) return result('failed', 'action_blocked');
        if (!formHandled) {
          const form = await membershipForm(page, baseline);
          if (form) {
            formHandled = true;
            if (await fillForm(form, rule) === 'skip') { await closeDialog(form); return result('skipped', 'needs_answers'); }
            const submit = form.getByRole('button', { name: SUBMIT_BUTTON });
            if (!(await waitEnabled(submit, 3000, page))) { await closeDialog(form); return result('skipped', 'needs_answers'); }
            await submit.first().click({ timeout: 5000 }); // một lần duy nhất
          }
        }
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

/** Chữ trong thông báo dạng cảnh báo (role=alert), KHÔNG phải cả trang hay bảng thông báo: nội dung bài/thông báo cũ không được làm dừng cả lượt. */
const alertText = async (page: Page): Promise<string> => (await page.locator('[role="alert"]').allTextContents().catch(() => [] as string[])).join(' ');

async function closeDialog(dialog: Locator): Promise<void> {
  const close = dialog.getByRole('button', { name: CLOSE_BUTTON });
  if (await close.count() > 0) await close.first().click({ timeout: 3000 }).catch(() => undefined);
  else await dialog.page().keyboard.press('Escape').catch(() => undefined);
  await dialog.page().waitForTimeout(500);
}
