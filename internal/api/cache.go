package api

import (
	"bytes"
	"net/http"
	"sync"
	"time"
)

// responseCache is a tiny in-memory TTL cache for read-only JSON endpoints
// whose output is identical for every caller (public endpoints only).
// Values are keyed by URL path+query; entries expire after ttl.
type responseCache struct {
	mu    sync.Mutex
	items map[string]cacheItem
}

type cacheItem struct {
	body      []byte
	expiresAt time.Time
}

func newResponseCache() *responseCache {
	return &responseCache{items: map[string]cacheItem{}}
}

// get returns the cached body when fresh.
func (c *responseCache) get(key string) ([]byte, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	it, ok := c.items[key]
	if !ok || time.Now().After(it.expiresAt) {
		if ok {
			delete(c.items, key)
		}
		return nil, false
	}
	return it.body, true
}

// put stores a response body until ttl elapses.
func (c *responseCache) put(key string, body []byte, ttl time.Duration) {
	if ttl <= 0 {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	// Opportunistic cleanup keeps the map small.
	if len(c.items) > 512 {
		now := time.Now()
		for k, v := range c.items {
			if now.After(v.expiresAt) {
				delete(c.items, k)
			}
		}
	}
	c.items[key] = cacheItem{body: append([]byte(nil), body...), expiresAt: time.Now().Add(ttl)}
}

// cacheWriter buffers the handler's output so it can be stored.
type cacheWriter struct {
	header http.Header
	buf    bytes.Buffer
	status int
}

func (w *cacheWriter) Header() http.Header         { return w.header }
func (w *cacheWriter) WriteHeader(code int)        { w.status = code }
func (w *cacheWriter) Write(b []byte) (int, error) { return w.buf.Write(b) }

// cacheGET wraps a handler with a short-lived response cache. Only use for
// public, deterministic GET endpoints. As a footgun guard, requests that
// carry credentials (cookies or Authorization) bypass the cache entirely —
// both on read and write — so an authenticated response can never leak to
// another user via a shared key.
func (s *Server) cacheGET(ttl time.Duration, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if hasCredentials(r) {
			next(w, r)
			return
		}
		key := r.URL.Path + "?" + r.URL.RawQuery
		if body, ok := s.respCache.get(key); ok {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Cache-Control", "private, max-age="+itoa(int(ttl.Seconds())))
			w.Header().Set("X-Cache", "HIT")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(body)
			return
		}
		cw := &cacheWriter{header: make(http.Header)}
		next(cw, r)
		if cw.status == http.StatusOK {
			s.respCache.put(key, cw.buf.Bytes(), ttl)
			w.Header().Set("X-Cache", "MISS")
		}
		for k, vs := range cw.header {
			for _, v := range vs {
				w.Header().Add(k, v)
			}
		}
		w.WriteHeader(cw.status)
		_, _ = w.Write(cw.buf.Bytes())
	}
}

// hasCredentials reports whether the request carries session material.
func hasCredentials(r *http.Request) bool {
	return r.Header.Get("Authorization") != "" || len(r.Cookies()) > 0
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}
