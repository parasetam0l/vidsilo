package api

import (
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"
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
	CreatedAt  time.Time `json:"createdAt"`
}

func (s *Server) registerActivityRoutes(mux *http.ServeMux) {
	editor := s.requireRole(roleEditor, roleAdmin)
	mux.Handle("GET /api/uploads", editor(http.HandlerFunc(s.handleActiveUploads)))
	mux.Handle("GET /api/jobs", editor(http.HandlerFunc(s.handleJobs)))
	mux.Handle("POST /api/jobs/{id}/retry", editor(http.HandlerFunc(s.handleJobRetry)))
}

func (s *Server) handleJobs(w http.ResponseWriter, r *http.Request) {
	rows, err := s.pool.Query(r.Context(), `
		SELECT j.id, j.type, j.entry_id, coalesce(e.title, ''), j.status,
		       j.attempts, coalesce(j.error, ''), j.created_at
		FROM jobs j
		LEFT JOIN entries e ON e.id = j.entry_id
		ORDER BY j.id DESC
		LIMIT 50`)
	if err != nil {
		s.internalError(w, r, "list jobs", err)
		return
	}
	defer rows.Close()

	out := []jobActivity{}
	for rows.Next() {
		var j jobActivity
		if err := rows.Scan(&j.ID, &j.Type, &j.EntryID, &j.EntryTitle, &j.Status,
			&j.Attempts, &j.Error, &j.CreatedAt); err != nil {
			s.internalError(w, r, "list jobs", err)
			return
		}
		out = append(out, j)
	}
	if err := rows.Err(); err != nil {
		s.internalError(w, r, "list jobs", err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// handleJobRetry re-queues a failed job (attempts reset, immediate run).
func (s *Server) handleJobRetry(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid job id")
		return
	}
	tag, err := s.pool.Exec(r.Context(), `
		UPDATE jobs SET status = 'queued', attempts = 0, error = NULL,
		       run_at = now(), started_at = NULL, finished_at = NULL, updated_at = now()
		WHERE id = $1 AND status = 'failed'`, id)
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
	rows, err := s.pool.Query(r.Context(), `
		SELECT j.id, j.type, j.entry_id, coalesce(e.title, ''), j.status,
		       j.attempts, coalesce(j.error, ''), j.created_at
		FROM jobs j
		LEFT JOIN entries e ON e.id = j.entry_id
		WHERE j.status IN ('queued', 'running', 'failed')
		ORDER BY j.id DESC
		LIMIT 20`)
	if err != nil {
		s.internalError(w, r, "list jobs", err)
		return
	}
	defer rows.Close()

	out := []jobActivity{}
	for rows.Next() {
		var j jobActivity
		if err := rows.Scan(&j.ID, &j.Type, &j.EntryID, &j.EntryTitle, &j.Status,
			&j.Attempts, &j.Error, &j.CreatedAt); err != nil {
			s.internalError(w, r, "list jobs", err)
			return
		}
		out = append(out, j)
	}
	if err := rows.Err(); err != nil {
		s.internalError(w, r, "list jobs", err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}
