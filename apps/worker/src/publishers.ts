import type { Channel, IntegrationMode } from '#domain';
import { createFakePublisher, type Publisher } from '#contracts';
import { createGroupPublisher } from '#fb-group';
import { createProfilePublisher } from '#fb-profile';

export interface LivePublisherDeps {
  /** Thư mục hồ sơ trình duyệt của tài khoản (ngoài repo). */
  profileDirFor(accountId: string): string;
  /** Trang cá nhân: đối tượng bắt buộc của bài (ví dụ "Công khai"); không đặt thì chỉ ghi lại, không kiểm tra. */
  profileAudience?: string;
}

/** Kênh chưa có adapter thật: tắt rõ ràng, mọi việc đều dừng TRƯỚC khi gửi và báo "chưa hỗ trợ", không giả thành công. */
function unsupportedPublisher(channel: Channel): Publisher {
  return {
    capabilities: Object.freeze({ channel, level: 'unsupported', simulated: false }),
    prepare: async () => ({ ok: false, reasonCode: 'unsupported', reason: `Kênh ${channel} chưa được hỗ trợ.` }),
    submit: async () => ({ status: 'failed', reasonCode: 'unsupported', reason: `Kênh ${channel} chưa được hỗ trợ.` }),
    verify: async () => ({ status: 'unknown', reasonCode: 'unsupported' }),
    stop: async () => ({ requested: true, futureSubmissionsBlocked: true, inFlight: 'none', remoteRecall: false }),
  };
}

/**
 * Chọn adapter theo APM_INTEGRATIONS. fake: mô phỏng hoàn toàn. live: nhóm và trang cá nhân đăng thật qua trình duyệt (cần worker
 * được phép mở trình duyệt); fanpage chưa có adapter (P09) nên bị tắt rõ ràng.
 */
export function createPublishers(mode: IntegrationMode, live?: LivePublisherDeps): Record<Channel, Publisher> {
  if (mode === 'live') {
    if (!live) throw new Error('APM_INTEGRATIONS=live cần APM_BROWSER=real để worker mở trình duyệt đăng bài.');
    return {
      profile: createProfilePublisher({ profileDirFor: live.profileDirFor, ...(live.profileAudience ? { requiredAudience: live.profileAudience } : {}) }),
      group: createGroupPublisher({ profileDirFor: live.profileDirFor }),
      page: unsupportedPublisher('page'),
    };
  }
  return {
    profile: createFakePublisher('profile'),
    group: createFakePublisher('group'),
    page: createFakePublisher('page'),
  };
}
