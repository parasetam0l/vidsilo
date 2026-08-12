package store

import (
	"context"
	"io"
	"os"
	"strings"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// newTestS3 connects to the MinIO service from CI (S3_* env vars); skipped
// when no endpoint is configured.
func newTestS3(t *testing.T) *S3 {
	t.Helper()
	endpoint := os.Getenv("S3_ENDPOINT")
	if endpoint == "" {
		t.Skip("S3_ENDPOINT not set (MinIO service)")
	}
	bucket := os.Getenv("S3_BUCKET")
	if bucket == "" {
		bucket = "ci-test"
	}
	s, err := NewS3(S3Params{
		Endpoint:  endpoint,
		Bucket:    bucket,
		AccessKey: os.Getenv("S3_ACCESS_KEY"),
		SecretKey: os.Getenv("S3_SECRET_KEY"),
		Region:    os.Getenv("S3_REGION"),
	})
	if err != nil {
		t.Fatalf("NewS3: %v", err)
	}
	// The MinIO service starts empty; create the bucket once per test run.
	ctx := context.Background()
	if err := s.ensureBucket(ctx); err != nil {
		t.Fatalf("create bucket: %v", err)
	}
	return s
}

func (s *S3) ensureBucket(ctx context.Context) error {
	_, err := s.client.HeadBucket(ctx, &s3.HeadBucketInput{Bucket: aws.String(s.bucket)})
	if err == nil {
		return nil
	}
	_, err = s.client.CreateBucket(ctx, &s3.CreateBucketInput{Bucket: aws.String(s.bucket)})
	return err
}

// TestS3RangedReader verifies the lazy range reader: full reads, seeks and
// ranged reads all return the right bytes without spooling the whole object.
func TestS3RangedReader(t *testing.T) {
	s := newTestS3(t)
	ctx := context.Background()
	key := "test/ranged-reader.bin"
	content := strings.Repeat("0123456789abcdef", 512) // 8 KiB
	if err := s.Put(ctx, key, strings.NewReader(content), int64(len(content))); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Delete(context.Background(), key) })

	// Whole-object sequential read.
	rc, err := s.Open(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	got, err := io.ReadAll(rc)
	rc.Close()
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != content {
		t.Fatalf("full read mismatch: %d bytes, want %d", len(got), len(content))
	}

	// Seek + ranged read (what http.ServeContent does for Range requests).
	rc, err = s.Open(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := rc.Seek(1024, io.SeekStart); err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, 2048)
	n, err := io.ReadFull(rc, buf)
	rc.Close()
	if err != nil {
		t.Fatal(err)
	}
	if n != 2048 || string(buf) != content[1024:1024+2048] {
		t.Fatalf("ranged read mismatch: %d bytes", n)
	}

	// Seek from the end.
	rc, err = s.Open(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := rc.Seek(-32, io.SeekEnd); err != nil {
		t.Fatal(err)
	}
	tail := make([]byte, 32)
	if _, err := io.ReadFull(rc, tail); err != nil {
		t.Fatal(err)
	}
	rc.Close()
	if string(tail) != content[len(content)-32:] {
		t.Fatalf("tail read mismatch: %q", tail)
	}

	// Missing key maps to ErrNotFound.
	if _, err := s.Open(ctx, key+".nope"); err != ErrNotFound {
		t.Fatalf("missing key error = %v, want ErrNotFound", err)
	}
}
