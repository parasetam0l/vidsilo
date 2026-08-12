package api

import (
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/parasetam0l/vod-app/internal/db"
	"github.com/parasetam0l/vod-app/internal/media"
	"github.com/parasetam0l/vod-app/internal/store"
)

func (s *Server) registerEntryRoutes(mux *http.ServeMux, tusHandler http.Handler) {
	// Uploads: authenticated users may create; tus protocol under /upload/.
	// Rate-limited like the rest of the API (the tus routes are outside /api/*).
	tus := s.rateLimit(s.apiLimiter, tusHandler)
	mux.Handle("/upload/", s.requireRole(roleUploader, roleEditor, roleAdmin)(tus))
	mux.Handle("HEAD /upload/", s.requireRole(roleUploader, roleEditor, roleAdmin)(tus))

	// Catalog (any authenticated user). Entries are addressed by their public
	// uuid everywhere in the API; the internal sequential id never leaks.
	mux.Handle("GET /api/entries", s.requireAuth(http.HandlerFunc(s.handleEntriesList)))
	mux.Handle("GET /api/entries/{publicId}", s.requireAuth(http.HandlerFunc(s.handleEntryGet)))

	// Editing: editors+; uploaders may edit their own entries.
	mux.Handle("PATCH /api/entries/{publicId}", s.requireRole(roleEditor, roleAdmin)(http.HandlerFunc(s.handleEntryPatch)))
	mux.Handle("DELETE /api/entries/{publicId}", s.requireRole(roleEditor, roleAdmin)(http.HandlerFunc(s.handleEntryDelete)))

	mux.Handle("POST /api/entries/{publicId}/reprocess", s.requireRole(roleEditor, roleAdmin)(http.HandlerFunc(s.handleEntryReprocess)))
	mux.Handle("POST /api/entries/reprocess", s.requireRole(roleEditor, roleAdmin)(http.HandlerFunc(s.handleEntriesReprocess)))
	mux.Handle("POST /api/entries/{publicId}/flavors", s.requireRole(roleEditor, roleAdmin)(http.HandlerFunc(s.handleEntryFlavors)))
	mux.Handle("POST /api/entries/{publicId}/subtitles", s.requireRole(roleEditor, roleAdmin)(http.HandlerFunc(s.handleEntrySubtitleAdd)))
	mux.Handle("DELETE /api/entries/{publicId}/subtitles/{sid}", s.requireRole(roleEditor, roleAdmin)(http.HandlerFunc(s.handleEntrySubtitleDelete)))
}

const (
	roleAdmin    = "admin"
	roleEditor   = "editor"
	roleUploader = "uploader"
	roleViewer   = "viewer"
)

// entryOr404 resolves the public uuid from the path into the internal entry.
func (s *Server) entryOr404(w http.ResponseWriter, r *http.Request) (db.Entry, bool) {
	publicID := r.PathValue("publicId")
	if publicID == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid entry id")
		return db.Entry{}, false
	}
	e, err := db.EntryByPublicID(r.Context(), s.pool, publicID)
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
			detail.UploaderName = u.DisplayName()
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
	if patch.DomainACLID.Set && patch.DomainACLID.Value != nil {
		if _, err := db.ACLByID(r.Context(), s.pool, *patch.DomainACLID.Value); err != nil {
			writeError(w, http.StatusBadRequest, "bad_request", "unknown domain acl")
			return
		}
	}
	if patch.PlayerID.Set && patch.PlayerID.Value != nil {
		if _, err := db.PlayerByID(r.Context(), s.pool, *patch.PlayerID.Value); err != nil {
			writeError(w, http.StatusBadRequest, "bad_request", "unknown player")
			return
		}
	}
	if patch.PosterFrame != nil {
		if e.SpriteKey == "" || e.SpriteFrames == 0 {
			writeError(w, http.StatusConflict, "conflict", "no sprite sheet available yet")
			return
		}
		if *patch.PosterFrame < 0 || *patch.PosterFrame >= e.SpriteFrames {
			writeError(w, http.StatusBadRequest, "bad_request", "poster frame out of range")
			return
		}
		if err := s.media.ExtractPoster(r.Context(), e.ID, *patch.PosterFrame); err != nil {
			s.internalError(w, r, "extract poster", err)
			return
		}
	}
	updated, err := db.UpdateEntry(r.Context(), s.pool, e.ID, patch)
	if err != nil {
		s.internalError(w, r, "update entry", err)
		return
	}
	if patch.PosterFrame != nil {
		_, err := s.pool.Exec(r.Context(), `
			UPDATE entries SET poster_key = $1, poster_frame = $2, updated_at = now()
			WHERE id = $3`,
			store.PosterKey(e.ID), *patch.PosterFrame, e.ID)
		if err != nil {
			s.internalError(w, r, "update poster key", err)
			return
		}
		updated, err = db.EntryByID(r.Context(), s.pool, e.ID)
		if err != nil {
			s.internalError(w, r, "reload entry", err)
			return
		}
	}
	if patch.FlavorIDs != nil {
		if err := s.applyFlavors(r.Context(), e.ID, *patch.FlavorIDs); err != nil {
			s.internalError(w, r, "apply flavors", err)
			return
		}
		updated, err = db.EntryByID(r.Context(), s.pool, e.ID)
		if err != nil {
			s.internalError(w, r, "reload entry", err)
			return
		}
	}
	writeJSON(w, http.StatusOK, updated)
}

// applyFlavors applies a flavor-set change WITHOUT re-processing the whole
// entry: flavors that were added get a transcode job, flavors that were
// removed have their media deleted, and the master playlist is rebuilt from
// the remaining done flavors. No probe, no re-encoding of untouched flavors.
func (s *Server) applyFlavors(ctx context.Context, entryID int64, flavorIDs []int64) error {
	current, err := db.EntryFlavors(ctx, s.pool, entryID)
	if err != nil {
		return err
	}
	want := map[int64]bool{}
	for _, id := range flavorIDs {
		want[id] = true
	}
	have := map[int64]bool{}
	for _, ef := range current {
		have[ef.FlavorID] = true
	}

	var added, removed []int64
	for _, id := range flavorIDs {
		if !have[id] {
			added = append(added, id)
		}
	}
	for _, ef := range current {
		if !want[ef.FlavorID] {
			removed = append(removed, ef.FlavorID)
		}
	}

	for _, id := range added {
		if err := s.prepareFlavor(ctx, entryID, id); err != nil {
			return err
		}
	}
	for _, id := range removed {
		if err := s.removeFlavor(ctx, entryID, id); err != nil {
			return err
		}
	}

	e, err := db.EntryByID(ctx, s.pool, entryID)
	if err != nil {
		return err
	}
	if len(added) > 0 {
		// Transcode jobs for the new flavors will finalize (master + ready).
		_, _ = s.pool.Exec(ctx, `
			UPDATE entries SET status = 'probing', error = NULL, updated_at = now() WHERE id = $1`, entryID)
	}
	if err := s.rebuildMaster(ctx, e); err != nil {
		return err
	}
	// Pure removal that leaves no finished rendition: don't keep a
	// playable-looking entry with an empty master playlist.
	if len(added) == 0 {
		var doneCount int
		if err := s.pool.QueryRow(ctx, `
			SELECT count(*) FROM entry_flavors WHERE entry_id = $1 AND status = 'done'`, entryID).Scan(&doneCount); err != nil {
			return err
		}
		if doneCount == 0 {
			_, err = s.pool.Exec(ctx, `
				UPDATE entries SET status = 'failed', error = 'no enabled flavors produce renditions', updated_at = now()
				WHERE id = $1`, entryID)
			return err
		}
	}
	return nil
}

// prepareFlavor inserts a pending flavor row and enqueues its transcode job.
func (s *Server) prepareFlavor(ctx context.Context, entryID, flavorID int64) error {
	if _, err := s.pool.Exec(ctx, `
		INSERT INTO entry_flavors (entry_id, flavor_id, status)
		VALUES ($1, $2, 'pending')
		ON CONFLICT (entry_id, flavor_id) DO UPDATE
			SET status = 'pending', error = NULL, updated_at = now()`, entryID, flavorID); err != nil {
		return err
	}
	if _, err := s.queue.Enqueue(ctx, "transcode", entryID, map[string]any{"flavorId": flavorID}, 3); err != nil {
		return err
	}
	return nil
}

// removeFlavor deletes the flavor's media files and its row.
func (s *Server) removeFlavor(ctx context.Context, entryID int64, flavorID int64) error {
	f, err := db.FlavorByID(ctx, s.pool, flavorID)
	if err != nil {
		return err
	}
	prefix := store.FlavorDir(entryID, f.Name)
	if keys, err := s.store.List(ctx, prefix); err == nil {
		for _, k := range keys {
			if err := s.store.Delete(ctx, k); err != nil {
				s.Log.Warn("flavor file delete", "key", k, "err", err)
			}
		}
	}
	if l, ok := s.store.(*store.Local); ok {
		_ = l.RemoveTree(prefix)
	}
	_, err = s.pool.Exec(ctx, `DELETE FROM entry_flavors WHERE entry_id = $1 AND flavor_id = $2`, entryID, flavorID)
	return err
}

// rebuildMaster regenerates master.m3u8 from the finished flavors + subs.
func (s *Server) rebuildMaster(ctx context.Context, e db.Entry) error {
	flavors, err := db.EntryFlavors(ctx, s.pool, e.ID)
	if err != nil {
		return err
	}
	subs, err := db.ListSubtitles(ctx, s.pool, e.ID)
	if err != nil {
		return err
	}
	var renditions []media.Rendition
	for _, ef := range flavors {
		if ef.Status != db.FlavorDone {
			continue
		}
		f, err := db.FlavorByID(ctx, s.pool, ef.FlavorID)
		if err != nil {
			continue
		}
		bitrate := 0
		if f.VideoBitrate != nil {
			bitrate = *f.VideoBitrate
		}
		renditions = append(renditions, media.Rendition{
			Name:        f.Name,
			Height:      f.Height,
			Bitrate:     bitrate,
			PlaylistKey: "/media/" + strings.TrimPrefix(ef.PlaylistKey, "/"),
		})
	}
	var subRends []media.SubtitleRendition
	for _, sub := range subs {
		subRends = append(subRends, media.SubtitleRendition{
			Lang: sub.Lang, Label: sub.Label,
			URI: "/media/" + strings.TrimPrefix(sub.VTTKey, "/"),
		})
	}
	var b strings.Builder
	if err := media.BuildMasterPlaylist(&b, renditions, subRends); err != nil {
		return err
	}
	return s.store.Put(ctx, store.MasterKey(e.ID), strings.NewReader(b.String()), int64(b.Len()))
}

func (s *Server) handleEntryDelete(w http.ResponseWriter, r *http.Request) {
	e, ok := s.entryOr404(w, r)
	if !ok {
		return
	}
	// Drop spool files of any in-flight tus upload tied to this entry.
	if s.spoolDir != "" {
		if rows, err := s.pool.Query(r.Context(),
			`SELECT upload_id FROM uploads WHERE entry_id = $1`, e.ID); err == nil {
			for rows.Next() {
				var id string
				if rows.Scan(&id) == nil {
					_ = os.Remove(filepath.Join(s.spoolDir, id))
				}
			}
			rows.Close()
		}
	}

	// Remove all media under the entry's storage subtree (original, flavors,
	// poster, sprite, subtitles) before dropping the catalog row.
	prefix := strconv.FormatInt(e.ID, 10)
	deleteMedia := func() {
		keys, err := s.store.List(r.Context(), "entries/"+prefix)
		if err != nil {
			s.Log.Warn("entry media list", "err", err)
			return
		}
		for _, k := range keys {
			if err := s.store.Delete(r.Context(), k); err != nil {
				s.Log.Warn("entry media delete", "key", k, "err", err)
			}
		}
		// The local driver leaves empty directories behind — remove the
		// whole subtree so nothing remains (unwraps Fallback/Cache).
		if l := store.LocalOf(s.store); l != nil {
			if err := l.RemoveTree("entries/" + prefix); err != nil {
				s.Log.Warn("entry media tree remove", "err", err)
			}
		}
	}
	deleteMedia()
	if err := db.DeleteEntry(r.Context(), s.pool, e.ID); err != nil {
		s.internalError(w, r, "delete entry", err)
		return
	}
	// Second pass: catch anything a racing worker wrote between the first
	// pass and the row delete (in-flight ffmpeg/downloads).
	deleteMedia()
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

// handleEntriesReprocess re-queues a batch of entries (bulk action).
func (s *Server) handleEntriesReprocess(w http.ResponseWriter, r *http.Request) {
	var body struct {
		PublicIDs []string `json:"publicIds"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid JSON body")
		return
	}
	if len(body.PublicIDs) == 0 || len(body.PublicIDs) > 100 {
		writeError(w, http.StatusBadRequest, "bad_request", "provide 1-100 publicIds")
		return
	}
	queued := 0
	for _, publicID := range body.PublicIDs {
		e, err := db.EntryByPublicID(r.Context(), s.pool, publicID)
		if err != nil || e.SourceKey == "" {
			continue // unknown or not yet uploaded
		}
		if _, err := s.queue.Enqueue(r.Context(), "probe", e.ID, map[string]any{}, 3); err != nil {
			continue
		}
		_, _ = s.pool.Exec(r.Context(), `
			UPDATE entries SET status = 'probing', error = NULL, updated_at = now() WHERE id = $1`, e.ID)
		queued++
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"queued": queued})
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
	if err := s.applyFlavors(r.Context(), e.ID, body.FlavorIDs); err != nil {
		s.internalError(w, r, "apply flavors", err)
		return
	}
	w.WriteHeader(http.StatusAccepted)
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
