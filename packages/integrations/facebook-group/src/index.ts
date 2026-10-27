/** Adapter đăng vào nhóm qua trình duyệt (P08). Phần dùng chung (hồ sơ, danh tính, ô soạn bài, ảnh) nằm trong `#browser`. */
import { type BrowserPublisherDeps, type ChannelStrategy, createBrowserPublisher } from '#browser';
import type { Publisher } from '#contracts';

export const groupStrategy: ChannelStrategy = {
  channel: 'group',
  twoStep: false,
  targetUrl: (request) => `https://www.facebook.com/groups/${request.context.destination.remoteId}`,
  feedUrl: (request) => `https://www.facebook.com/groups/${request.context.destination.remoteId}`,
  /**
   * Đúng nhóm khi URL còn chứa ID nhóm, hoặc trang có liên kết chứa ID đó (nhóm có tên rút gọn thì Facebook có thể đổi URL).
   * Không xác nhận được thì dừng trước khi gửi.
   */
  confirmTarget: async (page, request) => {
    const id = request.context.destination.remoteId;
    if (page.url().includes(`/groups/${id}`)) return true;
    return (await page.locator(`a[href*="/groups/${id}"]`).count()) > 0;
  },
};

export type GroupPublisherDeps = Omit<BrowserPublisherDeps, 'strategy' | 'requiredAudience'>;

export function createGroupPublisher(deps: GroupPublisherDeps): Publisher {
  return createBrowserPublisher({ ...deps, strategy: groupStrategy });
}
