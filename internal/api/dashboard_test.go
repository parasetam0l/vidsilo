package api

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/parasetam0l/vidsilo/internal/store"
)

// storageUsed must count only the media tree — access logs, the secret key
// and upload spools grow on their own and are not media.
func TestStorageUsedCountsMediaOnly(t *testing.T) {
	root := t.TempDir()
	mediaDir := filepath.Join(root, "entries", "1")
	if err := os.MkdirAll(mediaDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(mediaDir, "original.mp4"), make([]byte, 100), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "logs"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "logs", "vidsilo.log"), make([]byte, 5000), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "secret.key"), make([]byte, 32), 0o644); err != nil {
		t.Fatal(err)
	}

	st, err := store.NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{store: st}
	if got := s.storageUsed(context.Background()); got != 100 {
		t.Fatalf("storageUsed = %d, want 100 (media only, logs/keys excluded)", got)
	}
}

// An empty catalog (no entries/ dir yet) must report 0, not a growing log size.
func TestStorageUsedEmptyCatalog(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "logs"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "logs", "vidsilo.log"), make([]byte, 4096), 0o644); err != nil {
		t.Fatal(err)
	}
	st, err := store.NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{store: st}
	if got := s.storageUsed(context.Background()); got != 0 {
		t.Fatalf("storageUsed = %d, want 0 on an empty catalog", got)
	}
}
