package store

import (
	"bytes"
	"context"
	"errors"
	"io"
	"strings"
	"testing"
)

func TestLocalRoundtrip(t *testing.T) {
	ctx := context.Background()
	s, err := NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}

	if err := s.Put(ctx, "entries/1/original.mp4", strings.NewReader("hello media"), 11); err != nil {
		t.Fatal(err)
	}
	fi, err := s.Stat(ctx, "entries/1/original.mp4")
	if err != nil {
		t.Fatal(err)
	}
	if fi.Size != 11 {
		t.Fatalf("size = %d, want 11", fi.Size)
	}

	rc, err := s.Open(ctx, "entries/1/original.mp4")
	if err != nil {
		t.Fatal(err)
	}
	defer rc.Close()
	buf, _ := io.ReadAll(rc)
	if string(buf) != "hello media" {
		t.Fatalf("got %q", buf)
	}

	// Seek back and re-read (ServeContent-style).
	if _, err := rc.Seek(0, io.SeekStart); err != nil {
		t.Fatal(err)
	}
	if _, err := io.Copy(io.Discard, rc); err != nil {
		t.Fatal(err)
	}

	if _, err := s.Stat(ctx, "entries/1/missing.ts"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("want ErrNotFound, got %v", err)
	}
}

func TestLocalTraversalGuard(t *testing.T) {
	s, err := NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Put(context.Background(), "../../etc/passwd", strings.NewReader("x"), 1); err == nil {
		t.Fatal("expected traversal key to be rejected")
	}
}

func TestLocalList(t *testing.T) {
	ctx := context.Background()
	s, _ := NewLocal(t.TempDir())
	for _, k := range []string{
		"entries/1/original.mp4",
		"entries/1/flavors/720p/seg_00001.ts",
		"entries/2/original.mp4",
	} {
		if err := s.Put(ctx, k, strings.NewReader("x"), 1); err != nil {
			t.Fatal(err)
		}
	}
	keys, err := s.List(ctx, "entries/1")
	if err != nil {
		t.Fatal(err)
	}
	if len(keys) != 2 {
		t.Fatalf("got %d keys for prefix entries/1: %v", len(keys), keys)
	}
}

func TestLocalDelete(t *testing.T) {
	ctx := context.Background()
	s, _ := NewLocal(t.TempDir())
	_ = s.Put(ctx, "entries/1/original.mp4", bytes.NewReader(nil), 0)
	if err := s.Delete(ctx, "entries/1/original.mp4"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Stat(ctx, "entries/1/original.mp4"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("want ErrNotFound after delete, got %v", err)
	}
	if err := s.Delete(ctx, "entries/1/original.mp4"); err != nil {
		t.Fatalf("delete of missing key should be a no-op: %v", err)
	}
}
