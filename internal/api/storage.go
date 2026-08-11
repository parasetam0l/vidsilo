package api

import (
	"net/http"

	"github.com/parasetam0l/vod-app/internal/store"
)

// registerStorageRoutes: storage usage for the sidebar storage card.
func (s *Server) registerStorageRoutes(mux *http.ServeMux) {
	mux.Handle("GET /api/storage/usage", s.requireAuth(http.HandlerFunc(s.handleStorageUsage)))
}

type storageUsage struct {
	UsedBytes   int64  `json:"usedBytes"`
	TotalBytes  int64  `json:"totalBytes"`
	FreeBytes   int64  `json:"freeBytes"`
	ObjectCount int64  `json:"objectCount"`
	Driver      string `json:"driver"`
}

func (s *Server) handleStorageUsage(w http.ResponseWriter, r *http.Request) {
	u, driver, err := store.UsageOf(r.Context(), s.store)
	if err != nil {
		s.internalError(w, r, "storage usage", err)
		return
	}
	writeJSON(w, http.StatusOK, storageUsage{
		UsedBytes:   u.UsedBytes,
		TotalBytes:  u.TotalBytes,
		FreeBytes:   u.FreeBytes,
		ObjectCount: u.ObjectCount,
		Driver:      driver,
	})
}
