/** Trạng thái PublishJob — xem plan.md mục 4.2. */
export const JOB_STATUSES = [
  'queued',
  'running',
  'published',
  'pending_approval',
  'paused',
  'blocked',
  'needs_review',
  'unknown',
  'failed',
  'cancelled',
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];
