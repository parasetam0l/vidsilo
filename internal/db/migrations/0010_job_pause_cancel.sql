-- Job pause/abort: pause_requested_at parks a queued job (not claimed until
-- cleared); cancel_requested_at signals the worker to abort a running job.
-- The status enum gains 'cancelled' (distinct, retryable).
ALTER TABLE jobs
    ADD COLUMN pause_requested_at timestamptz,
    ADD COLUMN cancel_requested_at timestamptz;

ALTER TABLE jobs DROP CONSTRAINT jobs_status_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_status_check
    CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled'));
