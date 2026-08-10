package api

import (
	"compress/gzip"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

// Server wires the HTTP surface: API routes, embedded UI, middleware.
// Handlers for individual resource groups are added by later build phases.
type Server struct {
	Log *slog.Logger

	uiHandler http.Handler
	health    func() []HealthCheck
}

type HealthCheck struct {
	Name string `json:"name"`
	OK   bool   `json:"ok"`
	Err  string `json:"error,omitempty"`
}

func NewServer(log *slog.Logger, uiFS http.FileSystem) *Server {
	s := &Server{
		Log:       log,
		uiHandler: http.FileServer(uiFS),
	}
	s.health = func() []HealthCheck { return nil }
	return s
}

// SetHealth registers dynamic health checks (db, storage) added by later phases.
func (s *Server) SetHealth(fn func() []HealthCheck) {
	if fn != nil {
		s.health = fn
	}
}

// Handler builds the full middleware stack and route table.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", s.handleHealthz)
	mux.Handle("GET /api/", s.handleNotFound())
	mux.Handle("/", s.uiHandler)

	return s.recoverPanic(s.accessLog(gzipMiddleware(mux)))
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

// gzipMiddleware compresses JSON and text responses (never video).
func gzipMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			next.ServeHTTP(w, r)
			return
		}
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

func (s *Server) accessLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		s.Log.Info("http",
			"method", r.Method,
			"path", r.URL.Path,
			"remote", r.RemoteAddr,
			"dur", time.Since(start).Round(time.Microsecond).String(),
		)
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
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, map[string]any{"error": code, "message": msg})
}
