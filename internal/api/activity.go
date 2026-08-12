package api

import (
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
)

// Server-side view of in-flight work, shared by every signed-in user:
// active uploads (tus) and current jobs (probe/transcode). Progress for
// uploads comes from the local spool file size (the single-node topology).

type uploadActivity struct {
	ID        string    `json:"id"`
	EntryID   int64     `json:"entryId"`
	Title     string    `json:"title"`
	Uploader  string    `json:"uploader"`
	Size      int64     `json:"size"`
	Offset    int64     `json:"offset"`
	Progress  int       `json:"progress"`
	CreatedAt time.Time `json:"createdAt"`
}

type jobActivity struct {
	ID         int64     `json:"id"`
	Type       string    `json:"type"`
	EntryID    *int64    `json:"entryId"`
	EntryTitle string    `json:"entryTitle"`
	Status     string    `json:"status"`
	Attempts   int       `json:"attempts"`
	Error      string    `json:"error,omitempty"`
	Progress   string    `json:"progress,omitempty"`
	Label      string    `json:"label,omitempty"`
	Paused     bool      `json:"paused"`
	CreatedAt  time.Time `json:"createdAt"`
}

const jobSelect = `
	SELECT j.id, j.type, j.entry_id, coalesce(e.title, ''), j.status,
	       j.attempts, coalesce(j.error, ''), coalesce(j.progress, ''),
	       coalesce(f.label, ''), j.pause_requested_at IS NOT NULL, j.created_at
	FROM jobs j
	LEFT JOIN entries e ON e.id = j.entry_id
	LEFT JOIN entry_flavors ef
	  ON ef.entry_id = j.entry_id AND ef.flavor_id = coalesce((j.payload->>'flavorId')::bigint, -1)
	LEFT JOIN flavors f ON f.id = ef.flavor_id`

func scanJobActivity(rows pgx.Rows) ([]jobActivity, error) {
	out := []jobActivity{}
	for rows.Next() {
		var j jobActivity
		if err := rows.Scan(&j.ID, &j.Type, &j.EntryID, &j.EntryTitle, &j.Status,
			&j.Attempts, &j.Error, &j.Progress, &j.Label, &j.Paused, &j.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, j)
	}
	return out, rows.Err()
}

func (s *Server) registerActivityRoutes(mux *http.ServeMux) {
	editor := s.requireRole(roleEditor, roleAdmin)
	mux.Handle("GET /api/uploads", editor(http.HandlerFunc(s.handleActiveUploads)))
	mux.Handle("GET /api/jobs", editor(http.HandlerFunc(s.handleJobs)))
	mux.Handle("POST /api/jobs/{id}/retry", editor(http.HandlerFunc(s.handleJobRetry)))
	mux.Handle("POST /api/jobs/{id}/pause", editor(http.HandlerFunc(s.handleJobPause)))
	mux.Handle("POST /api/jobs/{id}/resume", editor(http.HandlerFunc(s.handleJobResume)))
	mux.Handle("POST /api/jobs/{id}/cancel", editor(http.HandlerFunc(s.handleJobCancel)))
}

func (s *Server) handleJobs(w http.ResponseWriter, r *http.Request) {
	// Optional pagination (page/limit query params); the default plain array
	// keeps the admin UI compatible.
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	paginated := page > 0
	if !paginated {
		limit = 50
	} else {
		if limit <= 0 || limit > 100 {
			limit = 50
		}
	}
	offset := 0
	if paginated {
		offset = (page - 1) * limit
		if offset < 0 {
			offset = 0 // absurd page value: never a negative OFFSET
		}
	}
	rows, err := s.pool.Query(r.Context(), jobSelect+`
		ORDER BY j.id DESC
		LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		s.internalError(w, r, "list jobs", err)
		return
	}
	defer rows.Close()

	out, err := scanJobActivity(rows)
	if err != nil {
		s.internalError(w, r, "list jobs", err)
		return
	}
	if !paginated {
		writeJSON(w, http.StatusOK, out)
		return
	}
	var total int
	_ = s.pool.QueryRow(r.Context(), `SELECT count(*) FROM jobs`).Scan(&total)
	writeJSON(w, http.StatusOK, map[string]any{"items": out, "total": total, "page": page, "limit": limit})
}

// handleJobRetry re-queues a failed or cancelled job (attempts reset,
// immediate run).
func (s *Server) handleJobRetry(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid job id")
		return
	}
	tag, err := s.pool.Exec(r.Context(), `
		UPDATE jobs SET status = 'queued', attempts = 0, error = NULL,
		       run_at = now(), started_at = NULL, finished_at = NULL, updated_at = now()
		WHERE id = $1 AND status IN ('failed', 'cancelled')`, id)
	if err != nil {
		s.internalError(w, r, "retry job", err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusConflict, "conflict", "job is not in a retryable state")
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

func (s *Server) handleJobPause(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid job id")
		return
	}
	if err := s.queue.Pause(r.Context(), id); err != nil {
		s.internalError(w, r, "pause job", err)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

func (s *Server) handleJobResume(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid job id")
		return
	}
	if err := s.queue.Resume(r.Context(), id); err != nil {
		s.internalError(w, r, "resume job", err)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

func (s *Server) handleJobCancel(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid job id")
		return
	}
	if err := s.queue.RequestCancel(r.Context(), id); err != nil {
		s.internalError(w, r, "cancel job", err)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

func (s *Server) handleActiveUploads(w http.ResponseWriter, r *http.Request) {
	rows, err := s.pool.Query(r.Context(), `
		SELECT u.upload_id, u.entry_id, coalesce(e.title, ''),
		       coalesce(usr.email, ''), coalesce((u.meta->>'Size')::bigint, 0),
		       u.created_at
		FROM uploads u
		LEFT JOIN entries e ON e.id = u.entry_id
		LEFT JOIN users usr ON usr.id = e.uploaded_by
		ORDER BY u.created_at DESC`)
	if err != nil {
		s.internalError(w, r, "list uploads", err)
		return
	}
	defer rows.Close()

	out := []uploadActivity{}
	for rows.Next() {
		var a uploadActivity
		if err := rows.Scan(&a.ID, &a.EntryID, &a.Title, &a.Uploader, &a.Size, &a.CreatedAt); err != nil {
			s.internalError(w, r, "list uploads", err)
			return
		}
		// Progress = bytes on disk in the local spool.
		if s.spoolDir != "" && a.Size > 0 {
			if fi, err := os.Stat(filepath.Join(s.spoolDir, a.ID)); err == nil {
				a.Offset = fi.Size()
				if a.Offset > a.Size {
					a.Offset = a.Size
				}
				a.Progress = int((a.Offset * 100) / a.Size)
			}
		}
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		s.internalError(w, r, "list uploads", err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleCurrentJobs(w http.ResponseWriter, r *http.Request) {
	rows, err := s.pool.Query(r.Context(), jobSelect+`
		WHERE j.status IN ('queued', 'running', 'failed')
		ORDER BY j.id DESC
		LIMIT 20`)
	if err != nil {
		s.internalError(w, r, "list jobs", err)
		return
	}
	defer rows.Close()

	out, err := scanJobActivity(rows)
	if err != nil {
		s.internalError(w, r, "list jobs", err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}
