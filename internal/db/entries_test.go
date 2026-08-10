package db

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Integration tests against a live database (docker compose up -d db).
func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func TestListEntriesSearch(t *testing.T) {
	pool := testPool(t)
	list, err := ListEntries(context.Background(), pool, EntryFilter{Q: "test", Page: 1, Limit: 20})
	if err != nil {
		t.Fatalf("ListEntries: %v", err)
	}
	if list.Total != 1 || len(list.Items) != 1 {
		t.Fatalf("total=%d items=%d, want 1/1", list.Total, len(list.Items))
	}
}

func TestListEntriesFilters(t *testing.T) {
	pool := testPool(t)
	list, err := ListEntries(context.Background(), pool, EntryFilter{Status: "ready", Page: 1, Limit: 20})
	if err != nil {
		t.Fatalf("ListEntries: %v", err)
	}
	if list.Total < 1 {
		t.Fatalf("expected at least one ready entry")
	}
	for _, e := range list.Items {
		if e.Status != StatusReady {
			t.Fatalf("status filter violated: %s", e.Status)
		}
	}
}
