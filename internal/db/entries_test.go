package db

import (
	"context"
	"testing"

	"github.com/parasetam0l/vidsilo/internal/testdb"
)

// Integration tests against a live database (docker compose up -d db).

func TestListEntriesSearch(t *testing.T) {
	ctx := context.Background()
	pool := testdb.Pool(t)
	if err := Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO entries (title, description, status) VALUES ('The Test Video', 'a searchable description', 'ready')`); err != nil {
		t.Fatal(err)
	}

	list, err := ListEntries(ctx, pool, EntryFilter{Q: "test", Page: 1, Limit: 20})
	if err != nil {
		t.Fatalf("ListEntries: %v", err)
	}
	if list.Total != 1 || len(list.Items) != 1 {
		t.Fatalf("total=%d items=%d, want 1/1", list.Total, len(list.Items))
	}
}

func TestListEntriesFilters(t *testing.T) {
	ctx := context.Background()
	pool := testdb.Pool(t)
	if err := Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	for _, status := range []EntryStatus{StatusReady, StatusFailed, StatusReady} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO entries (title, status) VALUES ('filter-me', $1)`, status); err != nil {
			t.Fatal(err)
		}
	}

	list, err := ListEntries(ctx, pool, EntryFilter{Status: "ready", Page: 1, Limit: 20})
	if err != nil {
		t.Fatalf("ListEntries: %v", err)
	}
	if list.Total != 2 {
		t.Fatalf("ready total = %d, want 2", list.Total)
	}
	for _, e := range list.Items {
		if e.Status != StatusReady {
			t.Fatalf("status filter violated: %s", e.Status)
		}
	}

	failed, err := ListEntries(ctx, pool, EntryFilter{Status: "failed", Page: 1, Limit: 20})
	if err != nil {
		t.Fatal(err)
	}
	if failed.Total != 1 {
		t.Fatalf("failed total = %d, want 1", failed.Total)
	}
}
