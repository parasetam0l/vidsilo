package db

import (
	"context"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"
)

// advisoryLockKey serializes bootstrap (migrations + seeds) across
// concurrently booting app/worker nodes sharing one Postgres.
const advisoryLockKey = 0x766f6461 // "voda"

// withBootstrapLock acquires a dedicated pool connection and the bootstrap
// advisory lock, runs fn, then releases both. Multiple nodes booting at once
// queue up here instead of racing CREATE TABLE / seed inserts.
func withBootstrapLock(ctx context.Context, pool *pgxpool.Pool, fn func(conn *pgxpool.Conn) error) error {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()
	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock($1)`, advisoryLockKey); err != nil {
		return err
	}
	defer conn.Exec(context.Background(), `SELECT pg_advisory_unlock($1)`, advisoryLockKey)
	return fn(conn)
}

// MustSeed runs migrations and seeds for the server/worker startup path,
// serialized across nodes via the bootstrap advisory lock.
func MustSeed(ctx context.Context, pool *pgxpool.Pool, log *slog.Logger) {
	if log == nil {
		log = slog.Default()
	}
	err := withBootstrapLock(ctx, pool, func(conn *pgxpool.Conn) error {
		if err := migrateOnConn(ctx, conn); err != nil {
			return err
		}
		if err := seedSettings(ctx, conn); err != nil {
			return err
		}
		if err := seedFlavors(ctx, conn); err != nil {
			return err
		}
		return seedAdmin(ctx, conn, log)
	})
	if err != nil {
		log.Error("bootstrap failed", "err", err)
		panic(err)
	}
}
