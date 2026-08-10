package store

import (
	"context"
	"io"
	"strings"
	"testing"
)

// newTinyBackend returns a local store as the remote backend.
func newTinyBackend(t *testing.T) Store {
	t.Helper()
	s, err := NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestCacheMissHitAndEviction(t *testing.T) {
	ctx := context.Background()
	backend := newTinyBackend(t)
	// 60-byte budget: three 20-byte files, fourth evicts the LRU (the first).
	c, err := NewCache(backend, t.TempDir(), 60)
	if err != nil {
		t.Fatal(err)
	}

	for i, k := range []string{"a.ts", "b.ts", "c.ts"} {
		if err := backend.Put(ctx, k, strings.NewReader(strings.Repeat("x", 20)), 20); err != nil {
			t.Fatal(err)
		}
		rc, err := c.Open(ctx, k)
		if err != nil {
			t.Fatal(err)
		}
		rc.Close()
		if i == 0 {
			continue
		}
	}

	// a.ts was fetched first and is now LRU; adding d.ts evicts it.
	if err := backend.Put(ctx, "d.ts", strings.NewReader(strings.Repeat("y", 20)), 20); err != nil {
		t.Fatal(err)
	}
	rc, err := c.Open(ctx, "d.ts")
	if err != nil {
		t.Fatal(err)
	}
	rc.Close()

	// Evicted a.ts must still serve (from backend) and land back in cache.
	rc, err = c.Open(ctx, "a.ts")
	if err != nil {
		t.Fatal(err)
	}
	buf, _ := io.ReadAll(rc)
	rc.Close()
	if string(buf) != strings.Repeat("x", 20) {
		t.Fatal("wrong content served for a.ts")
	}

	size, n := c.Size()
	if n != 3 {
		t.Fatalf("cache file count = %d, want 3 (one evicted)", n)
	}
	if size > 60 {
		t.Fatalf("cache size %d exceeds budget 60", size)
	}
}

func TestCachePutThrough(t *testing.T) {
	ctx := context.Background()
	c, err := NewCache(newTinyBackend(t), t.TempDir(), 1000)
	if err != nil {
		t.Fatal(err)
	}
	if err := c.Put(ctx, "entries/1/poster.jpg", strings.NewReader("poster"), 6); err != nil {
		t.Fatal(err)
	}
	rc, err := c.Open(ctx, "entries/1/poster.jpg")
	if err != nil {
		t.Fatal(err)
	}
	defer rc.Close()
	buf, _ := io.ReadAll(rc)
	if string(buf) != "poster" {
		t.Fatalf("got %q", buf)
	}
}

func TestCacheDelete(t *testing.T) {
	ctx := context.Background()
	c, err := NewCache(newTinyBackend(t), t.TempDir(), 1000)
	if err != nil {
		t.Fatal(err)
	}
	_ = c.Put(ctx, "entries/1/original.mp4", strings.NewReader("x"), 1)
	if err := c.Delete(ctx, "entries/1/original.mp4"); err != nil {
		t.Fatal(err)
	}
	size, n := c.Size()
	if size != 0 || n != 0 {
		t.Fatalf("cache not emptied: size=%d n=%d", size, n)
	}
}
