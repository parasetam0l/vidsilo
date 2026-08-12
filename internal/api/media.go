package api

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/parasetam0l/vod-app/internal/db"
	"github.com/parasetam0l/vod-app/internal/store"
)

// registerMediaRoutes: range-capable /media serving with immutable caching,
// the playinfo endpoint, and the public/embed player pages.
func (s *Server) registerMediaRoutes(mux *http.ServeMux) {
	authed := s.optionalAuth
	mux.Handle("GET /media/{key...}", authed(s.mediaACL(http.HandlerFunc(s.handleMedia))))
	mux.Handle("HEAD /media/{key...}", authed(s.mediaACL(http.HandlerFunc(s.handleMedia))))
	mux.Handle("GET /play/{uuid}", http.HandlerFunc(s.handlePlayPage))
	mux.Handle("GET /play/{uuid}/playinfo.json", authed(http.HandlerFunc(s.handlePlayInfo)))
	mux.Handle("GET /embed/{uuid}", authed(s.embedACL(http.HandlerFunc(s.handleEmbedPage))))
}

// handleMedia streams a storage key with Range support and driver-appropriate
// cache headers. Segments/poster/sprite are immutable; playlists revalidate.
func (s *Server) handleMedia(w http.ResponseWriter, r *http.Request) {
	key := strings.TrimPrefix(r.PathValue("key"), "/")
	rc, err := s.store.Open(r.Context(), key)
	if err != nil {
		if err == store.ErrNotFound {
			writeError(w, http.StatusNotFound, "not_found", "media not found")
			return
		}
		s.internalError(w, r, "open media", err)
		return
	}
	defer rc.Close()

	// Server-measured bandwidth: every byte served counts toward the entry's
	// analytics. Zero extra requests.
	if entryID, err := store.EntryIDFromMediaKey(key); err == nil {
		rc = &countingReadSeeker{readSeeker: rc, addBytes: func(n int64) {
			s.analytics.AddBytes(entryID, n)
		}}
	}

	fi, err := s.store.Stat(r.Context(), key)
	if err != nil {
		s.internalError(w, r, "stat media", err)
		return
	}

	name := key[strings.LastIndex(key, "/")+1:]
	ct := contentType(name)
	header := w.Header()
	header.Set("Content-Type", ct)
	switch {
	case strings.HasSuffix(name, ".m3u8"):
		header.Set("Cache-Control", "no-cache")
	case strings.HasSuffix(name, ".ts"):
		header.Set("Cache-Control", "public, max-age=31536000, immutable")
	case strings.HasSuffix(name, ".jpg"), strings.HasSuffix(name, ".jpeg"):
		header.Set("Cache-Control", "public, max-age=31536000, immutable")
	default:
		header.Set("Cache-Control", "no-cache")
	}

	http.ServeContent(w, r, name, fi.ModTime, rc)
}

func contentType(name string) string {
	switch {
	case strings.HasSuffix(name, ".m3u8"):
		return "application/vnd.apple.mpegurl"
	case strings.HasSuffix(name, ".ts"):
		return "video/mp2t"
	case strings.HasSuffix(name, ".vtt"):
		return "text/vtt; charset=utf-8"
	case strings.HasSuffix(name, ".jpg"), strings.HasSuffix(name, ".jpeg"):
		return "image/jpeg"
	default:
		return "application/octet-stream"
	}
}

// countingReadSeeker reports bytes read to a callback (bandwidth analytics).
type countingReadSeeker struct {
	readSeeker
	addBytes func(n int64)
}

type readSeeker interface {
	io.Reader
	io.Seeker
	io.Closer
}

func (c *countingReadSeeker) Read(p []byte) (int, error) {
	n, err := c.readSeeker.Read(p)
	if n > 0 && c.addBytes != nil {
		c.addBytes(int64(n))
	}
	return n, err
}

// playInfo is what the player page needs to boot.
type playInfo struct {
	Title        string         `json:"title"`
	Description  string         `json:"description"`
	Status       db.EntryStatus `json:"status"`
	DurationMs   *int64         `json:"durationMs"`
	Master       string         `json:"master,omitempty"`
	Poster       string         `json:"poster,omitempty"`
	Sprite       string         `json:"sprite,omitempty"`
	SpriteFrames int            `json:"spriteFrames"`
	Subtitles    []subtitleOut  `json:"subtitles"`
	EmbedURL     string         `json:"embedUrl"`
	// Player is the resolved player design (entry's player, or the Default
	// one). Empty when the Default design is in effect.
	Player json.RawMessage `json:"player,omitempty"`
}

type subtitleOut struct {
	Lang  string `json:"lang"`
	Label string `json:"label"`
	URL   string `json:"url"`
}

func (s *Server) handlePlayInfo(w http.ResponseWriter, r *http.Request) {
	e, err := db.EntryByPublicID(r.Context(), s.pool, r.PathValue("uuid"))
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "entry not found")
		return
	}
	// Mirror the media ACL: private entries are invisible to anonymous
	// visitors (signed-in viewers may watch); access-denied entries are
	// invisible to everyone except editors/admins, who keep preview access.
	u := userFromContext(r.Context())
	if e.AccessDenied {
		if u.ID == 0 || (u.Role != db.RoleAdmin && u.Role != db.RoleEditor) {
			writeError(w, http.StatusForbidden, "forbidden", "video access denied")
			return
		}
	} else if !e.IsPublic && u.ID == 0 {
		writeError(w, http.StatusForbidden, "forbidden", "video access denied")
		return
	}
	if e.Status != db.StatusReady {
		writeJSON(w, http.StatusOK, playInfo{
			Title:   e.Title,
			Status:  e.Status,
			EmbedURL: "/embed/" + e.PublicID,
		})
		return
	}

	out := playInfo{
		Title:        e.Title,
		Description:  e.Description,
		Status:       e.Status,
		DurationMs:   e.DurationMS,
		Master:       "/media/" + strings.TrimPrefix(store.MasterKey(e.ID), "/"),
		SpriteFrames: e.SpriteFrames,
		Subtitles:    []subtitleOut{},
		EmbedURL:     "/embed/" + e.PublicID,
	}
	if cfg := s.resolvedPlayerConfig(r, e.PlayerID); len(cfg) > 2 {
		out.Player = cfg
	}
	if e.PosterKey != "" {
		out.Poster = "/media/" + strings.TrimPrefix(e.PosterKey, "/")
	}
	if e.SpriteKey != "" && e.SpriteFrames > 0 {
		out.Sprite = "/media/" + strings.TrimPrefix(e.SpriteKey, "/")
	}
	subs, err := db.ListSubtitles(r.Context(), s.pool, e.ID)
	if err == nil {
		for _, sub := range subs {
			out.Subtitles = append(out.Subtitles, subtitleOut{
				Lang: sub.Lang, Label: sub.Label,
				URL: "/media/" + strings.TrimPrefix(sub.VTTKey, "/"),
			})
		}
	}
	writeJSON(w, http.StatusOK, out)
}

// serveStaticPage serves a pre-rendered static export page.
func (s *Server) serveStaticPage(w http.ResponseWriter, r *http.Request, file string) {
	rc, err := s.uiFS.Open(file)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "page not found")
		return
	}
	defer rc.Close()
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	_, _ = io.Copy(w, rc)
}

func (s *Server) handlePlayPage(w http.ResponseWriter, r *http.Request) {
	s.serveStaticPage(w, r, "play.html")
}

func (s *Server) handleEmbedPage(w http.ResponseWriter, r *http.Request) {
	s.serveStaticPage(w, r, "embed.html")
}
