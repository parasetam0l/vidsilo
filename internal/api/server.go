package api

import (
	"compress/gzip"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io/fs"
	"log/slog"
	"net/http"
	"net/netip"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/parasetam0l/vod-app/internal/analytics"
	"github.com/parasetam0l/vod-app/internal/media"
	"github.com/parasetam0l/vod-app/internal/queue"
	"github.com/parasetam0l/vod-app/internal/settings"
	"github.com/parasetam0l/vod-app/internal/store"
	"github.com/parasetam0l/vod-app/internal/upload"
)

// Server wires the HTTP surface: API routes, embedded UI, middleware.
type Server struct {
	Log       *slog.Logger
	pool      *pgxpool.Pool
	secret    []byte
	store     store.Store
	settings  *settings.Service
	queue     *queue.Queue
	media     *media.Manager
	analytics *analytics.Accumulator

	uiFS       fs.FS
	tusHandler http.Handler
	health     func() []HealthCheck

	apiLimiter   *rateLimiter
	loginLimiter *rateLimiter
	mediaLimiter *rateLimiter
	loginGuard   *loginGuard
	denylist     *Denylist
	respCache    *responseCache
	spoolDir     string

	// trustedProxies gates X-Forwarded-For trust (see SetTrustedProxies).
	trustedProxies []netip.Prefix
}

// SetTrustedProxies restricts X-Forwarded-For trust to requests arriving
// from the given reverse-proxy CIDRs. Empty = the app is directly exposed;
// client-supplied XFF is ignored so rate limiting cannot be spoofed.
func (s *Server) SetTrustedProxies(prefixes []netip.Prefix) {
	s.trustedProxies = prefixes
}

type HealthCheck struct {
	Name string `json:"name"`
	OK   bool   `json:"ok"`
	Err  string `json:"error,omitempty"`
}

const (
	apiRate   = 120.0 // generous burst on general API
	loginRate = 5.0   // tight on auth endpoints
	// mediaRate is the per-IP burst for /media traffic; the refill rate is
	// deliberately low (10/s) so a bandwidth hammer gets one burst and then
	// only ~10 requests per second, while legitimate HLS playback (a burst
	// of segments, then roughly one per segment length) never trips it.
	mediaRate    = 600.0
	mediaRefill  = 10.0
)

func NewServer(log *slog.Logger, uiFS fs.FS, pool *pgxpool.Pool, secret []byte, st store.Store, svc *settings.Service, q *queue.Queue, m *media.Manager, ds *upload.DataStore, acc *analytics.Accumulator) *Server {
	if log == nil {
		log = slog.Default()
	}
	s := &Server{
		Log:          log,
		pool:         pool,
		secret:       secret,
		store:        st,
		settings:     svc,
		queue:        q,
		media:        m,
		analytics:    acc,
		uiFS:         uiFS,
	apiLimiter:   newRateLimiter(apiRate, apiRate),
	loginLimiter: newRateLimiter(loginRate, loginRate),
	mediaLimiter: newRateLimiter(mediaRefill, mediaRate),
		loginGuard:   &loginGuard{failures: map[string]int{}, lockedAt: map[string]time.Time{}},
		denylist:     NewDenylist(pool),
		respCache:    newResponseCache(),
	}
	if ds != nil {
		s.tusHandler = s.newTusHandler(ds)
		s.spoolDir = ds.SpoolDir
	}
	s.health = func() []HealthCheck { return nil }
	return s
}

// SetHealth registers dynamic health checks (db, storage).
func (s *Server) SetHealth(fn func() []HealthCheck) {
	if fn != nil {
		s.health = fn
	}
}

// Handler builds the full middleware stack and route table.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	s.registerAuthRoutes(mux)
	s.registerViewerRoutes(mux)
	s.registerSettingsRoutes(mux)
	s.registerAclRoutes(mux)
	s.registerEntryRoutes(mux, s.tusHandler)
	s.registerFromURLRoutes(mux)
	s.registerMediaRoutes(mux)
	s.registerAnalyticsRoutes(mux)
	s.registerUserRoutes(mux)
	s.registerCategoryRoutes(mux)
	s.registerFlavorRoutes(mux)
	s.registerPlayerRoutes(mux)
	s.registerDashboardRoutes(mux)
	s.registerUploadConfigRoute(mux)
	s.registerActivityRoutes(mux)
	s.registerStorageRoutes(mux)
	s.registerAuditRoutes(mux)

	// Exact admin page route: prevents ServeMux's /upload -> /upload/ redirect
	// (the tus subtree owns /upload/).
	mux.HandleFunc("GET /admin/upload", s.serveUI)

	mux.HandleFunc("GET /healthz", s.handleHealthz)
	mux.Handle("GET /metrics", s.requireRole(roleAdmin)(http.HandlerFunc(s.handleMetrics)))
	mux.HandleFunc("GET /api/", s.handleNotFound())
	mux.HandleFunc("/", s.serveUI)

	var h http.Handler = mux
	h = s.requestID(h)
	h = s.rateLimitAPI(h) // token buckets: tight on /api/auth, generous elsewhere
	h = s.originCheck(h)
	h = s.securityHeaders(h)
	h = s.recoverPanic(h)
	h = s.accessLog(h)
	h = gzipMiddleware(h)
	return h
}

type reqIDKey struct{}

// requestID assigns every request a short unique id (echoed in logs and the
// X-Request-Id response header) so a slow request can be traced end to end.
// Client-supplied ids are honored but bounded, so logs cannot be flooded.
func (s *Server) requestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-Id")
		if len(id) > 64 {
			id = id[:64]
		}
		if id == "" {
			b := make([]byte, 8)
			if _, err := rand.Read(b); err == nil {
				id = hex.EncodeToString(b)
			} else {
				id = strconv.FormatInt(time.Now().UnixNano(), 36)
			}
		}
		w.Header().Set("X-Request-Id", id)
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), reqIDKey{}, id)))
	})
}

func requestIDFromContext(ctx context.Context) string {
	id, _ := ctx.Value(reqIDKey{}).(string)
	return id
}

// rateLimitAPI applies token buckets to every /api/* route: the tight login
// limiter on /api/auth/*, the generous general limiter everywhere else.
func (s *Server) rateLimitAPI(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			l := s.apiLimiter
			if strings.HasPrefix(r.URL.Path, "/api/auth/") || strings.HasPrefix(r.URL.Path, "/api/viewer/") {
				l = s.loginLimiter
			}
			if !l.allow(s.clientIP(r)) {
				w.Header().Set("Retry-After", "1")
				writeError(w, http.StatusTooManyRequests, "rate_limited", "too many requests")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) handleHealthz(w http.ResponseWriter, r *http.Request) {
	checks := s.health()
	allOK := true
	for _, c := range checks {
		if !c.OK {
			allOK = false
		}
	}
	if !allOK {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{
			"ok":     false,
			"checks": checks,
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "checks": checks})
}

func (s *Server) handleNotFound() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "not_found", "endpoint not found")
	}
}

func (s *Server) internalError(w http.ResponseWriter, r *http.Request, op string, err error) {
	s.Log.Error(op, "err", err, "path", r.URL.Path)
	writeError(w, http.StatusInternalServerError, "internal", "internal error")
}

// serveUI maps the static export onto clean URLs: /login -> login.html,
// /_next/... as-is, index fallback for /, and the exported 404 page.
// Pages are served with no-cache (a truncated mid-deploy response must never
// stick in a heuristic cache); content-hashed _next assets are immutable.
func (s *Server) serveUI(w http.ResponseWriter, r *http.Request) {
	// Server-side root handling: the library IS the root when enabled (the
	// export's index.html renders it); login_only visitors go to the viewer
	// login; disabled visitors land on the staff dashboard.
	if r.URL.Path == "/" {
		switch s.libraryMode() {
		case "login_only":
			http.Redirect(w, r, "/login", http.StatusFound)
		case "disabled":
			http.Redirect(w, r, "/admin/dashboard", http.StatusFound)
		}
		if r.URL.Path != "/" {
			return
		}
	}
	p := strings.TrimPrefix(r.URL.Path, "/")
	if p == "" {
		p = "index.html"
	}
	// The library moved to the root; old /library links keep working.
	// (/library/play/{uuid} is handled by its own route above serveUI.)
	if p == "library" || p == "library/" {
		http.Redirect(w, r, "/", http.StatusMovedPermanently)
		return
	}
	if strings.HasPrefix(p, "library/") {
		http.Redirect(w, r, "/"+strings.TrimPrefix(p, "library/"), http.StatusMovedPermanently)
		return
	}
	// The admin export is a directory of pages, not a single admin.html —
	// /admin (with or without a trailing slash) would fall through to a raw
	// directory listing. Land on the dashboard instead.
	if p == "admin" || p == "admin/" {
		http.Redirect(w, r, "/admin/dashboard", http.StatusFound)
		return
	}
	if strings.HasPrefix(p, "_next/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		http.FileServer(http.FS(s.uiFS)).ServeHTTP(w, r)
		return
	}
	// Extensionless paths resolve to their .html file (Next static export).
	if !strings.Contains(path.Base(p), ".") && !strings.HasSuffix(p, "/") {
		candidate := p + ".html"
		if f, err := s.uiFS.Open(candidate); err == nil {
			f.Close()
			w.Header().Set("Cache-Control", "no-store")
			r2 := r.Clone(r.Context())
			r2.URL.Path = "/" + candidate
			http.FileServer(http.FS(s.uiFS)).ServeHTTP(w, r2)
			return
		}
	}
	w.Header().Set("Cache-Control", "no-store")
	http.FileServer(http.FS(s.uiFS)).ServeHTTP(w, r)
}
func gzipMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			next.ServeHTTP(w, r)
			return
		}
		w.Header().Add("Vary", "Accept-Encoding")
		gz := gzip.NewWriter(w)
		grw := &gzipResponseWriter{ResponseWriter: w, gz: gz}
		defer func() {
			if grw.compressed {
				_ = gz.Close()
			}
		}()
		next.ServeHTTP(grw, r)
	})
}

type gzipResponseWriter struct {
	http.ResponseWriter
	gz         *gzip.Writer
	compressed bool
	wrote      bool
}

// compressible reports whether the response content type may be gzipped.
func compressible(ct string) bool {
	if ct == "" {
		return false
	}
	ct = strings.TrimSpace(strings.ToLower(ct))
	return strings.HasPrefix(ct, "text/") || strings.Contains(ct, "json") || strings.Contains(ct, "xml")
}

func (g *gzipResponseWriter) WriteHeader(code int) {
	g.wrote = true
	if compressible(g.Header().Get("Content-Type")) {
		g.compressed = true
		g.Header().Set("Content-Encoding", "gzip")
		g.Header().Del("Content-Length")
	}
	g.ResponseWriter.WriteHeader(code)
}

func (g *gzipResponseWriter) Write(b []byte) (int, error) {
	if !g.wrote {
		g.WriteHeader(http.StatusOK)
	}
	if g.compressed {
		return g.gz.Write(b)
	}
	return g.ResponseWriter.Write(b)
}

// statusWriter records the response status and byte count for access logs.
type statusWriter struct {
	http.ResponseWriter
	status int
	bytes  int64
}

func (w *statusWriter) WriteHeader(code int) {
	if w.status == 0 {
		w.status = code
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusWriter) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	n, err := w.ResponseWriter.Write(b)
	w.bytes += int64(n)
	return n, err
}

func (s *Server) accessLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w}
		next.ServeHTTP(sw, r)
		if sw.status == 0 {
			sw.status = http.StatusOK
		}
		recordRequest(sw.status, sw.bytes, time.Since(start))
		reqID := requestIDFromContext(r.Context())
		logArgs := []any{
			"method", r.Method,
			"path", r.URL.Path,
			"remote", r.RemoteAddr,
			"status", sw.status,
			"bytes", sw.bytes,
			"dur", time.Since(start).Round(time.Microsecond).String(),
		}
		if reqID != "" {
			logArgs = append(logArgs, "req_id", reqID)
		}
		s.Log.Info("http", logArgs...)
	})
}

func (s *Server) recoverPanic(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				s.Log.Error("panic", "err", rec, "path", r.URL.Path)
				writeError(w, http.StatusInternalServerError, "internal", "internal error")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	// Handlers may opt into caching by setting Cache-Control themselves
	// (e.g. the public site-config endpoint); otherwise no-store.
	if w.Header().Get("Cache-Control") == "" {
		w.Header().Set("Cache-Control", "no-store")
	}
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, map[string]any{"error": code, "message": msg})
}

// decodeJSON reads a JSON body into v with a hard size cap (a rogue client
// must not be able to exhaust memory before the handler validates input).
func decodeJSON(r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(nil, r.Body, maxJSONBody)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	return dec.Decode(v)
}

const maxJSONBody = 1 << 20 // 1 MiB is plenty for every JSON endpoint
