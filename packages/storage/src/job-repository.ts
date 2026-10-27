import { createHash, randomUUID } from 'node:crypto';
import { BusinessError, type IntegrationMode, type JobStatus } from '#domain';
import type { PublishContext } from '#contracts';
import type { Database } from './db.ts';
import { atomic, identifier, mode, objectInput, one, readiness, type RepositoryOptions, selectedMedia, snapshot,
  text, timestamp } from './repository-common.ts';

export interface StoredJob {
  id: string; request_id: string; approval_id: string; status: JobStatus; scheduled_at: number; created_at: number;
  claim_owner_id: string | null; claim_generation: number; claimed_at: number | null;
  claim_expires_at: number | null; stop_requested_at: number | null;
}
export interface JobClaim { jobId: string; workerId: string; generation: number; attemptId: string }
export interface EnqueueInput {
  requestKey: string; mode: IntegrationMode;
  jobs: readonly { approvalId: string; scheduledAt: number }[];
}
export interface Completion {
  outcome: 'published' | 'pending_approval' | 'unknown' | 'failed';
  source: 'fake' | 'api_response' | 'ui_observation';
  remoteId?: string; remoteUrl?: string;
  reasonCode?: 'network_error' | 'session_expired' | 'checkpoint' | 'identity_mismatch'
    | 'destination_not_allowed' | 'media_invalid' | 'ui_changed' | 'unknown';
}
interface Attempt { id: string; job_id: string; send_started_at: number | null; finished_at: number | null }

/** DB primitives only: no scheduler, browser/profile mutex, network or physical-file validation. */
export function createJobRepository(db: Database, options: RepositoryOptions = {}) {
  const clock = () => timestamp((options.clock ?? Date.now)());
  function get(jobId: string): StoredJob {
    identifier(jobId);
    const job = one<StoredJob>(db, 'SELECT * FROM publish_jobs WHERE id=?', jobId);
    if (!job) throw new BusinessError('not_found');
    return job;
  }
  function owned(claim: JobClaim, now: number): { job: StoredJob; attempt: Attempt } {
    objectInput(claim);
    identifier(claim.attemptId); text(claim.workerId, 200);
    const job = get(claim.jobId);
    const attempt = one<Attempt>(db, 'SELECT id,job_id,send_started_at,finished_at FROM publish_attempts WHERE id=?', claim.attemptId);
    if (job.status !== 'running' || job.claim_owner_id !== claim.workerId || job.claim_generation !== claim.generation
      || job.claim_expires_at === null || job.claim_expires_at <= now || !attempt
      || attempt.job_id !== job.id || attempt.finished_at !== null) throw new BusinessError('claim_lost');
    return { job, attempt };
  }
  function end(jobId: string, attemptId: string, status: JobStatus, now: number) {
    db.prepare('UPDATE publish_attempts SET finished_at=? WHERE id=? AND finished_at IS NULL').run(now, attemptId);
    db.prepare(`UPDATE publish_jobs SET status=?,claim_owner_id=NULL,claimed_at=NULL,claim_expires_at=NULL WHERE id=?`).run(status, jobId);
  }

  return {
    get,
    enqueue(input: EnqueueInput): { requestId: string; replayed: boolean; jobs: StoredJob[] } {
      objectInput(input);
      text(input.requestKey, 200); mode(input.mode);
      if (!Array.isArray(input.jobs) || !input.jobs.length || input.jobs.length > 100) throw new BusinessError('invalid_input');
      const targets = input.jobs.map((target) => {
        objectInput(target);
        identifier(target.approvalId); timestamp(target.scheduledAt);
        return { approvalId: target.approvalId, scheduledAt: target.scheduledAt };
      }).sort((a, b) => a.approvalId.localeCompare(b.approvalId));
      if (new Set(targets.map((target) => target.approvalId)).size !== targets.length) throw new BusinessError('invalid_input');
      const fingerprint = createHash('sha256').update(JSON.stringify({ mode: input.mode, targets })).digest('hex');
      return atomic(db, () => {
        const previous = one<{ id: string; payload_fingerprint: string }>(db,
          "SELECT id,payload_fingerprint FROM command_requests WHERE scope='publish' AND request_key=?", input.requestKey);
        if (previous) {
          if (previous.payload_fingerprint !== fingerprint) throw new BusinessError('idempotency_conflict');
          return { requestId: previous.id, replayed: true,
            jobs: db.prepare('SELECT * FROM publish_jobs WHERE request_id=? ORDER BY approval_id').all(previous.id) as unknown as StoredJob[] };
        }
        for (const target of targets) {
          const problem = readiness(db, snapshot(db, target.approvalId), input.mode);
          if (problem) throw new BusinessError(problem.code);
        }
        const requestId = randomUUID(); const now = clock();
        db.prepare("INSERT INTO command_requests(id,scope,request_key,payload_fingerprint,created_at) VALUES(?,'publish',?,?,?)")
          .run(requestId, input.requestKey, fingerprint, now);
        const ids = targets.map((target) => {
          const id = randomUUID();
          db.prepare('INSERT INTO publish_jobs(id,request_id,approval_id,scheduled_at,created_at) VALUES(?,?,?,?,?)')
            .run(id, requestId, target.approvalId, target.scheduledAt, now);
          return id;
        });
        return { requestId, replayed: false, jobs: ids.map(get) };
      });
    },

    claimNext(workerId: string, integrationMode: IntegrationMode = 'fake', leaseMs = 30_000): JobClaim | undefined {
      text(workerId, 200); mode(integrationMode);
      if (!Number.isSafeInteger(leaseMs) || leaseMs < 1 || leaseMs > 300_000) throw new BusinessError('invalid_input');
      return atomic(db, () => {
        const now = clock(); const expires = timestamp(now + leaseMs);
        const due = db.prepare(`SELECT j.id FROM publish_jobs j JOIN approvals a ON a.id=j.approval_id
          WHERE j.status='queued' AND j.scheduled_at<=? AND a.mode=? ORDER BY j.scheduled_at,j.id LIMIT 100`)
          .all(now, integrationMode) as { id: string }[];
        for (const candidate of due) {
          const job = get(candidate.id);
          const problem = readiness(db, snapshot(db, job.approval_id), integrationMode);
          if (problem) {
            db.prepare("UPDATE publish_jobs SET status=? WHERE id=? AND status='queued'").run(problem.status, job.id);
            continue;
          }
          const changed = db.prepare(`UPDATE publish_jobs SET status='running',claim_owner_id=?,
            claim_generation=claim_generation+1,claimed_at=?,claim_expires_at=? WHERE id=? AND status='queued'`)
            .run(workerId, now, expires, job.id).changes;
          if (changed !== 1) continue;
          const attemptId = randomUUID();
          db.prepare(`INSERT INTO publish_attempts(id,job_id,attempt_no,started_at)
            SELECT ?,?,COALESCE(MAX(attempt_no),0)+1,? FROM publish_attempts WHERE job_id=?`)
            .run(attemptId, job.id, now, job.id);
          return { jobId: job.id, workerId, generation: job.claim_generation + 1, attemptId };
        }
      });
    },

    getApprovedSnapshot(claim: JobClaim) {
      return atomic(db, () => {
        const { job } = owned(claim, clock());
        const row = snapshot(db, job.approval_id);
        const problem = readiness(db, row, row.mode);
        if (problem) throw new BusinessError(problem.code);
        const context: PublishContext = {
          requestId: job.request_id, approvalId: row.approval_id, contentVersionId: row.content_version_id,
          expectedIdentity: row.channel === 'page'
            ? { kind: 'page', localId: row.page_connection_id ?? '', remoteId: row.page_remote_id ?? '' }
            : { kind: 'account', localId: row.account_id ?? '', remoteId: row.identity_remote_id ?? '' },
          destination: { channel: row.channel, remoteId: row.external_id ?? '' },
        };
        // Return managed metadata only. MediaStore must resolve/verify actual files later.
        return { jobId: job.id, destinationId: row.destination_id, caption: row.caption,
          mode: row.mode, context, media: selectedMedia(db, row.content_version_id) };
      });
    },

    markSendStarted(claim: JobClaim): void {
      const rejection = atomic(db, () => {
        const now = clock(); const { job, attempt } = owned(claim, now);
        if (attempt.send_started_at !== null) throw new BusinessError('invalid_transition');
        const row = snapshot(db, job.approval_id);
        const problem = readiness(db, row, row.mode);
        if (problem || job.stop_requested_at !== null) {
          end(job.id, attempt.id, problem?.status ?? 'cancelled', now);
          return new BusinessError(problem?.code ?? 'invalid_transition');
        }
        db.prepare('UPDATE publish_attempts SET send_started_at=? WHERE id=? AND send_started_at IS NULL').run(now, attempt.id);
      });
      // Eligibility rejection must commit invalidation, then notify the caller.
      if (rejection) throw rejection;
    },

    finish(claim: JobClaim, result: Completion): StoredJob {
      objectInput(result);
      if (!['published', 'pending_approval', 'unknown', 'failed'].includes(result.outcome)
        || !['fake', 'api_response', 'ui_observation'].includes(result.source)) throw new BusinessError('invalid_input');
      if (result.remoteId !== undefined) text(result.remoteId, 500);
      if (result.remoteUrl !== undefined) {
        text(result.remoteUrl, 2000);
        let url: URL;
        try { url = new URL(result.remoteUrl); } catch { throw new BusinessError('invalid_input'); }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
          || [...url.searchParams.keys()].some((key) => /token|pass|secret|key|auth|cookie/i.test(key))) throw new BusinessError('invalid_input');
      }
      if (result.outcome === 'published' && !result.remoteId && !result.remoteUrl) throw new BusinessError('invalid_input');
      if (result.reasonCode !== undefined && !['network_error', 'session_expired', 'checkpoint', 'identity_mismatch',
        'destination_not_allowed', 'media_invalid', 'ui_changed', 'unknown'].includes(result.reasonCode)) throw new BusinessError('invalid_input');
      return atomic(db, () => {
        const now = clock(); const { job, attempt } = owned(claim, now);
        if (result.outcome !== 'failed' && attempt.send_started_at === null) throw new BusinessError('invalid_transition');
        const row = snapshot(db, job.approval_id);
        if ((result.source === 'fake') !== (row.mode === 'fake')) throw new BusinessError('mode_mismatch');
        db.prepare(`INSERT INTO publish_observations(id,attempt_id,outcome,source,remote_id,remote_url,reason_code,observed_at)
          VALUES(?,?,?,?,?,?,?,?)`).run(randomUUID(), attempt.id, result.outcome, result.source,
          result.remoteId ?? null, result.remoteUrl ?? null, result.reasonCode ?? null, now);
        end(job.id, attempt.id, result.outcome, now);
        return get(job.id);
      });
    },

    changeState(jobId: string, expectedStatus: JobStatus, next: 'queued' | 'paused' | 'cancelled'): StoredJob {
      return atomic(db, () => {
        const job = get(jobId);
        if (job.status !== expectedStatus) throw new BusinessError('conflict');
        const allowed = (job.status === 'queued' && (next === 'paused' || next === 'cancelled'))
          || ((job.status === 'paused' || job.status === 'blocked') && (next === 'queued' || next === 'cancelled'))
          || (job.status === 'needs_review' && next === 'cancelled');
        if (!allowed || one(db, 'SELECT id FROM publish_attempts WHERE job_id=? AND send_started_at IS NOT NULL', job.id)) {
          throw new BusinessError('invalid_transition');
        }
        if (next === 'queued') {
          const row = snapshot(db, job.approval_id); const problem = readiness(db, row, row.mode);
          if (problem) throw new BusinessError(problem.code);
          if (job.stop_requested_at !== null) throw new BusinessError('invalid_transition');
        }
        db.prepare('UPDATE publish_jobs SET status=? WHERE id=? AND status=?').run(next, job.id, expectedStatus);
        return get(job.id);
      });
    },

    requestStop(jobId: string): void {
      atomic(db, () => {
        const job = get(jobId);
        if (job.status !== 'running') throw new BusinessError('invalid_transition');
        db.prepare('UPDATE publish_jobs SET stop_requested_at=COALESCE(stop_requested_at,?) WHERE id=?').run(clock(), job.id);
      });
    },

    recoverExpired(integrationMode: IntegrationMode = 'fake'): { paused: number; unknown: number } {
      mode(integrationMode);
      return atomic(db, () => {
        const now = clock(); const counts = { paused: 0, unknown: 0 };
        const expired = db.prepare(`SELECT j.id FROM publish_jobs j JOIN approvals a ON a.id=j.approval_id
          WHERE j.status='running' AND j.claim_expires_at<=? AND a.mode=? ORDER BY j.id LIMIT 100`).all(now, integrationMode) as { id: string }[];
        for (const job of expired) {
          const attempt = one<Attempt>(db, `SELECT id,job_id,send_started_at,finished_at FROM publish_attempts
            WHERE job_id=? AND finished_at IS NULL ORDER BY attempt_no DESC LIMIT 1`, job.id);
          if (!attempt) throw new BusinessError('invalid_transition');
          const status = attempt.send_started_at === null ? 'paused' : 'unknown';
          end(job.id, attempt.id, status, now); counts[status]++;
          db.prepare("INSERT INTO activity_log(id,job_id,severity,action_code,reason_code,occurred_at) VALUES(?,?,'warn',?,?,?)")
            .run(randomUUID(), job.id, 'claim_recovered', status === 'unknown' ? 'expired_after_send' : 'expired_before_send', now);
        }
        return counts;
      });
    },
  };
}
