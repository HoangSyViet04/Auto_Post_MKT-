-- A draw is made once per approved job. Completion/recovery starts a durable rest window.
CREATE TABLE job_posting_intervals (
  job_id TEXT PRIMARY KEY REFERENCES publish_jobs(id),
  min_seconds INTEGER NOT NULL CHECK (min_seconds BETWEEN 0 AND 86400),
  max_seconds INTEGER NOT NULL CHECK (max_seconds BETWEEN min_seconds AND 86400),
  rest_seconds INTEGER NOT NULL CHECK (rest_seconds BETWEEN min_seconds AND max_seconds),
  rest_until INTEGER CHECK (rest_until IS NULL OR rest_until >= 0)
) STRICT;
CREATE TRIGGER job_intervals_no_rewrite BEFORE UPDATE OF job_id,min_seconds,max_seconds,rest_seconds ON job_posting_intervals
BEGIN SELECT RAISE(ABORT, 'immutable posting interval'); END;
CREATE TRIGGER job_intervals_rest_no_rewrite BEFORE UPDATE OF rest_until ON job_posting_intervals
WHEN OLD.rest_until IS NOT NULL AND NEW.rest_until IS NOT OLD.rest_until
BEGIN SELECT RAISE(ABORT, 'immutable rest deadline'); END;
CREATE TRIGGER job_intervals_no_delete BEFORE DELETE ON job_posting_intervals
BEGIN SELECT RAISE(ABORT, 'durable posting interval'); END;
