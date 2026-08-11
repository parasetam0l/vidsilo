package api

import (
	"net/http"
)

// Platform-wide analytics for the Analytics page.

type analyticsSummary struct {
	Totals summaryTotals `json:"totals"`
	Series []summaryDay  `json:"series"`
	Top    []topEntryStat `json:"topEntries"`
}

type topEntryStat struct {
	PublicID     string `json:"publicId"`
	Title        string `json:"title"`
	Plays        int64  `json:"plays"`
	WatchSeconds int64  `json:"watchSeconds"`
	Bytes        int64  `json:"bytes"`
}

type summaryTotals struct {
	Entries      int64 `json:"entries"`
	Plays        int64 `json:"plays"`
	WatchSeconds int64 `json:"watchSeconds"`
	Bytes        int64 `json:"bytes"`
}

type summaryDay struct {
	Day           string `json:"day"`
	Plays         int64  `json:"plays"`
	WatchSeconds  int64  `json:"watchSeconds"`
	Bytes         int64  `json:"bytes"`
	UniqueViewers int64  `json:"uniqueViewers"`
}

func (s *Server) handleAnalyticsSummary(w http.ResponseWriter, r *http.Request) {
	var out analyticsSummary
	if err := s.pool.QueryRow(r.Context(), `
		SELECT count(*),
		       coalesce(sum(plays), 0),
		       coalesce(sum(watch_seconds), 0),
		       coalesce(sum(bytes), 0)
		FROM analytics_totals`).
		Scan(&out.Totals.Entries, &out.Totals.Plays, &out.Totals.WatchSeconds, &out.Totals.Bytes); err != nil {
		s.internalError(w, r, "analytics totals", err)
		return
	}

	rows, err := s.pool.Query(r.Context(), `
		SELECT d.day::text, coalesce(sum(d.plays), 0), coalesce(sum(d.watch_seconds), 0), coalesce(sum(d.bytes), 0),
		       (SELECT count(*) FROM analytics_viewers v WHERE v.day = d.day)
		FROM analytics_daily d
		WHERE d.day >= current_date - 13
		GROUP BY d.day ORDER BY d.day`)
	if err != nil {
		s.internalError(w, r, "analytics series", err)
		return
	}
	defer rows.Close()
	out.Series = []summaryDay{}
	for rows.Next() {
		var d summaryDay
		if err := rows.Scan(&d.Day, &d.Plays, &d.WatchSeconds, &d.Bytes, &d.UniqueViewers); err != nil {
			s.internalError(w, r, "analytics series", err)
			return
		}
		out.Series = append(out.Series, d)
	}
	if err := rows.Err(); err != nil {
		s.internalError(w, r, "analytics series", err)
		return
	}

	top, err := s.pool.Query(r.Context(), `
		SELECT e.public_id::text, coalesce(e.title, ''), t.plays, t.watch_seconds, t.bytes
		FROM analytics_totals t
		JOIN entries e ON e.id = t.entry_id
		ORDER BY t.plays DESC, t.watch_seconds DESC
		LIMIT 10`)
	if err != nil {
		s.internalError(w, r, "analytics top", err)
		return
	}
	defer top.Close()
	out.Top = []topEntryStat{}
	for top.Next() {
		var e topEntryStat
		if err := top.Scan(&e.PublicID, &e.Title, &e.Plays, &e.WatchSeconds, &e.Bytes); err != nil {
			s.internalError(w, r, "analytics top", err)
			return
		}
		out.Top = append(out.Top, e)
	}
	if err := top.Err(); err != nil {
		s.internalError(w, r, "analytics top", err)
		return
	}

	writeJSON(w, http.StatusOK, out)
}
