-- Tìm nhóm theo từ khóa và gửi yêu cầu tham gia (P06.3). Tìm thấy không có nghĩa đã tham gia hay được đăng.
-- Yêu cầu tham gia chỉ sinh từ nhóm người dùng tick, có hạn mức theo tài khoản trong 24 giờ và khoảng cách giữa hai lần gửi.
CREATE UNIQUE INDEX scan_runs_one_active_keyword ON scan_runs(account_id)
  WHERE mode='keyword' AND status IN ('queued','running');

CREATE TABLE group_search_results (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  scan_run_id TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE RESTRICT,
  external_id TEXT NOT NULL CHECK (length(external_id) BETWEEN 5 AND 30 AND external_id NOT GLOB '*[^0-9]*'),
  canonical_url TEXT NOT NULL CHECK (length(canonical_url) <= 500),
  name TEXT,
  privacy TEXT NOT NULL DEFAULT 'unknown' CHECK (privacy IN ('public','private','unknown')),
  member_count INTEGER CHECK (member_count >= 0),
  join_state TEXT NOT NULL DEFAULT 'unknown' CHECK (join_state IN ('can_join','joined','requested','unknown')),
  observed_at INTEGER NOT NULL CHECK (observed_at >= 0),
  UNIQUE (scan_run_id, external_id)
) STRICT;

CREATE TABLE group_join_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  daily_cap INTEGER NOT NULL CHECK (daily_cap BETWEEN 1 AND 30),
  min_gap_seconds INTEGER NOT NULL CHECK (min_gap_seconds BETWEEN 60 AND 3600),
  max_gap_seconds INTEGER NOT NULL CHECK (max_gap_seconds BETWEEN 60 AND 7200),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  CHECK (max_gap_seconds >= min_gap_seconds)
) STRICT;
INSERT INTO group_join_settings(id, daily_cap, min_gap_seconds, max_gap_seconds, updated_at) VALUES (1, 5, 180, 360, 0);

CREATE TABLE group_join_requests (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  batch_id TEXT NOT NULL CHECK (length(batch_id) = 36),
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  account_identity_id TEXT NOT NULL,
  external_id TEXT NOT NULL CHECK (length(external_id) BETWEEN 5 AND 30 AND external_id NOT GLOB '*[^0-9]*'),
  canonical_url TEXT NOT NULL CHECK (length(canonical_url) <= 500),
  name TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','requested','joined','skipped','failed','unknown','cancelled')),
  reason_code TEXT,
  not_before INTEGER NOT NULL CHECK (not_before >= 0),
  claimed_by TEXT,
  heartbeat_at INTEGER,
  send_started_at INTEGER CHECK (send_started_at >= 0),
  cancel_requested_at INTEGER,
  finished_at INTEGER,
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  FOREIGN KEY (account_identity_id, account_id) REFERENCES account_identities(id, account_id) ON DELETE RESTRICT
) STRICT;
-- Một nhóm chỉ có một yêu cầu đang chờ/đang gửi cho mỗi tài khoản: bấm hai lần không tạo hai yêu cầu.
CREATE UNIQUE INDEX group_join_one_active ON group_join_requests(account_id, external_id) WHERE status IN ('queued','running');
CREATE INDEX group_join_account_status ON group_join_requests(account_id, status, not_before);
CREATE INDEX group_join_sent ON group_join_requests(account_id, send_started_at) WHERE send_started_at IS NOT NULL;
