package api

import (
	"net/http"

	"github.com/parasetam0l/vod-app/internal/db"
)

// registerAnalyticsRoutes: public beacons (rate-limited generously) and the
// per-entry analytics dashboard endpoint.
func (s *Server) registerAnalyticsRoutes(mux *http.ServeMux) {
	mux.Handle("POST /api/analytics/play", s.rateLimit(s.apiLimiter, http.HandlerFunc(s.handleAnalyticsPlay)))
	mux.Handle("POST /api/analytics/watch", s.rateLimit(s.apiLimiter, http.HandlerFunc(s.handleAnalyticsWatch)))
	mux.Handle("GET /api/entries/{id}/analytics", s.requireRole(roleEditor, roleAdmin)(http.HandlerFunc(s.handleEntryAnalytics)))
}

type beacon struct {
	PublicID string `json:"publicId"`
	ViewerID string `json:"viewerId"`
	Seconds  int64  `json:"seconds"`
}

// resolveBeaconEntry maps a public id to an internal entry id.
func (s *Server) resolveBeaconEntry(r *http.Request, publicID string) (int64, bool) {
	if publicID == "" {
		return 0, false
	}
	e, err := db.EntryByPublicID(r.Context(), s.pool, publicID)
	if err != nil {
		return 0, false
	}
	return e.ID, true
}

func (s *Server) handleAnalyticsPlay(w http.ResponseWriter, r *http.Request) {
	var b beacon
	if err := decodeJSON(r, &b); err != nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if id, ok := s.resolveBeaconEntry(r, b.PublicID); ok {
		s.analytics.AddPlay(id, b.ViewerID)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleAnalyticsWatch(w http.ResponseWriter, r *http.Request) {
	var b beacon
	if err := decodeJSON(r, &b); err != nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if id, ok := s.resolveBeaconEntry(r, b.PublicID); ok {
		s.analytics.AddWatch(id, b.Seconds)
	}
	w.WriteHeader(http.StatusNoContent)
}

type analyticsResponse struct {
	Totals analyticsTotals `json:"totals"`
	Series []analyticsDay  `json:"series"`
}

type analyticsTotals struct {
	Plays        int64 `json:"plays"`
	WatchSeconds int64 `json:"watchSeconds"`
	Bytes        int64 `json:"bytes"`
}

type analyticsDay struct {
	Day           string `json:"day"`
	Plays         int64  `json:"plays"`
	WatchSeconds  int64  `json:"watchSeconds"`
	Bytes         int64  `json:"bytes"`
	UniqueViewers int64  `json:"uniqueViewers"`
}

func (s *Server) handleEntryAnalytics(w http.ResponseWriter, r *http.Request) {
	e, ok := s.entryOr404(w, r)
	if !ok {
		return
	}
	var out analyticsResponse
	err := s.pool.QueryRow(r.Context(), `
		SELECT plays, watch_seconds, bytes FROM analytics_totals WHERE entry_id = $1`, e.ID).
		Scan(&out.Totals.Plays, &out.Totals.WatchSeconds, &out.Totals.Bytes)
	if err != nil && err.Error() != "no rows in result set" {
		s.internalError(w, r, "analytics totals", err)
		return
	}

	rows, err := s.pool.Query(r.Context(), `
		SELECT d.day::text, d.plays, d.watch_seconds, d.bytes,
		       (SELECT count(*) FROM analytics_viewers v WHERE v.entry_id = d.entry_id AND v.day = d.day)
		FROM analytics_daily d
		WHERE d.entry_id = $1
		ORDER BY d.day DESC
		LIMIT 90`, e.ID)
	if err != nil {
		s.internalError(w, r, "analytics series", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var d analyticsDay
		if err := rows.Scan(&d.Day, &d.Plays, &d.WatchSeconds, &d.Bytes, &d.UniqueViewers); err != nil {
			s.internalError(w, r, "analytics series scan", err)
			return
		}
		out.Series = append(out.Series, d)
	}
	if err := rows.Err(); err != nil {
		s.internalError(w, r, "analytics series", err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}
