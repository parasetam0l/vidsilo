// Package store defines the storage abstraction and its drivers: local disk,
// S3-compatible object storage, and a disk LRU cache wrapping remote backends.
package store

import (
	"context"
	"errors"
	"io"
	"time"
)

var ErrNotFound = errors.New("store: key not found")

type FileInfo struct {
	Size    int64
	ModTime time.Time
}

// Store is the media backend. Keys are slash-separated, safe paths relative to
// the store root; drivers never see absolute or parent-relative keys.
type Store interface {
	Put(ctx context.Context, key string, r io.Reader, size int64) error
	Open(ctx context.Context, key string) (io.ReadSeekCloser, error)
	Stat(ctx context.Context, key string) (FileInfo, error)
	Delete(ctx context.Context, key string) error
	List(ctx context.Context, prefix string) ([]string, error)
}
