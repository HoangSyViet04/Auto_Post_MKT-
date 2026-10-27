/** Adapter đăng lên trang cá nhân (TCN) qua trình duyệt (P08). Phần dùng chung nằm trong `#browser`. */
import { type BrowserPublisherDeps, type ChannelStrategy, createBrowserPublisher, identityRefFromUrl, refDigest } from '#browser';
import type { Publisher } from '#contracts';

export const profileStrategy: ChannelStrategy = {
  channel: 'profile',
  twoStep: true, // soạn → "Tiếp" → "Đăng"
  targetUrl: () => 'https://www.facebook.com/me',
  feedUrl: () => 'https://www.facebook.com/me',
  /** Trang vừa mở phải đúng là trang cá nhân của chính người đã duyệt (đích TCN trùng danh tính người đăng). */
  confirmTarget: async (page, request) => {
    const ref = identityRefFromUrl(page.url());
    return ref !== null && refDigest(ref) === refDigest(request.context.destination.remoteId);
  },
};

export type ProfilePublisherDeps = Omit<BrowserPublisherDeps, 'strategy'>;

export function createProfilePublisher(deps: ProfilePublisherDeps): Publisher {
  return createBrowserPublisher({ ...deps, strategy: profileStrategy });
}
