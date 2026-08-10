package api

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/parasetam0l/vod-app/internal/db"
	"github.com/parasetam0l/vod-app/internal/store"
)

func (s *Server) registerEntryRoutes(mux *http.ServeMux, tusHandler http.Handler) {
	// Uploads: authenticated users may create; tus protocol under /upload/.
	mux.Handle("/upload/", s.requireRole(roleUploader, roleEditor, roleAdmin)(tusHandler))
	mux.Handle("HEAD /upload/", s.requireRole(roleUploader, roleEditor, roleAdmin)(tusHandler))

	// Catalog (any authenticated user).
	mux.Handle("GET /api/entries", s.requireAuth(http.HandlerFunc(s.handleEntriesList)))
	mux.Handle("GET /api/entries/{id}", s.requireAuth(http.HandlerFunc(s.handleEntryGet)))

	// Editing: editors+; uploaders may edit their own entries.
	mux.Handle("PATCH /api/entries/{id}", s.requireRole(roleEditor, roleAdmin)(http.HandlerFunc(s.handleEntryPatch)))
	mux.Handle("DELETE /api/entries/{id}", s.requireRole(roleEditor, roleAdmin)(http.HandlerFunc(s.handleEntryDelete)))

	mux.Handle("POST /api/entries/{id}/reprocess", s.requireRole(roleEditor, roleAdmin)(http.HandlerFunc(s.handleEntryReprocess)))
	mux.Handle("POST /api/entries/{id}/flavors", s.requireRole(roleEditor, roleAdmin)(http.HandlerFunc(s.handleEntryFlavors)))
	mux.Handle("GET /api/entries/{id}/embed", s.requireRole(roleEditor, roleAdmin)(http.HandlerFunc(s.handleEntryEmbedGet)))
	mux.Handle("PATCH /api/entries/{id}/embed", s.requireRole(roleEditor, roleAdmin)(http.HandlerFunc(s.handleEntryEmbedPatch)))
	mux.Handle("POST /api/entries/{id}/poster", s.requireRole(roleEditor, roleAdmin)(http.HandlerFunc(s.handleEntryPoster)))
	mux.Handle("POST /api/entries/{id}/subtitles", s.requireRole(roleEditor, roleAdmin)(http.HandlerFunc(s.handleEntrySubtitleAdd)))
	mux.Handle("DELETE /api/entries/{id}/subtitles/{sid}", s.requireRole(roleEditor, roleAdmin)(http.HandlerFunc(s.handleEntrySubtitleDelete)))
}

const (
	roleAdmin    = "admin"
	roleEditor   = "editor"
	roleUploader = "uploader"
	roleViewer   = "viewer"
)

func (s *Server) pathID(r *http.Request) (int64, error) {
	return strconv.ParseInt(r.PathValue("id"), 10, 64)
}

func (s *Server) entryOr404(w http.ResponseWriter, r *http.Request) (db.Entry, bool) {
	id, err := s.pathID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid entry id")
		return db.Entry{}, false
	}
	e, err := db.EntryByID(r.Context(), s.pool, id)
	if errors.Is(err, db.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "entry not found")
		return db.Entry{}, false
	}
	if err != nil {
		s.internalError(w, r, "load entry", err)
		return db.Entry{}, false
	}
	return e, true
}

func (s *Server) handleEntriesList(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	limit, _ := strconv.Atoi(q.Get("limit"))
	category, _ := strconv.ParseInt(q.Get("category"), 10, 64)
	uploader, _ := strconv.ParseInt(q.Get("uploader"), 10, 64)

	list, err := db.ListEntries(r.Context(), s.pool, db.EntryFilter{
		Q:        q.Get("q"),
		Status:   q.Get("status"),
		Category: category,
		Uploader: uploader,
		Page:     page,
		Limit:    limit,
	})
	if err != nil {
		s.internalError(w, r, "list entries", err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

type entryDetail struct {
	db.Entry
	Flavors     []db.EntryFlavor `json:"flavors"`
	Subtitles   []db.Subtitle    `json:"subtitles"`
	UploaderName string          `json:"uploaderName"`
}

func (s *Server) handleEntryGet(w http.ResponseWriter, r *http.Request) {
	e, ok := s.entryOr404(w, r)
	if !ok {
		return
	}
	flavors, err := db.EntryFlavors(r.Context(), s.pool, e.ID)
	if err != nil {
		s.internalError(w, r, "entry flavors", err)
		return
	}
	subs, err := db.ListSubtitles(r.Context(), s.pool, e.ID)
	if err != nil {
		s.internalError(w, r, "entry subtitles", err)
		return
	}
	detail := entryDetail{Entry: e, Flavors: flavors, Subtitles: subs}
	if e.UploadedBy != nil {
		if u, err := db.UserByID(r.Context(), s.pool, *e.UploadedBy); err == nil {
			detail.UploaderName = u.Username
		}
	}
	writeJSON(w, http.StatusOK, detail)
}

func (s *Server) handleEntryPatch(w http.ResponseWriter, r *http.Request) {
	e, ok := s.entryOr404(w, r)
	if !ok {
		return
	}
	var patch db.EntryPatch
	if err := decodeJSON(r, &patch); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid JSON body")
		return
	}
	updated, err := db.UpdateEntry(r.Context(), s.pool, e.ID, patch)
	if err != nil {
		s.internalError(w, r, "update entry", err)
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) handleEntryDelete(w http.ResponseWriter, r *http.Request) {
	e, ok := s.entryOr404(w, r)
	if !ok {
		return
	}
	// Remove media from the store (best effort per key).
	keys := []string{e.SourceKey, e.PosterKey, e.SpriteKey}
	for _, k := range keys {
		if k != "" {
			_ = s.store.Delete(r.Context(), k)
		}
	}
	if e.SpriteFrames > 0 {
		_ = s.store.Delete(r.Context(), "/entries/"+strconv.FormatInt(e.ID, 10))
	}
	if err := db.DeleteEntry(r.Context(), s.pool, e.ID); err != nil {
		s.internalError(w, r, "delete entry", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleEntryReprocess(w http.ResponseWriter, r *http.Request) {
	e, ok := s.entryOr404(w, r)
	if !ok {
		return
	}
	if e.Status == db.StatusUploading || e.SourceKey == "" {
		writeError(w, http.StatusConflict, "conflict", "entry has no source media yet")
		return
	}
	if _, err := s.queue.Enqueue(r.Context(), "probe", e.ID, map[string]any{}, 3); err != nil {
		s.internalError(w, r, "enqueue reprocess", err)
		return
	}
	_, _ = s.pool.Exec(r.Context(), `
		UPDATE entries SET status = 'probing', error = NULL, updated_at = now() WHERE id = $1`, e.ID)
	w.WriteHeader(http.StatusAccepted)
}

func (s *Server) handleEntryFlavors(w http.ResponseWriter, r *http.Request) {
	e, ok := s.entryOr404(w, r)
	if !ok {
		return
	}
	var body struct {
		FlavorIDs []int64 `json:"flavorIds"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid JSON body")
		return
	}
	if err := db.SetEntryFlavors(r.Context(), s.pool, e.ID, body.FlavorIDs); err != nil {
		s.internalError(w, r, "set entry flavors", err)
		return
	}
	if _, err := s.queue.Enqueue(r.Context(), "probe", e.ID, map[string]any{}, 3); err != nil {
		s.internalError(w, r, "enqueue reprocess", err)
		return
	}
	_, _ = s.pool.Exec(r.Context(), `
		UPDATE entries SET status = 'probing', error = NULL, updated_at = now() WHERE id = $1`, e.ID)
	w.WriteHeader(http.StatusAccepted)
}

type embedBody struct {
	Policy  db.EmbedPolicy `json:"policy"`
	Domains []string       `json:"domains"`
}

func (s *Server) handleEntryEmbedGet(w http.ResponseWriter, r *http.Request) {
	e, ok := s.entryOr404(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, embedBody{Policy: e.EmbedPolicy, Domains: e.EmbedDomains})
}

func (s *Server) handleEntryEmbedPatch(w http.ResponseWriter, r *http.Request) {
	e, ok := s.entryOr404(w, r)
	if !ok {
		return
	}
	var body embedBody
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid JSON body")
		return
	}
	if body.Policy != db.EmbedDefault && body.Policy != db.EmbedAll &&
		body.Policy != db.EmbedSameOrigin && body.Policy != db.EmbedAllowlist {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid embed policy")
		return
	}
	if _, err := s.pool.Exec(r.Context(), `
		UPDATE entries SET embed_policy = $1, embed_domains = $2, updated_at = now() WHERE id = $3`,
		body.Policy, body.Domains, e.ID); err != nil {
		s.internalError(w, r, "update embed policy", err)
		return
	}
	writeJSON(w, http.StatusOK, body)
}

func (s *Server) handleEntryPoster(w http.ResponseWriter, r *http.Request) {
	e, ok := s.entryOr404(w, r)
	if !ok {
		return
	}
	var body struct {
		Frame int `json:"frame"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid JSON body")
		return
	}
	if e.SpriteKey == "" || e.SpriteFrames == 0 {
		writeError(w, http.StatusConflict, "conflict", "no sprite sheet available yet")
		return
	}
	if body.Frame < 0 || body.Frame >= e.SpriteFrames {
		writeError(w, http.StatusBadRequest, "bad_request", "frame out of range")
		return
	}
	if err := s.media.ExtractPoster(r.Context(), e.ID, body.Frame); err != nil {
		s.internalError(w, r, "extract poster", err)
		return
	}
	_, _ = s.pool.Exec(r.Context(), `
		UPDATE entries SET poster_key = $1, updated_at = now() WHERE id = $2`,
		store.PosterKey(e.ID), e.ID)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleEntrySubtitleAdd(w http.ResponseWriter, r *http.Request) {
	e, ok := s.entryOr404(w, r)
	if !ok {
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "multipart field 'file' required")
		return
	}
	defer file.Close()
	if !strings.HasSuffix(strings.ToLower(header.Filename), ".vtt") {
		writeError(w, http.StatusBadRequest, "bad_request", "only .vtt subtitle files are accepted")
		return
	}
	lang := r.FormValue("lang")
	if lang == "" {
		lang = "en"
	}
	key := store.SubtitleKey(e.ID, lang)
	if err := s.store.Put(r.Context(), key, file, header.Size); err != nil {
		s.internalError(w, r, "store subtitle", err)
		return
	}
	sub, err := db.AddSubtitle(r.Context(), s.pool, e.ID, lang, r.FormValue("label"), key)
	if err != nil {
		s.internalError(w, r, "add subtitle", err)
		return
	}
	writeJSON(w, http.StatusCreated, sub)
}

func (s *Server) handleEntrySubtitleDelete(w http.ResponseWriter, r *http.Request) {
	e, ok := s.entryOr404(w, r)
	if !ok {
		return
	}
	sid, err := strconv.ParseInt(r.PathValue("sid"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid subtitle id")
		return
	}
	subs, err := db.ListSubtitles(r.Context(), s.pool, e.ID)
	if err != nil {
		s.internalError(w, r, "list subtitles", err)
		return
	}
	for _, sub := range subs {
		if sub.ID == sid {
			_ = s.store.Delete(r.Context(), sub.VTTKey)
		}
	}
	if err := db.DeleteSubtitle(r.Context(), s.pool, e.ID, sid); err != nil {
		s.internalError(w, r, "delete subtitle", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
