import { BusinessError } from './business-error.ts';

export interface PostingInterval { minSeconds: number; maxSeconds: number }
export const MAX_POSTING_INTERVAL_SECONDS = 86_400;

/** Seconds are explicit integers, including zero; omitted settings keep legacy worker policy. */
export function parsePostingInterval(value: unknown): PostingInterval {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BusinessError('invalid_input');
  const { minSeconds, maxSeconds } = value as PostingInterval;
  if (!Number.isInteger(minSeconds) || !Number.isInteger(maxSeconds) || minSeconds < 0
    || maxSeconds < minSeconds || maxSeconds > MAX_POSTING_INTERVAL_SECONDS) throw new BusinessError('invalid_input');
  return { minSeconds, maxSeconds };
}
