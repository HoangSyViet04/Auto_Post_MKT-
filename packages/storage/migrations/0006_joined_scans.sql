-- Durable, cancellable scans; existing group data is never removed by a partial scan.
ALTER TABLE scan_runs ADD COLUMN claimed_by TEXT;
ALTER TABLE scan_runs ADD COLUMN heartbeat_at INTEGER;
ALTER TABLE scan_runs ADD COLUMN cancel_requested_at INTEGER;
ALTER TABLE scan_runs ADD COLUMN without_id_count INTEGER NOT NULL DEFAULT 0 CHECK (without_id_count >= 0);
CREATE UNIQUE INDEX scan_runs_one_active_joined ON scan_runs(account_id)
  WHERE mode='joined' AND status IN ('queued','running');
