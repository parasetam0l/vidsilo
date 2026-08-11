package store

import (
	"context"
	"errors"
	"io"
	"sort"
	"sync/atomic"
)

// Fallback is a read-through wrapper for zero-downtime storage migration: a
// primary store is served normally, and on a miss the object is served from
// a legacy store while being copied into the primary (lazy promotion). An
// operator can switch drivers and let traffic migrate the data instead of
// running a bulk `migrate` first.
type Fallback struct {
	primary  Store
	legacy   Store
	promoted atomic.Int64
}

func NewFallback(primary, legacy Store) *Fallback {
	return &Fallback{primary: primary, legacy: legacy}
}

// Promoted reports how many keys have been lazily copied into the primary.
func (f *Fallback) Promoted() int64 {
	return f.promoted.Load()
}

// Put writes to the primary only — new content never lands in the legacy
// store being migrated away from.
func (f *Fallback) Put(ctx context.Context, key string, r io.Reader, size int64) error {
	return f.primary.Put(ctx, key, r, size)
}

func (f *Fallback) Open(ctx context.Context, key string) (io.ReadSeekCloser, error) {
	rc, err := f.primary.Open(ctx, key)
	if err == nil {
		return rc, nil
	}
	if !errors.Is(err, ErrNotFound) {
		return nil, err
	}

	// Primary miss: serve from the legacy store and promote lazily.
	lrc, err := f.legacy.Open(ctx, key)
	if err != nil {
		return nil, err
	}
	fi, err := f.legacy.Stat(ctx, key)
	if err != nil {
		lrc.Close()
		return nil, err
	}
	if err := f.primary.Put(ctx, key, lrc, fi.Size); err == nil {
		f.promoted.Add(1)
		lrc.Close()
		// Serve the primary copy so the object is coherent from now on.
		return f.primary.Open(ctx, key)
	}
	// Promotion failed (e.g. target temporarily unavailable): still serve
	// the legacy object. The reader was consumed by the failed Put, so
	// reopen it.
	lrc.Close()
	return f.legacy.Open(ctx, key)
}

func (f *Fallback) Stat(ctx context.Context, key string) (FileInfo, error) {
	fi, err := f.primary.Stat(ctx, key)
	if err == nil {
		return fi, nil
	}
	if !errors.Is(err, ErrNotFound) {
		return FileInfo{}, err
	}
	return f.legacy.Stat(ctx, key)
}

// Delete removes from both stores so a deleted object cannot resurface from
// the legacy store on the next read. The legacy delete is best effort.
func (f *Fallback) Delete(ctx context.Context, key string) error {
	err := f.primary.Delete(ctx, key)
	if errors.Is(err, ErrNotFound) {
		err = nil
	}
	_ = f.legacy.Delete(ctx, key)
	return err
}

// List merges both stores so migration tooling sees the full key space
// (keys already promoted appear once).
func (f *Fallback) List(ctx context.Context, prefix string) ([]string, error) {
	pk, err := f.primary.List(ctx, prefix)
	if err != nil {
		return nil, err
	}
	lk, err := f.legacy.List(ctx, prefix)
	if err != nil {
		return nil, err
	}
	seen := make(map[string]struct{}, len(pk)+len(lk))
	out := make([]string, 0, len(pk)+len(lk))
	for _, k := range append(pk, lk...) {
		if _, ok := seen[k]; ok {
			continue
		}
		seen[k] = struct{}{}
		out = append(out, k)
	}
	sort.Strings(out)
	return out, nil
}
