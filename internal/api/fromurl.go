package api

import (
	"context"
	"errors"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/parasetam0l/vidsilo/internal/db"
	"github.com/parasetam0l/vidsilo/internal/safeurl"
)

// registerFromURLRoutes: URL import — a validation pass ("Check URLs") and
// the submit that creates entries + enqueues worker downloads, plus progress
// polling for the active downloads.
func (s *Server) registerFromURLRoutes(mux *http.ServeMux) {
	mux.Handle("POST /api/entries/from-url/check", s.requireRole(roleUploader, roleEditor, roleAdmin)(http.HandlerFunc(s.handleFromURLCheck)))
	mux.Handle("POST /api/entries/from-url", s.requireRole(roleUploader, roleEditor, roleAdmin)(http.HandlerFunc(s.handleFromURLSubmit)))
	mux.Handle("GET /api/url-downloads", s.requireRole(roleUploader, roleEditor, roleAdmin)(http.HandlerFunc(s.handleURLDownloads)))
}

type urlCheckItem struct {
	URL      string `json:"url"`
	OK       bool   `json:"ok"`
	Reason   string `json:"reason,omitempty"`
	FileName string `json:"fileName,omitempty"`
}

// checkURL validates scheme, SSRF safety and extension against the allowed
// upload extensions. URLs whose path carries no extension are followed
// (redirects included) to discover the type. Returns the suggested file name.
func (s *Server) checkURL(raw string) (fileName string, err error) {
	u, err := safeurl.Validate(context.Background(), raw)
	if err != nil {
		return "", err
	}
	name := path.Base(u.Path)
	ext := strings.ToLower(strings.TrimPrefix(path.Ext(name), "."))
	if ext == "" {
		// No extension in the path: follow the URL to learn the real type.
		final, resolvedExt, err := safeurl.Resolve(context.Background(), safeurl.Client(), raw, 10*time.Second)
		if err != nil {
			return "", err
		}
		ext = resolvedExt
		name = path.Base(final.Path)
		if !strings.HasSuffix(name, "."+ext) {
			name += "." + ext
		}
	}
	if name == "" || name == "." || name == "/" {
		return "", errors.New("url has no file name")
	}
	if ext == "" {
		return "", errors.New("cannot determine file type")
	}
	allowed := s.settings.StringSlice("upload.allowed_extensions", []string{"mp4", "mov", "mkv", "webm", "m4v", "avi"})
	for _, a := range allowed {
		if ext == a {
			return name, nil
		}
	}
	return "", errors.New("file extension ." + ext + " is not allowed")
}

func (s *Server) handleFromURLCheck(w http.ResponseWriter, r *http.Request) {
	var body struct {
		URLs []string `json:"urls"`
	}
	if err := decodeJSON(r, &body); err != nil || len(body.URLs) == 0 {
		writeError(w, http.StatusBadRequest, "bad_request", "provide a non-empty urls list")
		return
	}
	out := make([]urlCheckItem, 0, len(body.URLs))
	for _, raw := range body.URLs {
		item := urlCheckItem{URL: strings.TrimSpace(raw)}
		if item.URL == "" {
			item.Reason = "empty url"
		} else if name, err := s.checkURL(item.URL); err != nil {
			item.Reason = err.Error()
		} else {
			item.OK = true
			item.FileName = name
		}
		out = append(out, item)
	}
	writeJSON(w, http.StatusOK, out)
}

type fromURLResult struct {
	URL      string `json:"url"`
	OK       bool   `json:"ok"`
	Reason   string `json:"reason,omitempty"`
	EntryID  string `json:"entryId,omitempty"`
	FileName string `json:"fileName,omitempty"`
}

func (s *Server) handleFromURLSubmit(w http.ResponseWriter, r *http.Request) {
	var body struct {
		URLs       []string `json:"urls"`
		CategoryID *int64   `json:"categoryId"`
	}
	if err := decodeJSON(r, &body); err != nil || len(body.URLs) == 0 {
		writeError(w, http.StatusBadRequest, "bad_request", "provide a non-empty urls list")
		return
	}
	u := userFromContext(r.Context())
	out := make([]fromURLResult, 0, len(body.URLs))
	for _, raw := range body.URLs {
		item := fromURLResult{URL: strings.TrimSpace(raw)}
		if item.URL == "" {
			item.Reason = "empty url"
			out = append(out, item)
			continue
		}
		name, err := s.checkURL(item.URL)
		if err != nil {
			item.Reason = err.Error()
			out = append(out, item)
			continue
		}
		title := strings.TrimSuffix(name, path.Ext(name))
		var entryID int64
		err = s.pool.QueryRow(r.Context(), `
			INSERT INTO entries (title, description, category_id, uploaded_by, status)
			VALUES ($1, '', $2, $3, 'uploading')
			RETURNING id`, title, body.CategoryID, u.ID).Scan(&entryID)
		if err != nil {
			s.internalError(w, r, "create url entry", err)
			return
		}
		if err := db.CreateURLDownload(r.Context(), s.pool, entryID, item.URL); err != nil {
			s.internalError(w, r, "register download", err)
			return
		}
		// The queue serializes downloads: only the earliest queued download
		// job is claimable at a time.
		if _, err := s.queue.Enqueue(r.Context(), "download", entryID,
			map[string]any{"url": item.URL}, 2); err != nil {
			s.internalError(w, r, "enqueue download", err)
			return
		}
		e, err := db.EntryByID(r.Context(), s.pool, entryID)
		if err != nil {
			s.internalError(w, r, "reload entry", err)
			return
		}
		item.OK = true
		item.EntryID = e.PublicID
		item.FileName = name
		out = append(out, item)
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleURLDownloads(w http.ResponseWriter, r *http.Request) {
	list, err := db.ActiveURLDownloads(r.Context(), s.pool)
	if err != nil {
		s.internalError(w, r, "active url downloads", err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}
