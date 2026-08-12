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

	jobs, err := q.Claim(ctx, "test-worker", 10)
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
	if jobs, err := q.Claim(ctx, "test-worker", 10); err != nil || len(jobs) != 1 {
		t.Fatalf("first claim: jobs=%d err=%v", len(jobs), err)
	}
	jobs, err := q.Claim(ctx, "test-worker", 10)
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
	if _, err := q.Claim(ctx, "test-worker", 10); err != nil {
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
	if _, err := q.Claim(ctx, "test-worker", 10); err != nil {
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

	if _, err := q.Claim(ctx, "test-worker", 10); err != nil {
		t.Fatal(err)
	}
	// Pretend the worker died 30 minutes ago (both started_at and the
	// 0009 heartbeat must look stale).
	_, _ = q.pool.Exec(ctx, `UPDATE jobs SET started_at = now() - interval '30 minutes',
		heartbeat_at = now() - interval '30 minutes' WHERE id = $1`, id)
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

func TestQueueClaimTranscodeParallelAcrossEntries(t *testing.T) {
	ctx := context.Background()
	q := New(testdb.Pool(t))

	// Two entries, two flavors each: all four jobs due.
	e1, e2 := testEntryID(t, q.pool), testEntryID(t, q.pool)
	ids := make([]int64, 0, 4)
	for _, eid := range []int64{e1, e2} {
		for _, fid := range []int64{1, 2} {
			id, err := q.Enqueue(ctx, "transcode", eid, map[string]any{"flavorId": fid}, 3)
			if err != nil {
				t.Fatal(err)
			}
			ids = append(ids, id)
		}
	}
	t.Cleanup(func() {
		_, _ = q.pool.Exec(context.Background(), `DELETE FROM jobs WHERE id = ANY($1)`, ids)
	})

	// One claim round must take exactly one flavor per entry (parallel
	// across entries, serial within an entry).
	jobs, err := q.Claim(ctx, "test-worker", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(jobs) != 2 {
		t.Fatalf("claimed %d jobs, want 2 (one per entry)", len(jobs))
	}
	seen := map[int64]bool{}
	for _, j := range jobs {
		if j.EntryID == nil {
			t.Fatal("transcode job without entry")
		}
		if seen[*j.EntryID] {
			t.Fatalf("two flavors of entry %d claimed in one round", *j.EntryID)
		}
		seen[*j.EntryID] = true
	}

	// Finish entry 2's running flavor so its second flavor becomes
	// claimable; entry 1's flavor is still running, which must keep
	// blocking entry 1's second flavor.
	var e2First, e1First int64
	for _, j := range jobs {
		if j.EntryID != nil && *j.EntryID == e2 {
			e2First = j.ID
		} else if j.EntryID != nil {
			e1First = j.ID
		}
	}
	if _, err := q.pool.Exec(ctx, `UPDATE jobs SET status = 'done' WHERE id = $1`, e2First); err != nil {
		t.Fatal(err)
	}

	// Second round: entry 2's second flavor only — entry 1's is still
	// blocked by its running first flavor.
	jobs, err = q.Claim(ctx, "test-worker", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(jobs) != 1 {
		t.Fatalf("second round claimed %d jobs, want 1 (other entry's flavor)", len(jobs))
	}
	if jobs[0].EntryID == nil {
		t.Fatal("transcode job without entry")
	}
	if *jobs[0].EntryID != e2 {
		t.Fatalf("claimed entry %d's second flavor while its first is still running", *jobs[0].EntryID)
	}
	if jobs[0].ID == e2First {
		t.Fatalf("claimed an already-done flavor")
	}
	_ = e1First
}

func TestQueueClaimTranscodeRunsParallelEntries(t *testing.T) {
	ctx := context.Background()
	q := New(testdb.Pool(t))
	e1, e2 := testEntryID(t, q.pool), testEntryID(t, q.pool)
	ids := []int64{}
	for _, eid := range []int64{e1, e2} {
		id, err := q.Enqueue(ctx, "transcode", eid, map[string]any{"flavorId": 1}, 3)
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	t.Cleanup(func() {
		_, _ = q.pool.Exec(context.Background(), `DELETE FROM jobs WHERE id = ANY($1)`, ids)
	})

	// Both entries' first flavors must be claimable together (parallel).
	jobs, err := q.Claim(ctx, "test-worker", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(jobs) != 2 {
		t.Fatalf("claimed %d transcode jobs across two entries, want 2", len(jobs))
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
