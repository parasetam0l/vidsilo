package store

import (
	"context"
	"os"
	"path/filepath"
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

// Usage reports used bytes (walking the store tree) plus the disk
// capacity/free space of the backing volume.
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
