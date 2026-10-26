import type { Channel, IntegrationMode } from '#domain';
import { createFakePublisher, type Publisher } from '#contracts';

/** Chọn adapter theo APM_INTEGRATIONS. Chưa có adapter thật nên live bị từ chối thay vì lặng lẽ dùng adapter giả. */
export function createPublishers(mode: IntegrationMode): Record<Channel, Publisher> {
  if (mode === 'live') {
    throw new Error('Chưa có adapter Facebook thật (P08/P09). Dùng APM_INTEGRATIONS=fake.');
  }
  return {
    profile: createFakePublisher('profile'),
    group: createFakePublisher('group'),
    page: createFakePublisher('page'),
  };
}
