import { createFakePublisher, type PublishRequest } from '#contracts';
import type { Channel } from '#domain';

export const SCENARIOS = ['published', 'pending_approval', 'unknown', 'stop', 'expired', 'checkpoint', 'ambiguous_selector'] as const;
export type Scenario = (typeof SCENARIOS)[number];

export interface OfflineEvidence {
  scenario: Scenario;
  channel: Channel;
  simulated: true;
  realCapability: 'not_tested';
  outcome: 'published' | 'pending_approval' | 'unknown' | 'stopped' | 'blocked';
  stage: 'prepare' | 'submit';
  submittedCount: number;
  verified: 'published' | 'pending_approval' | 'unknown' | 'not_run';
  reasonCode?: 'session_expired_fixture' | 'checkpoint_fixture' | 'selector_ambiguous_fixture' | 'stopped_before_submit';
}

/** Offline control-flow fixtures, never browser state detection or evidence from Facebook. */
export async function runOfflineScenario(scenario: Scenario, channel: Channel): Promise<OfflineEvidence> {
  const publisher = createFakePublisher(channel, {
    submit: () => scenario === 'pending_approval' ? { status: 'pending_approval' }
      : scenario === 'unknown' ? { status: 'unknown', reason: 'timeout fixture' }
      : { status: 'published', remoteId: 'fake-offline-result' },
  });
  const request: PublishRequest = {
    jobId: 'offline-job', destinationId: 'fake-destination',
    caption: 'Nội dung mô phỏng, không gửi Facebook.', mediaPaths: [],
  };
  const base = { scenario, channel, simulated: true, realCapability: 'not_tested' } as const;
  if (scenario === 'stop') {
    await publisher.stop();
    const prepared = await publisher.prepare(request);
    if (prepared.ok) throw new Error('Offline stop invariant failed');
    return { ...base, outcome: 'stopped', stage: 'prepare', submittedCount: publisher.submitted.length,
      verified: 'not_run', reasonCode: 'stopped_before_submit' };
  }
  // These are explicit controller fixtures. There is no browser/selector/session driver yet.
  const blockedReasons = {
    expired: 'session_expired_fixture', checkpoint: 'checkpoint_fixture', ambiguous_selector: 'selector_ambiguous_fixture',
  } as const;
  if (scenario === 'expired' || scenario === 'checkpoint' || scenario === 'ambiguous_selector') {
    return { ...base, outcome: 'blocked', stage: 'prepare', submittedCount: publisher.submitted.length,
      verified: 'not_run', reasonCode: blockedReasons[scenario] };
  }
  const prepared = await publisher.prepare(request);
  if (!prepared.ok) throw new Error('Offline prepare invariant failed');
  const submitted = await publisher.submit(request);
  if (submitted.status === 'failed') throw new Error('Offline submit invariant failed');
  // Verify is read-only; especially unknown never triggers another submit.
  const verified = await publisher.verify(request);
  if (verified.status === 'not_found') throw new Error('Offline verify invariant failed');
  return { ...base, outcome: submitted.status, stage: 'submit', submittedCount: publisher.submitted.length,
    verified: verified.status };
}
