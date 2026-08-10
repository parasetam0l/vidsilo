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
	raw, err := json.Marshal(payload)
	if err != nil {
		return 0, err
	}
	if maxAttempts <= 0 {
		maxAttempts = 5
	}
	var id int64
	err = q.pool.QueryRow(ctx, `
		INSERT INTO jobs (type, entry_id, payload, max_attempts)
		VALUES ($1, $2, $3::jsonb, $4)
		RETURNING id`, jobType, entryID, raw, maxAttempts).Scan(&id)
	return id, err
}

// Claim atomically marks up to n due jobs as running and returns them.
func (q *Queue) Claim(ctx context.Context, n int) ([]db.Job, error) {
	tx, err := q.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	rows, err := tx.Query(ctx, `
		SELECT id, type, entry_id, payload, status, attempts, max_attempts, coalesce(error, ''), created_at
		FROM jobs
		WHERE status = 'queued' AND run_at <= now()
		ORDER BY id
		LIMIT $1
		FOR UPDATE SKIP LOCKED`, n)
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

	ids := make([]int64, 0, len(jobs))
	for _, j := range jobs {
		ids = append(ids, j.ID)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE jobs SET status = 'running', started_at = now(), attempts = attempts + 1, updated_at = now()
		WHERE id = ANY($1)`, ids); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return jobs, nil
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
		UPDATE jobs SET status = 'done', finished_at = now(), updated_at = now()
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
			UPDATE jobs SET status = 'failed', error = $1, finished_at = now(), updated_at = now()
			WHERE id = $2`, errMsg, jobID)
		return err
	}
	backoff := time.Duration(1<<uint(attempts)) * time.Second
	if backoff > 300*time.Second {
		backoff = 300 * time.Second
	}
	_, err = q.pool.Exec(ctx, `
		UPDATE jobs SET status = 'queued', error = $1, run_at = now() + $2::interval, updated_at = now()
		WHERE id = $3`, errMsg, backoff.String(), jobID)
	return err
}

// RequeueStale reclaims running jobs whose workers died (heartbeat timeout).
func (q *Queue) RequeueStale(ctx context.Context, heartbeat time.Duration) (int64, error) {
	tag, err := q.pool.Exec(ctx, `
		UPDATE jobs SET status = 'queued', started_at = NULL, updated_at = now(),
			run_at = now() + interval '5 seconds'
		WHERE status = 'running' AND started_at < now() - $1::interval`, heartbeat.String())
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}
