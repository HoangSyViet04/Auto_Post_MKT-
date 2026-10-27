-- Offline data foundation only. No account, credentials, jobs or capabilities are seeded.
-- All entity IDs are application-generated UUID TEXT; times are UTC epoch milliseconds.
CREATE TABLE secret_refs (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  provider TEXT NOT NULL CHECK (length(provider) > 0),
  reference_id TEXT NOT NULL CHECK (length(reference_id) > 0),
  status TEXT NOT NULL DEFAULT 'unconfigured' CHECK (status IN ('unconfigured','available','lost','revoked')),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  UNIQUE (provider, reference_id)
) STRICT;

CREATE TABLE proxies (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  label TEXT NOT NULL CHECK (length(trim(label)) > 0),
  protocol TEXT NOT NULL CHECK (protocol IN ('http','https','socks5')),
  host TEXT NOT NULL CHECK (length(trim(host)) > 0),
  port INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
  secret_ref_id TEXT REFERENCES secret_refs(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  archived_at INTEGER CHECK (archived_at >= created_at)
) STRICT;

CREATE TABLE accounts (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  label TEXT NOT NULL CHECK (length(trim(label)) > 0),
  slot INTEGER NOT NULL CHECK (slot IN (1,2)),
  current_identity_id TEXT,
  session_status TEXT NOT NULL DEFAULT 'unknown' CHECK (session_status IN ('unknown','logged_in','login_required','verification_required','network_error')),
  paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0,1)),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  archived_at INTEGER CHECK (archived_at >= created_at),
  FOREIGN KEY (current_identity_id, id) REFERENCES account_identities(id, account_id) ON DELETE RESTRICT
) STRICT;
CREATE UNIQUE INDEX accounts_active_slot ON accounts(slot) WHERE archived_at IS NULL;

CREATE TABLE account_identities (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0),
  remote_identity_id TEXT NOT NULL CHECK (length(trim(remote_identity_id)) > 0),
  display_name TEXT,
  confirmed_at INTEGER NOT NULL CHECK (confirmed_at >= 0),
  UNIQUE (account_id, version),
  UNIQUE (id, account_id)
) STRICT;

CREATE TABLE browser_profiles (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  account_id TEXT NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE RESTRICT,
  directory_key TEXT NOT NULL UNIQUE CHECK (length(directory_key) = 36),
  proxy_id TEXT REFERENCES proxies(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
) STRICT;

CREATE TABLE destinations (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  channel TEXT NOT NULL CHECK (channel IN ('profile','group','page')),
  external_id TEXT CHECK (external_id IS NULL OR length(trim(external_id)) > 0),
  canonical_url TEXT CHECK (canonical_url IS NULL OR length(trim(canonical_url)) > 0),
  name TEXT,
  topic TEXT,
  region TEXT,
  rules_note TEXT,
  approval_required TEXT NOT NULL DEFAULT 'unknown' CHECK (approval_required IN ('unknown','required','not_required')),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  archived_at INTEGER CHECK (archived_at >= created_at),
  CHECK (external_id IS NOT NULL OR canonical_url IS NOT NULL),
  UNIQUE (id, channel),
  UNIQUE (id, external_id)
) STRICT;
CREATE UNIQUE INDEX destinations_external_id ON destinations(channel, external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX destinations_canonical_url ON destinations(channel, canonical_url) WHERE canonical_url IS NOT NULL;

CREATE TABLE account_destinations (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  destination_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('profile','group')),
  membership_status TEXT NOT NULL DEFAULT 'unknown' CHECK (membership_status IN ('unknown','joined','not_joined','not_applicable')),
  posting_permission TEXT NOT NULL DEFAULT 'unknown' CHECK (posting_permission IN ('unknown','allowed','denied')),
  source TEXT NOT NULL CHECK (source IN ('manual','joined_scan','keyword_scan','verified_ui','fixture')),
  checked_at INTEGER CHECK (checked_at >= 0),
  PRIMARY KEY (account_id, destination_id),
  FOREIGN KEY (destination_id, channel) REFERENCES destinations(id, channel) ON DELETE RESTRICT
) STRICT;

CREATE TABLE page_connections (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  destination_id TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'page' CHECK (channel = 'page'),
  remote_identity_id TEXT NOT NULL CHECK (length(trim(remote_identity_id)) > 0),
  secret_ref_id TEXT REFERENCES secret_refs(id) ON DELETE RESTRICT,
  permission_status TEXT NOT NULL DEFAULT 'unknown' CHECK (permission_status IN ('unknown','allowed','denied','expired')),
  checked_at INTEGER CHECK (checked_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  archived_at INTEGER CHECK (archived_at >= created_at),
  UNIQUE (destination_id),
  UNIQUE (id, destination_id),
  FOREIGN KEY (destination_id, channel) REFERENCES destinations(id, channel) ON DELETE RESTRICT,
  FOREIGN KEY (destination_id, remote_identity_id) REFERENCES destinations(id, external_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE products (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  code TEXT NOT NULL UNIQUE CHECK (length(trim(code)) > 0),
  status TEXT NOT NULL DEFAULT 'selling' CHECK (status IN ('selling','sold','archived')),
  current_revision_id TEXT,
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  FOREIGN KEY (current_revision_id, id) REFERENCES product_revisions(id, product_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE product_revisions (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  revision_no INTEGER NOT NULL CHECK (revision_no > 0),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  condition_text TEXT NOT NULL CHECK (length(trim(condition_text)) > 0),
  price_vnd INTEGER CHECK (price_vnd > 0),
  capacity_text TEXT,
  battery_text TEXT,
  warranty_text TEXT,
  location_text TEXT,
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  UNIQUE (product_id, revision_no),
  UNIQUE (id, product_id)
) STRICT;

CREATE TABLE media (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  storage_key TEXT NOT NULL UNIQUE CHECK (length(storage_key) = 36),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  mime_type TEXT NOT NULL CHECK (length(mime_type) > 0),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  state TEXT NOT NULL DEFAULT 'staging' CHECK (state IN ('staging','ready','missing','failed')),
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
) STRICT;
CREATE INDEX media_sha256 ON media(sha256);

CREATE TABLE product_revision_media (
  product_revision_id TEXT NOT NULL REFERENCES product_revisions(id) ON DELETE RESTRICT,
  media_id TEXT NOT NULL REFERENCES media(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL CHECK (position >= 0),
  PRIMARY KEY (product_revision_id, media_id),
  UNIQUE (product_revision_id, position)
) STRICT;

CREATE TABLE content_versions (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  product_revision_id TEXT NOT NULL REFERENCES product_revisions(id) ON DELETE RESTRICT,
  destination_id TEXT REFERENCES destinations(id) ON DELETE RESTRICT,
  caption TEXT NOT NULL CHECK (length(trim(caption)) > 0),
  source TEXT NOT NULL CHECK (source IN ('template','manual','llm')),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  UNIQUE (id, destination_id),
  UNIQUE (id, product_revision_id)
) STRICT;

CREATE TABLE content_version_media (
  content_version_id TEXT NOT NULL,
  product_revision_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  PRIMARY KEY (content_version_id, media_id),
  UNIQUE (content_version_id, position),
  FOREIGN KEY (content_version_id, product_revision_id) REFERENCES content_versions(id, product_revision_id) ON DELETE RESTRICT,
  FOREIGN KEY (product_revision_id, media_id) REFERENCES product_revision_media(product_revision_id, media_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE approvals (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  content_version_id TEXT NOT NULL,
  destination_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('profile','group','page')),
  account_id TEXT,
  account_identity_id TEXT,
  page_connection_id TEXT,
  mode TEXT NOT NULL CHECK (mode IN ('fake','live')),
  approved_at INTEGER NOT NULL CHECK (approved_at >= 0),
  CHECK ((channel IN ('profile','group') AND account_id IS NOT NULL AND account_identity_id IS NOT NULL AND page_connection_id IS NULL)
    OR (channel = 'page' AND account_id IS NULL AND account_identity_id IS NULL AND page_connection_id IS NOT NULL)),
  FOREIGN KEY (content_version_id, destination_id) REFERENCES content_versions(id, destination_id) ON DELETE RESTRICT,
  FOREIGN KEY (destination_id, channel) REFERENCES destinations(id, channel) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, destination_id) REFERENCES account_destinations(account_id, destination_id) ON DELETE RESTRICT,
  FOREIGN KEY (account_identity_id, account_id) REFERENCES account_identities(id, account_id) ON DELETE RESTRICT,
  FOREIGN KEY (page_connection_id, destination_id) REFERENCES page_connections(id, destination_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE approval_revocations (
  approval_id TEXT PRIMARY KEY REFERENCES approvals(id) ON DELETE RESTRICT,
  reason_code TEXT NOT NULL CHECK (length(trim(reason_code)) > 0),
  revoked_at INTEGER NOT NULL CHECK (revoked_at >= 0)
) STRICT;

CREATE TABLE command_requests (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  scope TEXT NOT NULL CHECK (length(trim(scope)) > 0),
  request_key TEXT NOT NULL CHECK (length(trim(request_key)) > 0),
  payload_fingerprint TEXT NOT NULL CHECK (length(payload_fingerprint) = 64),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  UNIQUE (scope, request_key)
) STRICT;

CREATE TABLE publish_jobs (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  request_id TEXT NOT NULL REFERENCES command_requests(id) ON DELETE RESTRICT,
  approval_id TEXT NOT NULL REFERENCES approvals(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','published','pending_approval','paused','blocked','needs_review','unknown','failed','cancelled')),
  scheduled_at INTEGER NOT NULL CHECK (scheduled_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  claim_owner_id TEXT,
  claim_generation INTEGER NOT NULL DEFAULT 0 CHECK (claim_generation >= 0),
  claimed_at INTEGER CHECK (claimed_at >= 0),
  claim_expires_at INTEGER CHECK (claim_expires_at >= claimed_at),
  stop_requested_at INTEGER CHECK (stop_requested_at >= 0),
  CHECK (status != 'running' OR (claim_owner_id IS NOT NULL AND claim_generation > 0 AND claimed_at IS NOT NULL AND claim_expires_at IS NOT NULL)),
  UNIQUE (request_id, approval_id)
) STRICT;
CREATE INDEX publish_jobs_due ON publish_jobs(scheduled_at, id) WHERE status = 'queued';
CREATE INDEX publish_jobs_approval_status ON publish_jobs(approval_id, status);

CREATE TABLE publish_attempts (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  job_id TEXT NOT NULL REFERENCES publish_jobs(id) ON DELETE RESTRICT,
  attempt_no INTEGER NOT NULL CHECK (attempt_no > 0),
  started_at INTEGER NOT NULL CHECK (started_at >= 0),
  send_started_at INTEGER CHECK (send_started_at >= started_at),
  finished_at INTEGER CHECK (finished_at >= started_at AND (send_started_at IS NULL OR finished_at >= send_started_at)),
  UNIQUE (job_id, attempt_no)
) STRICT;

CREATE TABLE publish_observations (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  attempt_id TEXT NOT NULL REFERENCES publish_attempts(id) ON DELETE RESTRICT,
  outcome TEXT NOT NULL CHECK (outcome IN ('published','pending_approval','unknown','failed','not_found')),
  source TEXT NOT NULL CHECK (source IN ('fake','api_response','ui_observation','manual')),
  remote_id TEXT CHECK (remote_id IS NULL OR length(trim(remote_id)) > 0),
  remote_url TEXT CHECK (remote_url IS NULL OR length(trim(remote_url)) > 0),
  reason_code TEXT,
  observed_at INTEGER NOT NULL CHECK (observed_at >= 0),
  CHECK (outcome != 'published' OR remote_id IS NOT NULL OR remote_url IS NOT NULL)
) STRICT;
CREATE INDEX publish_observations_attempt_time ON publish_observations(attempt_id, observed_at, id);

CREATE TABLE resource_leases (
  resource_key TEXT PRIMARY KEY,
  resource_kind TEXT NOT NULL CHECK (resource_kind IN ('browser','page')),
  account_id TEXT REFERENCES accounts(id) ON DELETE RESTRICT,
  page_connection_id TEXT REFERENCES page_connections(id) ON DELETE RESTRICT,
  owner_id TEXT,
  fence INTEGER NOT NULL CHECK (fence > 0),
  expires_at INTEGER NOT NULL CHECK (expires_at >= 0),
  CHECK ((resource_kind = 'browser' AND account_id IS NOT NULL AND page_connection_id IS NULL AND resource_key = 'browser:' || account_id)
    OR (resource_kind = 'page' AND account_id IS NULL AND page_connection_id IS NOT NULL AND resource_key = 'page:' || page_connection_id))
) STRICT;
CREATE INDEX resource_leases_expiry ON resource_leases(expires_at);

CREATE TABLE scan_runs (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  account_identity_id TEXT,
  mode TEXT NOT NULL CHECK (mode IN ('joined','keyword')),
  keyword TEXT,
  result_limit INTEGER NOT NULL CHECK (result_limit BETWEEN 1 AND 10000),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','partial','stopped','blocked','failed')),
  simulated INTEGER NOT NULL CHECK (simulated IN (0,1)),
  started_at INTEGER CHECK (started_at >= 0),
  finished_at INTEGER CHECK (finished_at >= started_at),
  reason_code TEXT,
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  CHECK (mode != 'keyword' OR (keyword IS NOT NULL AND length(trim(keyword)) > 0)),
  FOREIGN KEY (account_identity_id, account_id) REFERENCES account_identities(id, account_id) ON DELETE RESTRICT
) STRICT;
CREATE INDEX scan_runs_account_status ON scan_runs(account_id, status, created_at);

CREATE TABLE scan_results (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  scan_run_id TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE RESTRICT,
  destination_id TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'group' CHECK (channel = 'group'),
  observed_name TEXT,
  observed_url TEXT,
  observed_external_id TEXT,
  member_count INTEGER CHECK (member_count >= 0),
  membership_status TEXT NOT NULL DEFAULT 'unknown' CHECK (membership_status IN ('unknown','joined','not_joined')),
  approval_required TEXT NOT NULL DEFAULT 'unknown' CHECK (approval_required IN ('unknown','required','not_required')),
  observed_at INTEGER NOT NULL CHECK (observed_at >= 0),
  UNIQUE (scan_run_id, destination_id),
  FOREIGN KEY (destination_id, channel) REFERENCES destinations(id, channel) ON DELETE RESTRICT
) STRICT;

CREATE TABLE posting_presets (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  label TEXT NOT NULL CHECK (length(trim(label)) > 0),
  caption_template TEXT,
  schedule_policy_json TEXT CHECK (schedule_policy_json IS NULL OR (json_valid(schedule_policy_json) AND json_type(schedule_policy_json) = 'object')),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  archived_at INTEGER CHECK (archived_at >= created_at)
) STRICT;

CREATE TABLE preset_targets (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  preset_id TEXT NOT NULL REFERENCES posting_presets(id) ON DELETE RESTRICT,
  destination_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('profile','group','page')),
  account_id TEXT,
  page_connection_id TEXT,
  CHECK ((channel IN ('profile','group') AND account_id IS NOT NULL AND page_connection_id IS NULL)
    OR (channel = 'page' AND account_id IS NULL AND page_connection_id IS NOT NULL)),
  FOREIGN KEY (destination_id, channel) REFERENCES destinations(id, channel) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, destination_id) REFERENCES account_destinations(account_id, destination_id) ON DELETE RESTRICT,
  FOREIGN KEY (page_connection_id, destination_id) REFERENCES page_connections(id, destination_id) ON DELETE RESTRICT
) STRICT;
CREATE UNIQUE INDEX preset_targets_account ON preset_targets(preset_id, destination_id, account_id) WHERE account_id IS NOT NULL;
CREATE UNIQUE INDEX preset_targets_page ON preset_targets(preset_id, destination_id, page_connection_id) WHERE page_connection_id IS NOT NULL;

CREATE TABLE activity_log (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  job_id TEXT REFERENCES publish_jobs(id) ON DELETE RESTRICT,
  scan_run_id TEXT REFERENCES scan_runs(id) ON DELETE RESTRICT,
  severity TEXT NOT NULL CHECK (severity IN ('info','warn','error')),
  action_code TEXT NOT NULL CHECK (length(trim(action_code)) > 0),
  reason_code TEXT,
  occurred_at INTEGER NOT NULL CHECK (occurred_at >= 0)
) STRICT;
CREATE INDEX activity_log_time ON activity_log(occurred_at, id);

-- Foreign-key lookup indexes not already covered by a PK/UNIQUE/index prefix.
CREATE INDEX proxies_secret_ref ON proxies(secret_ref_id);
CREATE INDEX accounts_current_identity ON accounts(current_identity_id);
CREATE INDEX browser_profiles_proxy ON browser_profiles(proxy_id);
CREATE INDEX account_destinations_destination ON account_destinations(destination_id);
CREATE INDEX account_destinations_membership ON account_destinations(account_id, membership_status);
CREATE INDEX page_connections_secret_ref ON page_connections(secret_ref_id);
CREATE INDEX products_current_revision ON products(current_revision_id);
CREATE INDEX product_revision_media_media ON product_revision_media(media_id);
CREATE INDEX content_versions_revision ON content_versions(product_revision_id);
CREATE INDEX content_versions_destination ON content_versions(destination_id);
CREATE INDEX content_version_media_revision_media ON content_version_media(product_revision_id, media_id);
CREATE INDEX approvals_content_destination ON approvals(content_version_id, destination_id);
CREATE INDEX approvals_destination ON approvals(destination_id);
CREATE INDEX approvals_account_destination ON approvals(account_id, destination_id);
CREATE INDEX approvals_identity ON approvals(account_identity_id, account_id);
CREATE INDEX approvals_page_destination ON approvals(page_connection_id, destination_id);
CREATE INDEX resource_leases_account ON resource_leases(account_id);
CREATE INDEX resource_leases_page ON resource_leases(page_connection_id);
CREATE INDEX scan_runs_identity ON scan_runs(account_identity_id, account_id);
CREATE INDEX scan_results_destination ON scan_results(destination_id);
CREATE INDEX preset_targets_destination ON preset_targets(destination_id);
CREATE INDEX preset_targets_account_destination ON preset_targets(account_id, destination_id);
CREATE INDEX preset_targets_page_destination ON preset_targets(page_connection_id, destination_id);
CREATE INDEX activity_log_job ON activity_log(job_id);
CREATE INDEX activity_log_scan_run ON activity_log(scan_run_id);

-- Identity, target and content snapshots must not be rewritten under old approvals/jobs.
CREATE TRIGGER account_identities_no_update BEFORE UPDATE ON account_identities BEGIN SELECT RAISE(ABORT, 'immutable account identity'); END;
CREATE TRIGGER account_identities_no_delete BEFORE DELETE ON account_identities BEGIN SELECT RAISE(ABORT, 'immutable account identity'); END;
CREATE TRIGGER destinations_identity_no_update BEFORE UPDATE OF id, channel, external_id, canonical_url ON destinations
WHEN NEW.id IS NOT OLD.id OR NEW.channel IS NOT OLD.channel OR NEW.external_id IS NOT OLD.external_id OR NEW.canonical_url IS NOT OLD.canonical_url
BEGIN SELECT RAISE(ABORT, 'immutable destination identity'); END;
CREATE TRIGGER destinations_no_delete BEFORE DELETE ON destinations BEGIN SELECT RAISE(ABORT, 'immutable destination identity'); END;
CREATE TRIGGER page_connections_identity_no_update BEFORE UPDATE OF id, destination_id, channel, remote_identity_id ON page_connections
WHEN NEW.id IS NOT OLD.id OR NEW.destination_id IS NOT OLD.destination_id OR NEW.channel IS NOT OLD.channel OR NEW.remote_identity_id IS NOT OLD.remote_identity_id
BEGIN SELECT RAISE(ABORT, 'immutable page identity'); END;
CREATE TRIGGER page_connections_no_delete BEFORE DELETE ON page_connections BEGIN SELECT RAISE(ABORT, 'immutable page identity'); END;
CREATE TRIGGER product_revisions_no_update BEFORE UPDATE ON product_revisions BEGIN SELECT RAISE(ABORT, 'immutable product revision'); END;
CREATE TRIGGER product_revisions_no_delete BEFORE DELETE ON product_revisions BEGIN SELECT RAISE(ABORT, 'immutable product revision'); END;
CREATE TRIGGER product_revision_media_no_update BEFORE UPDATE ON product_revision_media BEGIN SELECT RAISE(ABORT, 'immutable revision media'); END;
CREATE TRIGGER product_revision_media_no_delete BEFORE DELETE ON product_revision_media BEGIN SELECT RAISE(ABORT, 'immutable revision media'); END;
CREATE TRIGGER product_revision_media_no_late_insert BEFORE INSERT ON product_revision_media
WHEN EXISTS (SELECT 1 FROM content_versions WHERE product_revision_id = NEW.product_revision_id)
BEGIN SELECT RAISE(ABORT, 'revision media already consumed'); END;
CREATE TRIGGER content_versions_no_update BEFORE UPDATE ON content_versions BEGIN SELECT RAISE(ABORT, 'immutable content version'); END;
CREATE TRIGGER content_versions_no_delete BEFORE DELETE ON content_versions BEGIN SELECT RAISE(ABORT, 'immutable content version'); END;
CREATE TRIGGER content_version_media_no_update BEFORE UPDATE ON content_version_media BEGIN SELECT RAISE(ABORT, 'immutable content media'); END;
CREATE TRIGGER content_version_media_no_delete BEFORE DELETE ON content_version_media BEGIN SELECT RAISE(ABORT, 'immutable content media'); END;
CREATE TRIGGER content_version_media_no_late_insert BEFORE INSERT ON content_version_media
WHEN EXISTS (SELECT 1 FROM approvals WHERE content_version_id = NEW.content_version_id)
BEGIN SELECT RAISE(ABORT, 'content already approved'); END;
CREATE TRIGGER media_identity_no_update BEFORE UPDATE OF id, storage_key, sha256, mime_type, byte_size, created_at ON media
WHEN NEW.id IS NOT OLD.id OR NEW.storage_key IS NOT OLD.storage_key OR NEW.sha256 IS NOT OLD.sha256 OR NEW.mime_type IS NOT OLD.mime_type OR NEW.byte_size IS NOT OLD.byte_size OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'immutable media identity'); END;
CREATE TRIGGER media_no_delete BEFORE DELETE ON media BEGIN SELECT RAISE(ABORT, 'immutable media identity'); END;
CREATE TRIGGER approvals_no_update BEFORE UPDATE ON approvals BEGIN SELECT RAISE(ABORT, 'immutable approval'); END;
CREATE TRIGGER approvals_no_delete BEFORE DELETE ON approvals BEGIN SELECT RAISE(ABORT, 'immutable approval'); END;
CREATE TRIGGER approval_revocations_no_update BEFORE UPDATE ON approval_revocations BEGIN SELECT RAISE(ABORT, 'immutable revocation'); END;
CREATE TRIGGER approval_revocations_no_delete BEFORE DELETE ON approval_revocations BEGIN SELECT RAISE(ABORT, 'immutable revocation'); END;
CREATE TRIGGER command_requests_no_update BEFORE UPDATE ON command_requests BEGIN SELECT RAISE(ABORT, 'immutable request'); END;
CREATE TRIGGER command_requests_no_delete BEFORE DELETE ON command_requests BEGIN SELECT RAISE(ABORT, 'immutable request'); END;
CREATE TRIGGER publish_jobs_identity_no_update BEFORE UPDATE OF id, request_id, approval_id, created_at ON publish_jobs
WHEN NEW.id IS NOT OLD.id OR NEW.request_id IS NOT OLD.request_id OR NEW.approval_id IS NOT OLD.approval_id OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'immutable job intent'); END;
CREATE TRIGGER publish_jobs_no_delete BEFORE DELETE ON publish_jobs BEGIN SELECT RAISE(ABORT, 'durable job intent'); END;
CREATE TRIGGER publish_jobs_no_revoked_approval BEFORE INSERT ON publish_jobs
WHEN EXISTS (SELECT 1 FROM approval_revocations WHERE approval_id = NEW.approval_id)
BEGIN SELECT RAISE(ABORT, 'approval revoked'); END;
CREATE TRIGGER publish_jobs_no_duplicate_request_target BEFORE INSERT ON publish_jobs
WHEN EXISTS (
  SELECT 1 FROM publish_jobs j JOIN approvals old_approval ON old_approval.id = j.approval_id
  JOIN approvals new_approval ON new_approval.id = NEW.approval_id
  WHERE j.request_id = NEW.request_id AND old_approval.id != new_approval.id AND old_approval.destination_id = new_approval.destination_id
    AND old_approval.account_id IS new_approval.account_id AND old_approval.page_connection_id IS new_approval.page_connection_id
)
BEGIN SELECT RAISE(ABORT, 'request already contains target identity'); END;
CREATE TRIGGER publish_attempts_identity_no_update BEFORE UPDATE OF id, job_id, attempt_no, started_at ON publish_attempts
WHEN NEW.id IS NOT OLD.id OR NEW.job_id IS NOT OLD.job_id OR NEW.attempt_no IS NOT OLD.attempt_no OR NEW.started_at IS NOT OLD.started_at
BEGIN SELECT RAISE(ABORT, 'immutable attempt identity'); END;
CREATE TRIGGER publish_attempts_no_delete BEFORE DELETE ON publish_attempts BEGIN SELECT RAISE(ABORT, 'durable publish attempt'); END;
CREATE TRIGGER publish_attempts_send_marker_no_rewrite BEFORE UPDATE OF send_started_at ON publish_attempts
WHEN OLD.send_started_at IS NOT NULL AND NEW.send_started_at IS NOT OLD.send_started_at
BEGIN SELECT RAISE(ABORT, 'send marker already recorded'); END;
CREATE TRIGGER publish_attempts_finish_no_rewrite BEFORE UPDATE OF finished_at ON publish_attempts
WHEN OLD.finished_at IS NOT NULL AND NEW.finished_at IS NOT OLD.finished_at
BEGIN SELECT RAISE(ABORT, 'finish marker already recorded'); END;
CREATE TRIGGER publish_observations_no_update BEFORE UPDATE ON publish_observations BEGIN SELECT RAISE(ABORT, 'immutable observation'); END;
CREATE TRIGGER publish_observations_no_delete BEFORE DELETE ON publish_observations BEGIN SELECT RAISE(ABORT, 'immutable observation'); END;
CREATE TRIGGER resource_leases_no_delete BEFORE DELETE ON resource_leases BEGIN SELECT RAISE(ABORT, 'lease fence must persist'); END;
CREATE TRIGGER resource_leases_fence BEFORE UPDATE ON resource_leases
WHEN NEW.resource_key IS NOT OLD.resource_key OR NEW.resource_kind IS NOT OLD.resource_kind OR NEW.account_id IS NOT OLD.account_id OR NEW.page_connection_id IS NOT OLD.page_connection_id
  OR NEW.fence < OLD.fence OR (NEW.owner_id IS NOT OLD.owner_id AND NEW.fence <= OLD.fence)
BEGIN SELECT RAISE(ABORT, 'invalid lease fence'); END;
CREATE TRIGGER scan_runs_identity_no_update BEFORE UPDATE OF id, account_id, account_identity_id, mode, keyword, result_limit, simulated, created_at ON scan_runs
WHEN NEW.id IS NOT OLD.id OR NEW.account_id IS NOT OLD.account_id OR NEW.account_identity_id IS NOT OLD.account_identity_id OR NEW.mode IS NOT OLD.mode
  OR NEW.keyword IS NOT OLD.keyword OR NEW.result_limit IS NOT OLD.result_limit OR NEW.simulated IS NOT OLD.simulated OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'immutable scan identity'); END;
CREATE TRIGGER scan_runs_no_delete BEFORE DELETE ON scan_runs BEGIN SELECT RAISE(ABORT, 'durable scan run'); END;
CREATE TRIGGER scan_results_no_update BEFORE UPDATE ON scan_results BEGIN SELECT RAISE(ABORT, 'immutable scan result'); END;
CREATE TRIGGER scan_results_no_delete BEFORE DELETE ON scan_results BEGIN SELECT RAISE(ABORT, 'immutable scan result'); END;
CREATE TRIGGER activity_log_no_update BEFORE UPDATE ON activity_log BEGIN SELECT RAISE(ABORT, 'immutable activity log'); END;
CREATE TRIGGER activity_log_no_delete BEFORE DELETE ON activity_log BEGIN SELECT RAISE(ABORT, 'immutable activity log'); END;

CREATE TRIGGER approvals_validate BEFORE INSERT ON approvals BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM content_version_media cm JOIN media m ON m.id = cm.media_id
    WHERE cm.content_version_id = NEW.content_version_id
  ) THEN RAISE(ABORT, 'approval requires media') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM content_version_media cm JOIN media m ON m.id = cm.media_id
    WHERE cm.content_version_id = NEW.content_version_id AND m.state != 'ready'
  ) THEN RAISE(ABORT, 'approval requires ready media') END;
  SELECT CASE WHEN (
    SELECT MAX(position) + 1 != COUNT(*) OR MIN(position) != 0
    FROM content_version_media WHERE content_version_id = NEW.content_version_id
  ) THEN RAISE(ABORT, 'approval requires contiguous media order') END;
  SELECT CASE WHEN NEW.channel IN ('profile','group') AND NOT EXISTS (
    SELECT 1 FROM accounts WHERE id = NEW.account_id AND current_identity_id = NEW.account_identity_id AND archived_at IS NULL
  ) THEN RAISE(ABORT, 'approval requires current account identity') END;
  SELECT CASE WHEN NEW.channel = 'profile' AND NOT EXISTS (
    SELECT 1 FROM account_identities ai JOIN destinations d ON d.external_id = ai.remote_identity_id
    WHERE ai.id = NEW.account_identity_id AND d.id = NEW.destination_id
  ) THEN RAISE(ABORT, 'profile destination identity mismatch') END;
  SELECT CASE WHEN NEW.channel = 'page' AND NOT EXISTS (
    SELECT 1 FROM page_connections WHERE id = NEW.page_connection_id AND archived_at IS NULL
  ) THEN RAISE(ABORT, 'approval requires active page connection') END;
END;

CREATE TRIGGER observations_validate BEFORE INSERT ON publish_observations BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM publish_attempts pa JOIN publish_jobs j ON j.id = pa.job_id JOIN approvals a ON a.id = j.approval_id
    WHERE pa.id = NEW.attempt_id AND ((NEW.source = 'fake' AND a.mode != 'fake') OR (NEW.source IN ('api_response','ui_observation') AND a.mode != 'live'))
  ) THEN RAISE(ABORT, 'observation source mode mismatch') END;
END;
