import type { ProductImpact } from '#domain';

/** Thay đổi sắp thực hiện trên máy: sửa nội dung, hoặc đổi trạng thái. */
export type ImpactKind = 'revise' | 'selling' | 'sold' | 'archived';

/** Chỉ cần hỏi lại khi có bài chưa gửi hoặc đang chạy bị ảnh hưởng; bài đã có kết quả không bao giờ bị đổi. */
export const hasImpact = (impact: ProductImpact): boolean => impact.pendingJobs + impact.runningJobs > 0;

/** Mô tả đúng điều sẽ xảy ra với các bài đã xếp (khớp với server: sửa → "cần xem lại"; bán/ngừng bán → hủy). */
export function impactLines(kind: ImpactKind, impact: ProductImpact): string[] {
  const lines: string[] = [];
  if (impact.pendingJobs > 0) {
    lines.push(kind === 'sold' || kind === 'archived'
      ? `${impact.pendingJobs} bài chưa gửi sẽ bị HỦY vì máy không còn bán.`
      : `${impact.pendingJobs} bài chưa gửi sẽ chuyển sang "Cần xem lại": không tự đăng. Bài vẫn giữ nội dung bản đã duyệt và chỉ hủy được; muốn đăng bản mới hãy tạo bài mới ở trang Đăng bài.`);
  }
  if (impact.runningJobs > 0) lines.push(`${impact.runningJobs} bài đang chạy sẽ được yêu cầu dừng; nếu đã gửi đi thì kết quả thực tế vẫn được ghi lại.`);
  if (impact.settledJobs > 0) lines.push(`${impact.settledJobs} bài đã gửi hoặc đã có kết quả: không thay đổi.`);
  return lines;
}

export const IMPACT_TITLE: Record<ImpactKind, string> = {
  revise: 'Lưu phiên bản mới của máy',
  selling: 'Bán lại máy',
  sold: 'Đánh dấu đã bán',
  archived: 'Ngừng bán',
};
