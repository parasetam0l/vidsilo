package store

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"
)

func newFallbackPair(t *testing.T) (*Fallback, *Local, *Local) {
	t.Helper()
	primary, err := NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	legacy, err := NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return NewFallback(primary, legacy), primary, legacy
}

func mustPut(t *testing.T, s Store, key, content string) {
	t.Helper()
	if err := s.Put(context.Background(), key, strings.NewReader(content), int64(len(content))); err != nil {
		t.Fatal(err)
	}
}

func mustRead(t *testing.T, s Store, key string) string {
	t.Helper()
	rc, err := s.Open(context.Background(), key)
	if err != nil {
		t.Fatal(err)
	}
	defer rc.Close()
	b, err := io.ReadAll(rc)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// Open promotes a legacy-only key into the primary and serves its content.
func TestFallbackOpenPromotes(t *testing.T) {
	fb, primary, legacy := newFallbackPair(t)
	mustPut(t, legacy, "entries/1/master.m3u8", "legacy-content")

	if got := mustRead(t, fb, "entries/1/master.m3u8"); got != "legacy-content" {
		t.Fatalf("served %q, want legacy-content", got)
	}
	if fb.Promoted() != 1 {
		t.Fatalf("Promoted() = %d, want 1", fb.Promoted())
	}
	// The primary now owns the object; a second read must not promote again.
	if got := mustRead(t, fb, "entries/1/master.m3u8"); got != "legacy-content" {
		t.Fatalf("second read served %q", got)
	}
	if _, err := primary.Stat(context.Background(), "entries/1/master.m3u8"); err != nil {
		t.Fatalf("primary does not own the promoted key: %v", err)
	}
	if fb.Promoted() != 1 {
		t.Fatalf("Promoted() = %d after second read, want 1", fb.Promoted())
	}
}

// Open serves primary keys directly and never touches the legacy store.
func TestFallbackOpenPrimaryHit(t *testing.T) {
	fb, _, legacy := newFallbackPair(t)
	mustPut(t, fb, "entries/2/a.ts", "new-content")

	if got := mustRead(t, fb, "entries/2/a.ts"); got != "new-content" {
		t.Fatalf("served %q, want new-content", got)
	}
	if fb.Promoted() != 0 {
		t.Fatalf("Promoted() = %d, want 0", fb.Promoted())
	}
	if _, err := legacy.Stat(context.Background(), "entries/2/a.ts"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("legacy was written by a read-through hit: %v", err)
	}
}

func TestFallbackOpenMissing(t *testing.T) {
	fb, _, _ := newFallbackPair(t)
	if _, err := fb.Open(context.Background(), "entries/9/nope.ts"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Open missing key err = %v, want ErrNotFound", err)
	}
}

// Stat falls back to the legacy store for keys not yet promoted.
func TestFallbackStat(t *testing.T) {
	fb, _, legacy := newFallbackPair(t)
	mustPut(t, legacy, "entries/3/poster.jpg", "poster")

	fi, err := fb.Stat(context.Background(), "entries/3/poster.jpg")
	if err != nil {
		t.Fatalf("Stat: %v", err)
	}
	if fi.Size != 6 {
		t.Fatalf("Size = %d, want 6", fi.Size)
	}
	if _, err := fb.Stat(context.Background(), "entries/3/missing.jpg"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Stat missing err = %v, want ErrNotFound", err)
	}
}

// Delete removes the object from both stores, so it cannot resurface.
func TestFallbackDeleteBothStores(t *testing.T) {
	fb, primary, legacy := newFallbackPair(t)
	mustPut(t, legacy, "entries/4/b.ts", "x")
	mustRead(t, fb, "entries/4/b.ts") // promote

	if err := fb.Delete(context.Background(), "entries/4/b.ts"); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	for name, s := range map[string]Store{"primary": primary, "legacy": legacy} {
		if _, err := s.Stat(context.Background(), "entries/4/b.ts"); !errors.Is(err, ErrNotFound) {
			t.Fatalf("%s still has the deleted key: %v", name, err)
		}
	}
	if _, err := fb.Open(context.Background(), "entries/4/b.ts"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Open after delete err = %v, want ErrNotFound", err)
	}
}

// Put lands in the primary only — the legacy store stays read-only.
func TestFallbackPutPrimaryOnly(t *testing.T) {
	fb, _, legacy := newFallbackPair(t)
	mustPut(t, fb, "entries/5/c.ts", "fresh")

	if _, err := legacy.Stat(context.Background(), "entries/5/c.ts"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("legacy was written by Put: %v", err)
	}
	if _, err := fb.Stat(context.Background(), "entries/5/c.ts"); err != nil {
		t.Fatalf("primary write not visible through fallback: %v", err)
	}
}

// List merges both key spaces without duplicates.
func TestFallbackListMerges(t *testing.T) {
	fb, _, legacy := newFallbackPair(t)
	mustPut(t, fb, "entries/6/seg_1.ts", "a")
	mustPut(t, fb, "entries/6/seg_2.ts", "b")
	mustPut(t, legacy, "entries/6/seg_1.ts", "a") // same key in both
	mustPut(t, legacy, "entries/6/seg_3.ts", "c")
	mustPut(t, legacy, "entries/7/seg_1.ts", "d")

	keys, err := fb.List(context.Background(), EntriesRoot)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"entries/6/seg_1.ts", "entries/6/seg_2.ts", "entries/6/seg_3.ts", "entries/7/seg_1.ts"}
	if len(keys) != len(want) {
		t.Fatalf("List = %v, want %v", keys, want)
	}
	for i := range want {
		if keys[i] != want[i] {
			t.Fatalf("List = %v, want %v", keys, want)
		}
	}
}
