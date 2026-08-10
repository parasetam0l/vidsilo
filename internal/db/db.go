// Package db owns the Postgres pool, embedded migrations, and seed data.
package db

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// New opens a pool and verifies connectivity.
func New(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("db: open pool: %w", err)
	}
	pingCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("db: ping: %w", err)
	}
	return pool, nil
}

// Health returns the current connectivity error, or nil.
func Health(ctx context.Context, pool *pgxpool.Pool) error {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	return pool.Ping(ctx)
}

// MustSeed runs migrations and seeds for the server/worker startup path,
// exiting the process on failure.
func MustSeed(ctx context.Context, pool *pgxpool.Pool, log *slog.Logger) {
	if log == nil {
		log = slog.Default()
	}
	if err := Migrate(ctx, pool); err != nil {
		log.Error("migrations failed", "err", err)
		panic(err)
	}
	if err := SeedSettings(ctx, pool); err != nil {
		log.Error("settings seed failed", "err", err)
		panic(err)
	}
	if err := SeedFlavors(ctx, pool); err != nil {
		log.Error("flavors seed failed", "err", err)
		panic(err)
	}
	if err := SeedAdmin(ctx, pool, log); err != nil {
		log.Error("admin seed failed", "err", err)
		panic(err)
	}
}
