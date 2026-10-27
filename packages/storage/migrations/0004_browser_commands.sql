-- Lệnh điều khiển trình duyệt từ server sang worker (P03.3-P03.5): đăng nhập tay và kiểm tra phiên.
-- Chỉ worker được điều khiển Playwright; server chỉ ghi lệnh vào đây. Mỗi tài khoản tối đa MỘT lệnh đang chờ/đang chạy.
CREATE TABLE browser_commands (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('login','verify')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  result_code TEXT CHECK (result_code IS NULL OR length(trim(result_code)) > 0),
  requested_at INTEGER NOT NULL CHECK (requested_at >= 0),
  claimed_by TEXT,
  claimed_at INTEGER CHECK (claimed_at >= requested_at),
  heartbeat_at INTEGER CHECK (heartbeat_at >= claimed_at),
  cancel_requested_at INTEGER CHECK (cancel_requested_at >= requested_at),
  finished_at INTEGER CHECK (finished_at >= requested_at),
  CHECK (status != 'running' OR (claimed_by IS NOT NULL AND claimed_at IS NOT NULL)),
  CHECK (status NOT IN ('succeeded','failed','cancelled') OR (finished_at IS NOT NULL AND result_code IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX browser_commands_one_active ON browser_commands(account_id) WHERE status IN ('queued','running');
CREATE INDEX browser_commands_account_recent ON browser_commands(account_id, requested_at);
CREATE TRIGGER browser_commands_identity_no_update BEFORE UPDATE OF id, account_id, kind, requested_at ON browser_commands
BEGIN SELECT RAISE(ABORT, 'immutable browser command'); END;
CREATE TRIGGER browser_commands_no_delete BEFORE DELETE ON browser_commands BEGIN SELECT RAISE(ABORT, 'browser commands are history'); END;
