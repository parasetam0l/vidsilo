// Package testdb provides a per-process Postgres schema for integration
// tests, so packages running in parallel never collide on shared tables.
package testdb

import (
	"context"
	"fmt"
	"os"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Pool opens a pool scoped to a schema unique to this test process
// (test_<pid>), drops the schema on cleanup, and skips when DATABASE_URL is
// unset. Migrations and seeds run inside that schema via search_path.
func Pool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set")
	}
	ctx := context.Background()
	schema := fmt.Sprintf("test_%d", os.Getpid())

	admin, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	// Ensure pg_trgm exists in public BEFORE the per-process schema exists:
	// CREATE EXTENSION with search_path=test_x,public would otherwise plant
	// gin_trgm_ops inside whichever test process runs migration 0005 first,
	// and the other parallel processes could then not resolve it. The admin
	// connection uses the default search_path, so the extension lands in
	// public and every isolated schema resolves it via the fallback.
	if _, err := admin.Exec(ctx, `CREATE EXTENSION IF NOT EXISTS pg_trgm`); err != nil {
		admin.Close(ctx)
		t.Fatal(err)
	}
	if _, err := admin.Exec(ctx, `CREATE SCHEMA IF NOT EXISTS `+schema); err != nil {
		admin.Close(ctx)
		t.Fatal(err)
	}
	admin.Close(ctx)

	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	// Search the per-process schema first, falling back to public so
	// extension objects (e.g. pg_trgm's gin_trgm_ops) resolve inside the
	// isolated schema migrations.
	cfg.ConnConfig.RuntimeParams["search_path"] = schema + ", public"
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Close()
		admin, err := pgx.Connect(context.Background(), dsn)
		if err == nil {
			_, _ = admin.Exec(context.Background(), `DROP SCHEMA IF EXISTS `+schema+` CASCADE`)
			admin.Close(context.Background())
		}
	})
	return pool
}
