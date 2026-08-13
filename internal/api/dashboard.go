package api

import (
	"context"
	"net/http"
	"os"
	"path/filepath"

	"github.com/parasetam0l/vidsilo/internal/db"
	"github.com/parasetam0l/vidsilo/internal/store"
)

// registerDashboardRoutes: KPI snapshot for the admin dashboard.
func (s *Server) registerDashboardRoutes(mux *http.ServeMux) {
	mux.Handle("GET /api/dashboard", s.requireAuth(http.HandlerFunc(s.handleDashboard)))
}

type bandwidthPoint struct {
	Day   string `json:"day"`
	Bytes int64  `json:"bytes"`
}

type dashboardResponse struct {
	EntriesByStatus map[string]int64 `json:"entriesByStatus"`
	TotalEntries    int64            `json:"totalEntries"`
	StorageUsed     int64            `json:"storageUsed"`
	// Bandwidth: server-measured bytes served to viewers (view traffic),
	// from the analytics totals/daily tables.
	BandwidthTotalBytes int64            `json:"bandwidthTotalBytes"`
	BandwidthTodayBytes int64            `json:"bandwidthTodayBytes"`
	BandwidthSeries     []bandwidthPoint `json:"bandwidthSeries"`
	AnalyticsEnabled    bool             `json:"analyticsEnabled"`
	QueueDepth          int64            `json:"queueDepth"`
	Recent              []db.Entry       `json:"recent"`
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
	out.AnalyticsEnabled = s.settings.Bool("analytics.enabled", true)

	// Last 14 days of served bytes for the bandwidth sparkline.
	seriesRows, err := s.pool.Query(r.Context(), `
		SELECT day::text, SUM(bytes) FROM analytics_daily
		WHERE day >= current_date - 13
		GROUP BY day ORDER BY day`)
	if err != nil {
		s.internalError(w, r, "dashboard bandwidth series", err)
		return
	}
	defer seriesRows.Close()
	out.BandwidthSeries = []bandwidthPoint{}
	for seriesRows.Next() {
		var p bandwidthPoint
		if err := seriesRows.Scan(&p.Day, &p.Bytes); err != nil {
			s.internalError(w, r, "dashboard bandwidth series", err)
			return
		}
		out.BandwidthSeries = append(out.BandwidthSeries, p)
	}
	if err := seriesRows.Err(); err != nil {
		s.internalError(w, r, "dashboard bandwidth series", err)
		return
	}

	list, err := db.ListEntries(r.Context(), s.pool, db.EntryFilter{Page: 1, Limit: 5})
	if err != nil {
		s.internalError(w, r, "dashboard recent", err)
		return
	}
	out.Recent = list.Items
	writeJSON(w, http.StatusOK, out)
}

// storageUsed returns the total media bytes (the entries/ tree only — logs,
// keys and upload spools are not media). Accurate on both local and S3
// backends: it lists actual object sizes, including generated renditions.
func (s *Server) storageUsed(ctx context.Context) int64 {
	if local := store.LocalOf(s.store); local != nil {
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
	files, err := store.ListSizesOf(ctx, s.store, store.EntriesRoot+"/")
	if err != nil {
		s.Log.Warn("storage usage", "err", err)
		return 0
	}
	var total int64
	for _, f := range files {
		total += f.Size
	}
	return total
}
