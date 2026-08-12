// Package queue is a hand-rolled Postgres job queue: row-lock claiming
// (SKIP LOCKED), exponential backoff retries, dead-lettering, and stale-job
// reclaim for crashed workers.
package queue

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/parasetam0l/vod-app/internal/db"
)

type Queue struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Queue {
	return &Queue{pool: pool}
}

// Enqueue adds a job (or re-enqueues after a failure retry).
func (q *Queue) Enqueue(ctx context.Context, jobType string, entryID int64, payload any, maxAttempts int) (int64, error) {
	return q.EnqueueAt(ctx, jobType, entryID, payload, maxAttempts, time.Now())
}

// EnqueueAt adds a job scheduled at runAt. Used to stagger serialized job
// kinds (transcode flavors, URL downloads) so they are claimed one at a
// time and honestly show as 'queued' until their turn.
func (q *Queue) EnqueueAt(ctx context.Context, jobType string, entryID int64, payload any, maxAttempts int, runAt time.Time) (int64, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return 0, err
	}
	if maxAttempts <= 0 {
		maxAttempts = 5
	}
	var id int64
	err = q.pool.QueryRow(ctx, `
		INSERT INTO jobs (type, entry_id, payload, max_attempts, run_at)
		VALUES ($1, $2, $3::jsonb, $4, $5)
		RETURNING id`, jobType, entryID, raw, maxAttempts, runAt).Scan(&id)
	return id, err
}

// Claim atomically marks up to n due jobs as running (owned by workerID)
// and returns them. Job types listed in exclude are skipped (the worker
// excludes a serialized kind while one of it executes). Serialized types
// (download) are additionally limited to their earliest queued job per
// round, so a claim can never start more than one of them at a time.
// Transcodes of different entries run in parallel (bounded by the worker
// pool); flavors of the same entry stay ordered per entry.
func (q *Queue) Claim(ctx context.Context, workerID string, n int, exclude ...string) ([]db.Job, error) {
	// pgx encodes a nil []string as SQL NULL, which would turn the
	// exclusion condition NULL and match nothing — normalize to '{}'.
	if exclude == nil {
		exclude = []string{}
	}
	serialized := []string{"download"}
	tx, err := q.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	rows, err := tx.Query(ctx, `
		SELECT id, type, entry_id, payload, status, attempts, max_attempts, coalesce(error, ''), created_at
		FROM jobs j
		WHERE status = 'queued' AND run_at <= now()
		  AND pause_requested_at IS NULL
		  AND (cardinality($2::text[]) = 0 OR NOT (type = ANY($2::text[])))
		  AND (NOT (type = ANY($3::text[]))
		       OR (
		           -- serialized types: claim only when none is running AND
		           -- only the earliest queued one
		           NOT EXISTS (SELECT 1 FROM jobs j2 WHERE j2.type = j.type AND j2.status = 'running')
		           AND NOT EXISTS (SELECT 1 FROM jobs j2
		                           WHERE j2.type = j.type AND j2.status = 'queued' AND j2.id < j.id)
		       ))
		  AND (type <> 'transcode'
		       OR NOT EXISTS (
		           -- per-entry ordering: a flavor may start only when no
		           -- other flavor of the same entry is still running
		           SELECT 1 FROM jobs j2
		           WHERE j2.type = 'transcode' AND j2.status = 'running'
		             AND j2.entry_id = j.entry_id
		       ))
		ORDER BY id
		LIMIT $1
		FOR UPDATE SKIP LOCKED`, n, exclude, serialized)
	if err != nil {
		return nil, err
	}
	var jobs []db.Job
	for rows.Next() {
		var j db.Job
		if err := rows.Scan(&j.ID, &j.Type, &j.EntryID, &j.Payload, &j.Status,
			&j.Attempts, &j.MaxAttempts, &j.Error, &j.CreatedAt); err != nil {
			rows.Close()
			return nil, err
		}
		jobs = append(jobs, j)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(jobs) == 0 {
		return nil, nil
	}

	// Per-entry transcode ordering: rows locked in this same transaction are
	// still 'queued' when the NOT EXISTS subquery ran, so two flavors of one
	// entry could both be claimed in one round. Keep only the earliest
	// transcode per entry; the rest stay queued and are claimed next round.
	seen := map[int64]bool{}
	filtered := jobs[:0]
	for _, j := range jobs {
		if j.Type == "transcode" && j.EntryID != nil {
			if seen[*j.EntryID] {
				continue
			}
			seen[*j.EntryID] = true
		}
		filtered = append(filtered, j)
	}
	jobs = filtered

	ids := make([]int64, 0, len(jobs))
	for _, j := range jobs {
		ids = append(ids, j.ID)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE jobs SET status = 'running', started_at = now(), attempts = attempts + 1,
			worker_id = $2, heartbeat_at = now(), updated_at = now()
		WHERE id = ANY($1)`, ids, workerID); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return jobs, nil
}

// Heartbeat refreshes heartbeat_at for every job this worker currently runs,
// proving the process is alive. Called periodically while working.
func (q *Queue) Heartbeat(ctx context.Context, workerID string) error {
	_, err := q.pool.Exec(ctx, `
		UPDATE jobs SET heartbeat_at = now()
		WHERE worker_id = $1 AND status = 'running'`, workerID)
	return err
}

// Pause parks a queued job so it is not claimed until resumed.
func (q *Queue) Pause(ctx context.Context, jobID int64) error {
	_, err := q.pool.Exec(ctx, `
		UPDATE jobs SET pause_requested_at = now(), updated_at = now()
		WHERE id = $1 AND status = 'queued'`, jobID)
	return err
}

// Resume clears the pause flag so the job becomes claimable again.
func (q *Queue) Resume(ctx context.Context, jobID int64) error {
	_, err := q.pool.Exec(ctx, `
		UPDATE jobs SET pause_requested_at = NULL, updated_at = now()
		WHERE id = $1`, jobID)
	return err
}

// RequestCancel aborts a job: queued jobs are cancelled immediately, running
// jobs get a cancel flag that the worker polls and reacts to.
func (q *Queue) RequestCancel(ctx context.Context, jobID int64) error {
	tx, err := q.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var status string
	if err := tx.QueryRow(ctx,
		`SELECT status FROM jobs WHERE id = $1 FOR UPDATE`, jobID).Scan(&status); err != nil {
		return err
	}
	if status == "queued" {
		_, err = tx.Exec(ctx, `
			UPDATE jobs SET status = 'cancelled', worker_id = NULL, heartbeat_at = NULL,
				error = 'cancelled by user', finished_at = now(), updated_at = now()
			WHERE id = $1`, jobID)
	} else {
		_, err = tx.Exec(ctx, `
			UPDATE jobs SET cancel_requested_at = now(), updated_at = now()
			WHERE id = $1`, jobID)
	}
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// Cancel marks a job as cancelled (worker-side, after the abort flag fired).
func (q *Queue) Cancel(ctx context.Context, jobID int64, reason string) error {
	_, err := q.pool.Exec(ctx, `
		UPDATE jobs SET status = 'cancelled', error = $1, worker_id = NULL,
			heartbeat_at = NULL, cancel_requested_at = NULL, finished_at = now(), updated_at = now()
		WHERE id = $2`, reason, jobID)
	return err
}

// CancelRequested reports whether an abort has been requested for the job.
func (q *Queue) CancelRequested(ctx context.Context, jobID int64) (bool, error) {
	var requested bool
	err := q.pool.QueryRow(ctx, `
		SELECT cancel_requested_at IS NOT NULL FROM jobs WHERE id = $1`, jobID).Scan(&requested)
	return requested, err
}

// Get loads a single job row (for the runner).
func (q *Queue) Get(ctx context.Context, id int64) (db.Job, error) {
	var j db.Job
	err := q.pool.QueryRow(ctx, `
		SELECT id, type, entry_id, payload, status, attempts, max_attempts, coalesce(error, ''), created_at
		FROM jobs WHERE id = $1`, id).
		Scan(&j.ID, &j.Type, &j.EntryID, &j.Payload, &j.Status,
			&j.Attempts, &j.MaxAttempts, &j.Error, &j.CreatedAt)
	return j, err
}

// Done marks a job successful.
func (q *Queue) Done(ctx context.Context, jobID int64) error {
	_, err := q.pool.Exec(ctx, `
		UPDATE jobs SET status = 'done', worker_id = NULL, heartbeat_at = NULL,
			finished_at = now(), updated_at = now()
		WHERE id = $1`, jobID)
	return err
}

// Fail records an error, retrying with exponential backoff until max_attempts,
// then dead-letters the job.
func (q *Queue) Fail(ctx context.Context, jobID int64, errMsg string) error {
	var attempts, maxAttempts int
	err := q.pool.QueryRow(ctx,
		`SELECT attempts, max_attempts FROM jobs WHERE id = $1`, jobID).
		Scan(&attempts, &maxAttempts)
	if err != nil {
		return err
	}
	if attempts >= maxAttempts {
		_, err = q.pool.Exec(ctx, `
			UPDATE jobs SET status = 'failed', worker_id = NULL, heartbeat_at = NULL,
				error = $1, finished_at = now(), updated_at = now()
			WHERE id = $2`, errMsg, jobID)
		return err
	}
	backoff := time.Duration(1<<uint(attempts)) * time.Second
	if backoff > 300*time.Second {
		backoff = 300 * time.Second
	}
	_, err = q.pool.Exec(ctx, `
		UPDATE jobs SET status = 'queued', worker_id = NULL, heartbeat_at = NULL,
			error = $1, run_at = now() + $2::interval, updated_at = now()
		WHERE id = $3`, errMsg, backoff.String(), jobID)
	return err
}

// RequeueStale reclaims running jobs whose worker stopped heartbeating
// (died, restarted, machine reboot). Heartbeat-based, so long-running jobs
// are never falsely reclaimed. Transcode jobs that are requeued also revert
// their flavor status back to 'pending' (it was left 'transcoding' by the
// dead worker).
func (q *Queue) RequeueStale(ctx context.Context, staleAfter time.Duration) (int64, error) {
	tx, err := q.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)

	tag, err := tx.Exec(ctx, `
		UPDATE jobs SET status = 'queued', worker_id = NULL, heartbeat_at = NULL,
			started_at = NULL, updated_at = now(), run_at = now() + interval '5 seconds'
		WHERE status = 'running'
		  AND coalesce(heartbeat_at, started_at) < now() - $1::interval`, staleAfter.String())
	if err != nil {
		return 0, err
	}
	requeued := tag.RowsAffected()
	if requeued > 0 {
		// Any flavor left 'transcoding' by a dead worker goes back to
		// 'pending' so the list reflects reality while it waits in queue.
		if _, err := tx.Exec(ctx, `
			UPDATE entry_flavors ef SET status = 'pending', error = NULL
			WHERE ef.status = 'transcoding'
			  AND NOT EXISTS (
			      SELECT 1 FROM jobs j
			      WHERE j.type = 'transcode' AND j.status = 'running'
			        AND j.entry_id = ef.entry_id
			        AND coalesce((j.payload->>'flavorId')::bigint, -1) = ef.flavor_id
			  )`); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return requeued, nil
}
