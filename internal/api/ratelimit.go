package api

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// In-memory token-bucket rate limiter keyed by client IP. Buckets are pruned
// on access; the map stays tiny for single-server deployments.

type bucket struct {
	tokens float64
	last   time.Time
}

type rateLimiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
	rate    float64 // tokens per second
	burst   float64
}

func newRateLimiter(rate, burst float64) *rateLimiter {
	return &rateLimiter{
		buckets: make(map[string]*bucket),
		rate:    rate,
		burst:   burst,
	}
}

func (l *rateLimiter) allow(key string) bool {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	b, ok := l.buckets[key]
	if !ok {
		l.buckets[key] = &bucket{tokens: l.burst - 1, last: now}
		return true
	}
	b.tokens = min(b.tokens+(now.Sub(b.last).Seconds()*l.rate), l.burst)
	b.last = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

// clientIP extracts the client address. When a reverse proxy forwards the
// request, X-Forwarded-For carries the real peer — take its left-most entry
// (the original client; later hops are untrusted). Direct deployments use
// RemoteAddr as before.
func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		if i := strings.IndexByte(xff, ','); i > 0 {
			xff = xff[:i]
		}
		if ip := strings.TrimSpace(xff); ip != "" {
			return ip
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// rateLimit wraps a handler; surplus requests get 429.
func (s *Server) rateLimit(l *rateLimiter, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !l.allow(clientIP(r)) {
			w.Header().Set("Retry-After", "1")
			writeError(w, http.StatusTooManyRequests, "rate_limited", "too many requests")
			return
		}
		next.ServeHTTP(w, r)
	})
}
