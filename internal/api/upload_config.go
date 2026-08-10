package api

import (
	"net/http"
)

// uploadConfig is the public, read-only upload contract (no auth: the
// upload dialog needs it before sign-in-agnostic rendering, and it contains
// no secrets).
type uploadConfig struct {
	MaxSizeBytes      int64    `json:"maxSizeBytes"`
	AllowedExtensions []string `json:"allowedExtensions"`
}

func (s *Server) registerUploadConfigRoute(mux *http.ServeMux) {
	mux.Handle("GET /api/upload-config", s.rateLimit(s.apiLimiter, http.HandlerFunc(s.handleUploadConfig)))
}

func (s *Server) handleUploadConfig(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, uploadConfig{
		MaxSizeBytes:      s.settings.Int64("upload.max_size_bytes", 8<<30),
		AllowedExtensions: s.settings.StringSlice("upload.allowed_extensions", []string{"mp4", "mov", "mkv", "webm", "m4v", "avi"}),
	})
}
