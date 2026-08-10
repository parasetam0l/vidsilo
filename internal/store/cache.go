package store

import (
	"container/list"
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// Cache wraps a remote Store (typically S3) with a local disk LRU so hot
// segments avoid per-request round trips. Sizing is bounded by MaxBytes;
// eviction removes least-recently-used files. The index is rebuilt from disk
// on startup, so cache contents survive restarts.
type Cache struct {
	backend Store
	root    string
	maxSize int64

	mu      sync.Mutex
	size    int64
	entries map[string]*list.Element
	lru     *list.List // front = most recently used
}

type cacheEntry struct {
	key  string
	size int64
}

func NewCache(backend Store, root string, maxSize int64) (*Cache, error) {
	if maxSize <= 0 {
		return nil, fmt.Errorf("store: cache max size must be positive")
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, err
	}
	c := &Cache{
		backend: backend,
		root:    root,
		maxSize: maxSize,
		entries: map[string]*list.Element{},
		lru:     list.New(),
	}
	if err := c.rebuildIndex(); err != nil {
		return nil, err
	}
	return c, nil
}

// Path maps a key to its cache file path.
func (c *Cache) pathForKey(key string) string {
	return filepath.Join(c.root, filepath.FromSlash(strings.TrimPrefix(key, "/")))
}

func (c *Cache) rebuildIndex() error {
	keys, err := c.listCacheFiles()
	if err != nil {
		return err
	}
	for _, k := range keys {
		fi, err := os.Stat(c.pathForKey(k))
		if err != nil {
			continue
		}
		c.mu.Lock()
		c.insertLocked(k, fi.Size())
		c.mu.Unlock()
	}
	return nil
}

func (c *Cache) listCacheFiles() ([]string, error) {
	var keys []string
	err := filepath.WalkDir(c.root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(c.root, path)
		if err != nil {
			return err
		}
		keys = append(keys, filepath.ToSlash(rel))
		return nil
	})
	return keys, err
}

func (c *Cache) insertLocked(key string, size int64) {
	if el, ok := c.entries[key]; ok {
		c.lru.MoveToFront(el)
		el.Value.(*cacheEntry).size = size
		return
	}
	el := c.lru.PushFront(&cacheEntry{key: key, size: size})
	c.entries[key] = el
	c.size += size
	c.evictLocked()
}

func (c *Cache) evictLocked() {
	for c.size > c.maxSize && c.lru.Len() > 0 {
		el := c.lru.Back()
		entry := el.Value.(*cacheEntry)
		c.lru.Remove(el)
		delete(c.entries, entry.key)
		c.size -= entry.size
		os.Remove(c.pathForKey(entry.key)) // best effort
	}
}

func (c *Cache) touchLocked(key string) {
	if el, ok := c.entries[key]; ok {
		c.lru.MoveToFront(el)
	}
}

func (c *Cache) Put(ctx context.Context, key string, r io.Reader, size int64) error {
	if err := c.backend.Put(ctx, key, r, size); err != nil {
		return err
	}
	// Re-read into the cache from the backend so the copy is identical; cheap
	// in practice (only used for freshly produced media files).
	rc, err := c.backend.Open(ctx, key)
	if err != nil {
		return nil // cache miss is fine
	}
	defer rc.Close()
	fi, _ := c.backend.Stat(ctx, key)
	c.mu.Lock()
	defer c.mu.Unlock()
	p := c.pathForKey(key)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return nil
	}
	f, err := os.Create(p)
	if err != nil {
		return nil
	}
	if _, err := io.Copy(f, rc); err != nil {
		f.Close()
		os.Remove(p)
		return nil
	}
	f.Close()
	c.insertLocked(key, fi.Size)
	return nil
}

func (c *Cache) Open(ctx context.Context, key string) (io.ReadSeekCloser, error) {
	c.mu.Lock()
	if el, ok := c.entries[key]; ok {
		c.lru.MoveToFront(el)
		c.mu.Unlock()
		f, err := os.Open(c.pathForKey(key))
		if err == nil {
			return f, nil
		}
		c.mu.Lock()
		c.removeLocked(key)
		c.mu.Unlock()
	}
	c.mu.Unlock()

	// Miss: fetch from backend, store locally, serve from the cache file.
	rc, err := c.backend.Open(ctx, key)
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	p := c.pathForKey(key)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return rc, nil // serve the spool without caching
	}
	tmp, err := os.CreateTemp(filepath.Dir(p), ".cache-*")
	if err != nil {
		return rc, nil
	}
	n, err := io.Copy(tmp, rc)
	if err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		return nil, err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmp.Name())
		return nil, err
	}
	if err := os.Rename(tmp.Name(), p); err != nil {
		os.Remove(tmp.Name())
		return rc, nil
	}
	c.mu.Lock()
	c.insertLocked(key, n)
	c.mu.Unlock()
	f, err := os.Open(p)
	if err != nil {
		return nil, err
	}
	return f, nil
}

func (c *Cache) removeLocked(key string) {
	if el, ok := c.entries[key]; ok {
		c.lru.Remove(el)
		delete(c.entries, key)
		c.size -= el.Value.(*cacheEntry).size
	}
}

func (c *Cache) Stat(ctx context.Context, key string) (FileInfo, error) {
	c.mu.Lock()
	el, ok := c.entries[key]
	if ok {
		c.lru.MoveToFront(el)
		size := el.Value.(*cacheEntry).size
		c.mu.Unlock()
		return FileInfo{Size: size}, nil
	}
	c.mu.Unlock()
	return c.backend.Stat(ctx, key)
}

func (c *Cache) Delete(ctx context.Context, key string) error {
	c.mu.Lock()
	c.removeLocked(key)
	c.mu.Unlock()
	os.Remove(c.pathForKey(key))
	return c.backend.Delete(ctx, key)
}

func (c *Cache) List(ctx context.Context, prefix string) ([]string, error) {
	return c.backend.List(ctx, prefix)
}

// Size reports current cache footprint (bytes) and file count.
func (c *Cache) Size() (int64, int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.size, c.lru.Len()
}
