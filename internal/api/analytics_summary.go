package api

import (
	"errors"
	"net/http"
	"time"
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

// analyticsRange resolves the from/to window (YYYY-MM-DD). Absent params
// default to the trailing 14 days; the span is validated and capped.
func analyticsRange(r *http.Request) (from, to string, err error) {
	q := r.URL.Query()
	from, to = q.Get("from"), q.Get("to")
	today := time.Now().UTC().Format("2006-01-02")
	if from == "" && to == "" {
		return time.Now().UTC().AddDate(0, 0, -13).Format("2006-01-02"), today, nil
	}
	if from == "" {
		from = today
	}
	if to == "" {
		to = today
	}
	f, err1 := time.Parse("2006-01-02", from)
	t, err2 := time.Parse("2006-01-02", to)
	if err1 != nil || err2 != nil {
		return "", "", errors.New("dates must be YYYY-MM-DD")
	}
	if t.Before(f) {
		return "", "", errors.New("from must not be after to")
	}
	if t.Sub(f) > 366*24*time.Hour {
		return "", "", errors.New("range too wide (max 366 days)")
	}
	return from, to, nil
}

func (s *Server) handleAnalyticsSummary(w http.ResponseWriter, r *http.Request) {
	from, to, err := analyticsRange(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}

	var out analyticsSummary
	// Totals within the window (the all-time analytics_totals table cannot
	// express a range, so it is aggregated from the daily table).
	if err := s.pool.QueryRow(r.Context(), `
		SELECT count(DISTINCT entry_id),
		       coalesce(sum(plays), 0),
		       coalesce(sum(watch_seconds), 0),
		       coalesce(sum(bytes), 0)
		FROM analytics_daily WHERE day BETWEEN $1 AND $2`, from, to).
		Scan(&out.Totals.Entries, &out.Totals.Plays, &out.Totals.WatchSeconds, &out.Totals.Bytes); err != nil {
		s.internalError(w, r, "analytics totals", err)
		return
	}

	rows, err := s.pool.Query(r.Context(), `
		SELECT d.day::text, coalesce(sum(d.plays), 0), coalesce(sum(d.watch_seconds), 0), coalesce(sum(d.bytes), 0),
		       (SELECT count(*) FROM analytics_viewers v WHERE v.day = d.day)
		FROM analytics_daily d
		WHERE d.day BETWEEN $1 AND $2
		GROUP BY d.day ORDER BY d.day`, from, to)
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
		SELECT e.public_id::text, coalesce(e.title, ''), coalesce(sum(d.plays), 0),
		       coalesce(sum(d.watch_seconds), 0), coalesce(sum(d.bytes), 0)
		FROM analytics_daily d
		JOIN entries e ON e.id = d.entry_id
		WHERE d.day BETWEEN $1 AND $2
		GROUP BY e.id
		ORDER BY 3 DESC, 4 DESC
		LIMIT 10`, from, to)
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
