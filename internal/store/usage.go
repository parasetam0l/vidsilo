package store

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"syscall"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// Usage describes storage consumption. TotalBytes/FreeBytes are 0 when the
// backend has no known capacity (e.g. S3), where ObjectCount still applies.
type Usage struct {
	UsedBytes   int64
	TotalBytes  int64
	FreeBytes   int64
	ObjectCount int64
}

// UsageStore is implemented by drivers that can report their consumption.
type UsageStore interface {
	Usage(ctx context.Context) (Usage, error)
}

// UsageOf unwraps wrapper stores (Fallback, Cache) and returns the underlying
// driver's usage plus its name ("local" / "s3").
func UsageOf(ctx context.Context, s Store) (Usage, string, error) {
	if u, ok := s.(UsageStore); ok {
		usage, err := u.Usage(ctx)
		return usage, driverName(s), err
	}
	switch t := s.(type) {
	case *Fallback:
		return UsageOf(ctx, t.primary)
	case *Cache:
		return UsageOf(ctx, t.backend)
	default:
		return Usage{}, "unknown", nil
	}
}

func driverName(s Store) string {
	switch s.(type) {
	case *Local:
		return "local"
	case *S3:
		return "s3"
	}
	return "unknown"
}

// LocalOf unwraps wrapper stores (Fallback, Cache) and returns the
// underlying local driver, or nil when the backend is not local.
func LocalOf(s Store) *Local {
	switch t := s.(type) {
	case *Local:
		return t
	case *Fallback:
		return LocalOf(t.primary)
	case *Cache:
		return LocalOf(t.backend)
	}
	return nil
}

// LocalRootOf unwraps wrapper stores (Fallback, Cache) and returns the
// local driver's root directory, when the backend is local.
func LocalRootOf(s Store) (string, bool) {
	if l := LocalOf(s); l != nil {
		return l.Root(), true
	}
	return "", false
}

// Usage reports used bytes (walking the whole data dir: media, spools,
// logs, cache, keys) plus the disk capacity/free space of the backing
// volume. Matches the storage page's per-entry total + system row.
func (l *Local) Usage(ctx context.Context) (Usage, error) {
	var u Usage
	err := filepath.WalkDir(l.root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		fi, err := d.Info()
		if err != nil {
			return nil
		}
		u.UsedBytes += fi.Size()
		u.ObjectCount++
		return nil
	})
	if err != nil {
		return Usage{}, err
	}
	var st syscall.Statfs_t
	if err := syscall.Statfs(l.root, &st); err == nil {
		u.TotalBytes = int64(st.Blocks) * int64(st.Bsize)
		u.FreeBytes = int64(st.Bavail) * int64(st.Bsize)
	}
	return u, nil
}

// Usage reports total object sizes (paged listing). S3 has no known
// capacity, so TotalBytes/FreeBytes stay 0.
func (s *S3) Usage(ctx context.Context) (Usage, error) {
	var u Usage
	p := s3.NewListObjectsV2Paginator(s.client, &s3.ListObjectsV2Input{
		Bucket: aws.String(s.bucket),
	})
	for p.HasMorePages() {
		page, err := p.NextPage(ctx)
		if err != nil {
			return Usage{}, err
		}
		for _, obj := range page.Contents {
			if obj.Size != nil {
				u.UsedBytes += *obj.Size
			}
			u.ObjectCount++
		}
	}
	return u, nil
}

// FileEntry is a storage key with its size.
type FileEntry struct {
	Key  string
	Size int64
}

// SizeListingStore is implemented by drivers that can list keys with sizes.
type SizeListingStore interface {
	ListSizes(ctx context.Context, prefix string) ([]FileEntry, error)
}

// ListSizesOf unwraps wrapper stores and lists keys with sizes. Drivers
// without native size listing fall back to List + Stat per key.
func ListSizesOf(ctx context.Context, s Store, prefix string) ([]FileEntry, error) {
	if l, ok := s.(SizeListingStore); ok {
		return l.ListSizes(ctx, prefix)
	}
	switch t := s.(type) {
	case *Fallback:
		return ListSizesOf(ctx, t.primary, prefix)
	case *Cache:
		return ListSizesOf(ctx, t.backend, prefix)
	default:
		keys, err := s.List(ctx, prefix)
		if err != nil {
			return nil, err
		}
		out := make([]FileEntry, 0, len(keys))
		for _, k := range keys {
			if fi, err := s.Stat(ctx, k); err == nil {
				out = append(out, FileEntry{Key: k, Size: fi.Size})
			}
		}
		return out, nil
	}
}

// ListSizes walks the store tree and returns every file key with its size.
func (l *Local) ListSizes(ctx context.Context, prefix string) ([]FileEntry, error) {
	base := filepath.Join(l.root, filepath.FromSlash(strings.Trim(prefix, "/")))
	var out []FileEntry
	err := filepath.WalkDir(base, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		fi, err := d.Info()
		if err != nil {
			return nil
		}
		rel, err := filepath.Rel(l.root, path)
		if err != nil {
			return nil
		}
		out = append(out, FileEntry{Key: filepath.ToSlash(rel), Size: fi.Size()})
		return nil
	})
	if errors.Is(err, os.ErrNotExist) {
		return out, nil
	}
	return out, err
}

// ListSizes pages objects and returns key + size for each.
func (s *S3) ListSizes(ctx context.Context, prefix string) ([]FileEntry, error) {
	var out []FileEntry
	p := s3.NewListObjectsV2Paginator(s.client, &s3.ListObjectsV2Input{
		Bucket: aws.String(s.bucket),
		Prefix: aws.String(strings.Trim(prefix, "/")),
	})
	for p.HasMorePages() {
		page, err := p.NextPage(ctx)
		if err != nil {
			return nil, err
		}
		for _, obj := range page.Contents {
			if obj.Key == nil {
				continue
			}
			var size int64
			if obj.Size != nil {
				size = *obj.Size
			}
			out = append(out, FileEntry{Key: *obj.Key, Size: size})
		}
	}
	return out, nil
}
