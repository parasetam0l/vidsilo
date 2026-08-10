package queue

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/parasetam0l/vod-app/internal/db"
	"github.com/parasetam0l/vod-app/internal/testdb"
)


func testEntryID(t *testing.T, pool *pgxpool.Pool) int64 {
	t.Helper()
	ctx := context.Background()
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	var id int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO entries (title) VALUES ('queue-test') RETURNING id`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM entries WHERE id = $1`, id) })
	return id
}

func TestQueueClaimDone(t *testing.T) {
	ctx := context.Background()
	q := New(testdb.Pool(t))

	id, err := q.Enqueue(ctx, "test", testEntryID(t, q.pool), map[string]any{"x": 1}, 3)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = q.pool.Exec(context.Background(), `DELETE FROM jobs WHERE id = $1`, id) })

	jobs, err := q.Claim(ctx, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(jobs) != 1 || jobs[0].ID != id {
		t.Fatalf("claimed %+v, want the enqueued job", jobs)
	}
	if err := q.Done(ctx, id); err != nil {
		t.Fatal(err)
	}
	status := jobStatus(t, q, id)
	if status != "done" {
		t.Fatalf("status = %s, want done", status)
	}
}

func TestQueueClaimIsolation(t *testing.T) {
	ctx := context.Background()
	q := New(testdb.Pool(t))
	id, _ := q.Enqueue(ctx, "test", testEntryID(t, q.pool), nil, 3)
	t.Cleanup(func() { _, _ = q.pool.Exec(context.Background(), `DELETE FROM jobs WHERE id = $1`, id) })

	// First claim takes it; a second claim must not see it (row lock).
	if jobs, err := q.Claim(ctx, 10); err != nil || len(jobs) != 1 {
		t.Fatalf("first claim: jobs=%d err=%v", len(jobs), err)
	}
	jobs, err := q.Claim(ctx, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(jobs) != 0 {
		t.Fatalf("second claim got %d jobs, want 0 (SKIP LOCKED)", len(jobs))
	}
}

func TestQueueRetryBackoffThenDeadLetter(t *testing.T) {
	ctx := context.Background()
	q := New(testdb.Pool(t))
	id, _ := q.Enqueue(ctx, "test", testEntryID(t, q.pool), nil, 2)
	t.Cleanup(func() { _, _ = q.pool.Exec(context.Background(), `DELETE FROM jobs WHERE id = $1`, id) })

	// Fail once -> requeued with run_at in the future.
	if _, err := q.Claim(ctx, 10); err != nil {
		t.Fatal(err)
	}
	if err := q.Fail(ctx, id, "boom"); err != nil {
		t.Fatal(err)
	}
	var runAt time.Time
	if err := q.pool.QueryRow(ctx, `SELECT run_at FROM jobs WHERE id = $1`, id).Scan(&runAt); err != nil {
		t.Fatal(err)
	}
	if !runAt.After(time.Now()) {
		t.Fatalf("expected backoff, run_at = %v", runAt)
	}

	// Force it due, claim, fail again -> dead-lettered.
	_, _ = q.pool.Exec(ctx, `UPDATE jobs SET run_at = now() WHERE id = $1`, id)
	if _, err := q.Claim(ctx, 10); err != nil {
		t.Fatal(err)
	}
	if err := q.Fail(ctx, id, "boom twice"); err != nil {
		t.Fatal(err)
	}
	if status := jobStatus(t, q, id); status != "failed" {
		t.Fatalf("status = %s, want failed", status)
	}
}

func TestRequeueStale(t *testing.T) {
	ctx := context.Background()
	q := New(testdb.Pool(t))
	id, _ := q.Enqueue(ctx, "test", testEntryID(t, q.pool), nil, 3)
	t.Cleanup(func() { _, _ = q.pool.Exec(context.Background(), `DELETE FROM jobs WHERE id = $1`, id) })

	if _, err := q.Claim(ctx, 10); err != nil {
		t.Fatal(err)
	}
	// Pretend the worker died 30 minutes ago.
	_, _ = q.pool.Exec(ctx, `UPDATE jobs SET started_at = now() - interval '30 minutes' WHERE id = $1`, id)
	n, err := q.RequeueStale(ctx, 15*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("requeued %d, want 1", n)
	}
	if status := jobStatus(t, q, id); status != "queued" {
		t.Fatalf("status = %s, want queued", status)
	}
}

func jobStatus(t *testing.T, q *Queue, id int64) string {
	t.Helper()
	var s string
	if err := q.pool.QueryRow(context.Background(), `SELECT status FROM jobs WHERE id = $1`, id).Scan(&s); err != nil {
		t.Fatal(err)
	}
	return s
}
