import type { PageConnectionItem } from '#domain';
import { emptyDraft, resolveStart } from './post-plan.ts';

/** Giới hạn thận trọng số ảnh mỗi bài fanpage (khớp bộ đăng ở worker). Chưa đối chiếu với giới hạn hiện hành của Meta. */
export const PAGE_MAX_PHOTOS = 10;

export interface PagePlan {
  page: PageConnectionItem | undefined;
  productId: string;
  productSelling: boolean;
  photoCount: number;
  caption: string;
  startMode: 'now' | 'later';
  /** Giờ hẹn nhập theo giờ Việt Nam, dạng "2026-10-27T14:30". */
  startLocal: string;
  now: number;
}

/** Lý do Page này chưa đăng được, viết cho người dùng. null nếu ổn. */
export function pageBlocker(page: PageConnectionItem): string | null {
  if (page.secretStatus !== 'available') return page.secretStatus === 'revoked' ? 'Đã gỡ kết nối token' : 'Token Page đã mất; kết nối lại bằng npm run page:connect';
  if (page.permissionStatus === 'expired') return 'Token đã hết hạn hoặc bị Meta thu hồi; kết nối lại bằng npm run page:connect';
  if (page.permissionStatus === 'denied') return 'Tài khoản không có quyền tạo nội dung trên Page này';
  if (page.permissionStatus !== 'allowed') return 'Chưa xác nhận được quyền đăng';
  return null;
}

/** Lý do chưa gửi được (rỗng = sẵn sàng). Chỉ chặn việc thật sự sai. */
export function pagePlanProblems(plan: PagePlan): string[] {
  const problems: string[] = [];
  if (!plan.page) problems.push('Chọn Page.');
  else {
    const blocker = pageBlocker(plan.page);
    if (blocker) problems.push(`Page chưa đăng được: ${blocker}.`);
  }
  if (!plan.productId) problems.push('Chọn máy.');
  else if (!plan.productSelling) problems.push('Máy này đã bán hoặc ngừng bán nên không tạo bài mới.');
  else if (plan.photoCount > PAGE_MAX_PHOTOS) problems.push(`Bài fanpage tối đa ${PAGE_MAX_PHOTOS} ảnh; máy này có ${plan.photoCount} ảnh.`);
  if (plan.caption.trim() === '') problems.push('Chưa có caption.');
  if (resolveStart({ ...emptyDraft(), startMode: plan.startMode, startLocal: plan.startLocal }, plan.now) === null) problems.push('Giờ hẹn không hợp lệ hoặc đã qua quá lâu (nhập theo giờ Việt Nam).');
  return problems;
}

/** Chữ ký nội dung gửi: đổi nội dung thì phải dùng mã yêu cầu mới; không đổi thì giữ mã cũ để bấm lại không tạo bài trùng. */
export function pagePlanSignature(pageConnectionId: string, productId: string, start: number | 'now', caption: string): string {
  return JSON.stringify([pageConnectionId, productId, start, caption.trim()]);
}
