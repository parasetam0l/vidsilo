package api

import (
	"net"
	"net/http"
	"net/netip"
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

// clientIP extracts the client address for rate limiting. X-Forwarded-For is
// trusted only when the direct peer is one of the configured trusted proxies
// (see Server.SetTrustedProxies); otherwise it is ignored entirely, so a
// directly-exposed deployment cannot be spoofed by setting the header.
func (s *Server) clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" && s.xffTrusted(r) {
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

// xffTrusted reports whether the direct peer is an allowed reverse proxy.
func (s *Server) xffTrusted(r *http.Request) bool {
	if len(s.trustedProxies) == 0 {
		return false
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip, err := netip.ParseAddr(host)
	if err != nil {
		return false
	}
	for _, p := range s.trustedProxies {
		if p.Contains(ip) {
			return true
		}
	}
	return false
}

// rateLimit wraps a handler; surplus requests get 429.
func (s *Server) rateLimit(l *rateLimiter, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !l.allow(s.clientIP(r)) {
			w.Header().Set("Retry-After", "1")
			writeError(w, http.StatusTooManyRequests, "rate_limited", "too many requests")
			return
		}
		next.ServeHTTP(w, r)
	})
}
