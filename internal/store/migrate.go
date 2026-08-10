package store

import (
	"context"
	"fmt"
	"sync"
)

type MigrateOptions struct {
	Workers int
	Force   bool
	Prune   bool
}

type MigrateResult struct {
	Copied  int
	Skipped int
	Failed  int
}

// Migrate copies every key under EntriesRoot from src to dst, preserving the
// key space (the DB catalog stays untouched). Idempotent: existing target keys
// are skipped unless Force. With Prune, verified source keys are deleted.
func Migrate(ctx context.Context, src, dst Store, opts MigrateOptions) (MigrateResult, error) {
	if opts.Workers <= 0 {
		opts.Workers = 4
	}
	keys, err := src.List(ctx, EntriesRoot)
	if err != nil {
		return MigrateResult{}, fmt.Errorf("migrate: list source: %w", err)
	}

	var res MigrateResult
	keyCh := make(chan string)
	var wg sync.WaitGroup
	var mu sync.Mutex

	worker := func() {
		defer wg.Done()
		for key := range keyCh {
			ok, err := migrateKey(ctx, src, dst, key, opts.Force, opts.Prune)
			mu.Lock()
			switch {
			case err != nil:
				res.Failed++
			case ok:
				res.Copied++
			default:
				res.Skipped++
			}
			mu.Unlock()
		}
	}

	for i := 0; i < opts.Workers; i++ {
		wg.Add(1)
		go worker()
	}
	for _, k := range keys {
		select {
		case keyCh <- k:
		case <-ctx.Done():
			close(keyCh)
			wg.Wait()
			return res, ctx.Err()
		}
	}
	close(keyCh)
	wg.Wait()
	return res, nil
}

// migrateKey returns (copied, err); copied=false means skipped.
func migrateKey(ctx context.Context, src, dst Store, key string, force, prune bool) (bool, error) {
	if !force {
		if _, err := dst.Stat(ctx, key); err == nil {
			return false, nil
		}
	}
	rc, err := src.Open(ctx, key)
	if err != nil {
		return false, err
	}
	defer rc.Close()
	fi, err := src.Stat(ctx, key)
	if err != nil {
		return false, err
	}
	if err := dst.Put(ctx, key, rc, fi.Size); err != nil {
		return false, err
	}
	if prune {
		if err := src.Delete(ctx, key); err != nil {
			return true, err
		}
	}
	return true, nil
}
