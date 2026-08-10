package store

import (
	"context"
	"strings"
	"testing"
)

func TestMigrateCopiesAndPrunes(t *testing.T) {
	ctx := context.Background()
	src, _ := NewLocal(t.TempDir())
	dst, _ := NewLocal(t.TempDir())

	for _, k := range []string{
		"entries/1/original.mp4",
		"entries/1/flavors/720p/seg_00001.ts",
		"entries/2/poster.jpg",
	} {
		if err := src.Put(ctx, k, strings.NewReader("data-"+k), 0); err != nil {
			t.Fatal(err)
		}
	}

	res, err := Migrate(ctx, src, dst, MigrateOptions{Workers: 2, Prune: true})
	if err != nil {
		t.Fatal(err)
	}
	if res.Copied != 3 || res.Skipped != 0 || res.Failed != 0 {
		t.Fatalf("unexpected result: %+v", res)
	}

	// Source pruned, target has everything.
	srcKeys, _ := src.List(ctx, EntriesRoot)
	if len(srcKeys) != 0 {
		t.Fatalf("source not pruned: %v", srcKeys)
	}
	dstKeys, _ := dst.List(ctx, EntriesRoot)
	if len(dstKeys) != 3 {
		t.Fatalf("target has %d keys: %v", len(dstKeys), dstKeys)
	}
}

func TestMigrateSkipsExisting(t *testing.T) {
	ctx := context.Background()
	src, _ := NewLocal(t.TempDir())
	dst, _ := NewLocal(t.TempDir())

	_ = src.Put(ctx, "entries/1/original.mp4", strings.NewReader("new"), 0)
	_ = dst.Put(ctx, "entries/1/original.mp4", strings.NewReader("old"), 0)

	res, err := Migrate(ctx, src, dst, MigrateOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if res.Copied != 0 || res.Skipped != 1 {
		t.Fatalf("expected skip, got %+v", res)
	}

	// With Force the target is overwritten.
	res, err = Migrate(ctx, src, dst, MigrateOptions{Force: true})
	if err != nil {
		t.Fatal(err)
	}
	if res.Copied != 1 {
		t.Fatalf("expected forced copy, got %+v", res)
	}
	rc, _ := dst.Open(ctx, "entries/1/original.mp4")
	defer rc.Close()
	buf := make([]byte, 3)
	rc.Read(buf)
	if string(buf) != "new" {
		t.Fatalf("target not overwritten: %q", buf)
	}
}
