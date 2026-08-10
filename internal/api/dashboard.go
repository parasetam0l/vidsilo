package api

import (
	"context"
	"net/http"
	"os"
	"path/filepath"

	"github.com/parasetam0l/vod-app/internal/db"
	"github.com/parasetam0l/vod-app/internal/store"
)

// registerDashboardRoutes: KPI snapshot for the admin dashboard.
func (s *Server) registerDashboardRoutes(mux *http.ServeMux) {
	mux.Handle("GET /api/dashboard", s.requireAuth(http.HandlerFunc(s.handleDashboard)))
}

type dashboardResponse struct {
	EntriesByStatus map[string]int64 `json:"entriesByStatus"`
	TotalEntries    int64            `json:"totalEntries"`
	StorageUsed     int64            `json:"storageUsed"`
	// Bandwidth: server-measured bytes served to viewers (view traffic),
	// from the analytics totals/daily tables.
	BandwidthTotalBytes int64 `json:"bandwidthTotalBytes"`
	BandwidthTodayBytes int64 `json:"bandwidthTodayBytes"`
	QueueDepth          int64 `json:"queueDepth"`
	Recent              []db.Entry `json:"recent"`
}

func (s *Server) handleDashboard(w http.ResponseWriter, r *http.Request) {
	out := dashboardResponse{
		EntriesByStatus: map[string]int64{},
	}

	rows, err := s.pool.Query(r.Context(), `SELECT status, count(*) FROM entries GROUP BY status`)
	if err != nil {
		s.internalError(w, r, "dashboard statuses", err)
		return
	}
	for rows.Next() {
		var status string
		var n int64
		if err := rows.Scan(&status, &n); err != nil {
			rows.Close()
			s.internalError(w, r, "dashboard statuses", err)
			return
		}
		out.EntriesByStatus[status] = n
	}
	rows.Close()

	if err := s.pool.QueryRow(r.Context(), `SELECT count(*) FROM entries`).Scan(&out.TotalEntries); err != nil {
		s.internalError(w, r, "dashboard total", err)
		return
	}
	if err := s.pool.QueryRow(r.Context(), `
		SELECT count(*) FROM jobs WHERE status IN ('queued', 'running')`).Scan(&out.QueueDepth); err != nil {
		s.internalError(w, r, "dashboard queue", err)
		return
	}

	out.StorageUsed = s.storageUsed(r.Context())

	// View traffic: every byte served to viewers is counted server-side by
	// the analytics accumulator (batched flush, merges across app nodes).
	if err := s.pool.QueryRow(r.Context(), `
		SELECT COALESCE(SUM(bytes), 0) FROM analytics_totals`).Scan(&out.BandwidthTotalBytes); err != nil {
		s.internalError(w, r, "dashboard bandwidth", err)
		return
	}
	if err := s.pool.QueryRow(r.Context(), `
		SELECT COALESCE(SUM(bytes), 0) FROM analytics_daily WHERE day = current_date`).Scan(&out.BandwidthTodayBytes); err != nil {
		s.internalError(w, r, "dashboard bandwidth today", err)
		return
	}

	list, err := db.ListEntries(r.Context(), s.pool, db.EntryFilter{Page: 1, Limit: 8})
	if err != nil {
		s.internalError(w, r, "dashboard recent", err)
		return
	}
	out.Recent = list.Items
	writeJSON(w, http.StatusOK, out)
}

// storageUsed sums media bytes: dir walk of the entries/ tree for the local
// driver (logs, secret.key and upload spools are not media), source sizes as
// a cheap fallback for object storage.
func (s *Server) storageUsed(ctx context.Context) int64 {
	if local, ok := s.store.(*store.Local); ok {
		root := filepath.Join(local.Root(), store.EntriesRoot)
		var total int64
		_ = filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
			if err == nil && !d.IsDir() {
				if fi, err := d.Info(); err == nil {
					total += fi.Size()
				}
			}
			return nil
		})
		return total
	}
	var sum int64
	_ = s.pool.QueryRow(ctx, `SELECT COALESCE(SUM(source_size), 0) FROM entries`).Scan(&sum)
	return sum
}
