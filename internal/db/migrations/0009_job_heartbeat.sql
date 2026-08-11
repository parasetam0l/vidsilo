-- Job liveness: the worker stamps worker_id when claiming a job and refreshes
-- heartbeat_at every 30s while running. The stale checker requeues jobs whose
-- heartbeat stopped (worker died / machine rebooted) — long-running encodes
-- no longer look stale just because they exceed the old fixed timeout.
ALTER TABLE jobs ADD COLUMN worker_id text;
ALTER TABLE jobs ADD COLUMN heartbeat_at timestamptz;
