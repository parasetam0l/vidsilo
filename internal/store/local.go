package store

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// Local is the on-disk driver: streaming io.Copy writes, sendfile-friendly
// reads. Files live under Root with keys mirrored as relative paths.
type Local struct {
	root string
}

func NewLocal(root string) (*Local, error) {
	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, fmt.Errorf("store: create data dir: %w", err)
	}
	return &Local{root: root}, nil
}

// Root exposes the backing directory (used to write transcode output
// directly into the store tree, avoiding a copy).
func (l *Local) Root() string {
	return l.root
}

// pathForKey resolves a key under the root, rejecting traversal.
func (l *Local) pathForKey(key string) (string, error) {
	if key == "" || strings.HasPrefix(key, "/") {
		return "", fmt.Errorf("store: unsafe key %q", key)
	}
	clean := filepath.Clean(filepath.FromSlash(key))
	if clean == "." || strings.Contains(clean, "..") {
		return "", fmt.Errorf("store: unsafe key %q", key)
	}
	return filepath.Join(l.root, clean), nil
}

func (l *Local) Put(ctx context.Context, key string, r io.Reader, size int64) error {
	p, err := l.pathForKey(key)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(p), ".tmp-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := io.Copy(tmp, r); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), p)
}

// MoveIn atomically relocates an existing local file into the store tree
// (zero-copy promotion of spooled uploads).
func (l *Local) MoveIn(key, srcPath string) error {
	p, err := l.pathForKey(key)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	return os.Rename(srcPath, p)
}

func (l *Local) Open(ctx context.Context, key string) (io.ReadSeekCloser, error) {
	p, err := l.pathForKey(key)
	if err != nil {
		return nil, err
	}
	f, err := os.Open(p)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return f, nil
}

func (l *Local) Stat(ctx context.Context, key string) (FileInfo, error) {
	p, err := l.pathForKey(key)
	if err != nil {
		return FileInfo{}, err
	}
	st, err := os.Stat(p)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return FileInfo{}, ErrNotFound
		}
		return FileInfo{}, err
	}
	if st.IsDir() {
		return FileInfo{}, ErrNotFound
	}
	return FileInfo{Size: st.Size(), ModTime: st.ModTime()}, nil
}

func (l *Local) Delete(ctx context.Context, key string) error {
	p, err := l.pathForKey(key)
	if err != nil {
		return err
	}
	err = os.Remove(p)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

// RemoveTree deletes the whole subtree for a prefix — files AND the now
// empty directories — so entry deletion leaves nothing behind.
func (l *Local) RemoveTree(prefix string) error {
	p, err := l.pathForKey(strings.Trim(prefix, "/"))
	if err != nil {
		return err
	}
	if err := os.RemoveAll(p); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

// List walks the root for keys under prefix (e.g. "entries/123").
func (l *Local) List(ctx context.Context, prefix string) ([]string, error) {
	prefix = strings.Trim(prefix, "/")
	base := filepath.Join(l.root, filepath.FromSlash(prefix))
	var keys []string
	err := filepath.WalkDir(base, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(l.root, path)
		if err != nil {
			return err
		}
		keys = append(keys, filepath.ToSlash(rel))
		return nil
	})
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	return keys, err
}
