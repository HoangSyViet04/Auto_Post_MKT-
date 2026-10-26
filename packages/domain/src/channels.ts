/** Kênh đăng và chế độ tích hợp — dùng chung server, worker, web. */
export const CHANNELS = ['profile', 'group', 'page'] as const;

export type Channel = (typeof CHANNELS)[number];

/**
 * fake: adapter giả, không gọi Facebook/LLM (mặc định ở mọi môi trường).
 * live: adapter thật; phải bật rõ ràng và bị cấm khi APM_ENV=test.
 */
export const INTEGRATION_MODES = ['fake', 'live'] as const;

export type IntegrationMode = (typeof INTEGRATION_MODES)[number];
