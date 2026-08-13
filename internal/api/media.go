package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/parasetam0l/vod-app/internal/db"
	"github.com/parasetam0l/vod-app/internal/safeurl"
	"github.com/parasetam0l/vod-app/internal/store"
)

// registerMediaRoutes: range-capable /media serving with immutable caching,
// the playinfo endpoint, and the public/embed player pages.
func (s *Server) registerMediaRoutes(mux *http.ServeMux) {
	authed := s.optionalAuth
	// GET patterns also serve HEAD (ServeContent suppresses the body);
	// registering an explicit HEAD wildcard would conflict with the more
	// specific GET /media/branding/logo pattern below. /media is per-IP
	// rate-limited so public streams cannot be hammered for bandwidth.
	mux.Handle("GET /media/{key...}", s.rateLimit(s.mediaLimiter, authed(s.mediaACL(http.HandlerFunc(s.handleMedia)))))
	// Logo proxy for player branding: external logo URLs are fetched
	// server-side (SSRF-guarded) and served from our own origin, so the
	// strict img-src 'self' CSP keeps working. More specific than
	// /media/{key...}, so it wins.
	mux.Handle("GET /media/branding/logo", s.rateLimit(s.apiLimiter, http.HandlerFunc(s.handleBrandingLogo)))
	mux.Handle("GET /play/{uuid}", http.HandlerFunc(s.handlePlayPage))
	mux.Handle("GET /play/{uuid}/playinfo.json", authed(http.HandlerFunc(s.handlePlayInfo)))
	mux.Handle("GET /embed/{uuid}", authed(s.embedACL(http.HandlerFunc(s.handleEmbedPage))))
	// Compatibility: the library lived under /library/ until it moved to the
	// root; old links keep working.
	mux.Handle("GET /library/play/{uuid}", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/play/"+r.PathValue("uuid"), http.StatusMovedPermanently)
	}))

	// Public catalog: the library/browse page for end users. The category
	// tree is cached briefly; the entry list filters per visitor (private
	// entries for signed-in users) and stays uncached. optionalAuth so the
	// signed-in branch of handleCatalog actually runs; optionalViewer so
	// login_only mode can distinguish viewers from anonymous visitors.
	mux.Handle("GET /api/catalog", s.optionalViewer(s.optionalAuth(http.HandlerFunc(s.handleCatalog))))
	mux.Handle("GET /api/catalog/categories", s.cacheGET(30*time.Second, s.handleCatalogCategories))
}

// handleCatalogCategories serves the category tree with entry counts for the
// public library navigation (only categories containing visible entries).
func (s *Server) handleCatalogCategories(w http.ResponseWriter, r *http.Request) {
	rows, err := s.pool.Query(r.Context(), `
		SELECT c.id, c.parent_id, c.name, c.slug, c.position,
		       (SELECT count(*) FROM entries e
		        WHERE e.category_id = c.id
		          AND e.status = 'ready'
		          AND NOT e.access_denied
		          AND e.is_public) AS count
		FROM categories c
		ORDER BY c.position, c.id`)
	if err != nil {
		s.internalError(w, r, "catalog categories", err)
		return
	}
	defer rows.Close()
	flat := []db.Category{}
	counts := map[int64]int64{}
	for rows.Next() {
		var c db.Category
		var count int64
		if err := rows.Scan(&c.ID, &c.ParentID, &c.Name, &c.Slug, &c.Position, &count); err != nil {
			s.internalError(w, r, "catalog categories scan", err)
			return
		}
		counts[c.ID] = count
		flat = append(flat, c)
	}
	// Roll descendant counts up so parents with visible children appear in
	// the navigation too.
	byID := map[int64]*db.Category{}
	for i := range flat {
		byID[flat[i].ID] = &flat[i]
	}
	visible := map[int64]bool{}
	for _, c := range flat {
		if counts[c.ID] > 0 {
			visible[c.ID] = true
		}
	}
	// Repeated passes are unnecessary for shallow trees; walk ancestors.
	for _, c := range flat {
		if counts[c.ID] == 0 {
			continue
		}
		cur := c.ParentID
		for cur != nil {
			counts[*cur] += counts[c.ID]
			visible[*cur] = true
			p, ok := byID[*cur]
			if !ok {
				break
			}
			cur = p.ParentID
		}
	}

	type catNode struct {
		ID       int64     `json:"id"`
		Name     string    `json:"name"`
		Slug     string    `json:"slug"`
		Count    int64     `json:"count"`
		Children []catNode `json:"children,omitempty"`
	}
	var build func(parent *int64) []catNode
	build = func(parent *int64) []catNode {
		var out []catNode
		for i := range flat {
			c := flat[i]
			if (parent == nil && c.ParentID != nil) || (parent != nil && (c.ParentID == nil || *c.ParentID != *parent)) {
				continue
			}
			if !visible[c.ID] {
				continue
			}
			node := catNode{ID: c.ID, Name: c.Name, Slug: c.Slug, Count: counts[c.ID]}
			id := c.ID
			node.Children = build(&id)
			out = append(out, node)
		}
		return out
	}
	out := build(nil)
	if out == nil {
		out = []catNode{}
	}
	writeJSON(w, http.StatusOK, out)
}

// catalogEntry is the public view of an entry: title, slug, poster and link,
// no internal ids or keys.
type catalogEntry struct {
	ID         string `json:"id"`
	Title      string `json:"title"`
	Slug       string `json:"slug"`
	CategoryID *int64 `json:"categoryId"`
	Category   string `json:"category,omitempty"`
	Poster     string `json:"poster,omitempty"`
	DurationMs *int64 `json:"durationMs"`
	CreatedAt  string `json:"createdAt"`
}

// handleCatalog lists public, ready entries for the library page (search,
// category filter via id or slug, pagination, sort).
func (s *Server) handleCatalog(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	limit, _ := strconv.Atoi(q.Get("limit"))
	if limit <= 0 || limit > 100 {
		limit = 24
	}
	if page <= 0 {
		page = 1
	}
	categoryID := int64(0)
	if raw := q.Get("category"); raw != "" {
		if id, err := strconv.ParseInt(raw, 10, 64); err == nil {
			categoryID = id
		} else if c, err := db.CategoryBySlug(r.Context(), s.pool, raw); err == nil {
			categoryID = c.ID
		}
	}
	offset := (page - 1) * limit
	if offset < 0 {
		offset = 0 // absurd page value: never a negative OFFSET
	}

	// Library policy: disabled = closed to everyone except staff (admins
	// keep preview access); login_only = viewers and staff only; enabled =
	// open to anonymous visitors.
	u := userFromContext(r.Context())
	v := viewerFromContext(r.Context())
	switch s.libraryMode() {
	case "disabled":
		if u.ID == 0 {
			writeError(w, http.StatusForbidden, "forbidden", "library disabled")
			return
		}
	case "login_only":
		if u.ID == 0 && v.ID == 0 {
			writeError(w, http.StatusUnauthorized, "unauthorized", "library requires sign-in")
			return
		}
	}

	conds := []string{`e.status = 'ready'`, `NOT e.access_denied`}
	args := []any{}
	add := func(cond string, arg any) {
		args = append(args, arg)
		conds = append(conds, fmt.Sprintf(cond, len(args)))
	}
	// Private entries stay staff-only; viewers and anonymous visitors get
	// the public subset.
	if u.ID == 0 {
		conds = append(conds, `e.is_public`)
	}
	if q.Get("q") != "" {
		add(`(e.title ILIKE '%%' || $%[1]d || '%%' OR e.description ILIKE '%%' || $%[1]d || '%%')`, q.Get("q"))
	}
	if categoryID > 0 {
		// Include the category's descendants for natural library browsing.
		add(`e.category_id IN (
			WITH RECURSIVE subtree AS (
				SELECT id FROM categories WHERE id = $%d
				UNION ALL
				SELECT c.id FROM categories c JOIN subtree s ON c.parent_id = s.id
			)
			SELECT id FROM subtree)`, categoryID)
	}
	where := "WHERE " + strings.Join(conds, " AND ")

	sortCol := "e.created_at DESC"
	switch q.Get("sort") {
	case "title":
		sortCol = "e.title ASC"
	case "oldest":
		sortCol = "e.created_at ASC"
	case "duration":
		sortCol = "e.duration_ms DESC NULLS LAST"
	}

	var total int64
	countArgs := append([]any{}, args...)
	if err := s.pool.QueryRow(r.Context(),
		`SELECT count(*) FROM entries e `+where, countArgs...).Scan(&total); err != nil {
		s.internalError(w, r, "catalog count", err)
		return
	}
	args = append(args, limit, offset)
	rows, err := s.pool.Query(r.Context(), `
		SELECT e.public_id::text, e.title, e.category_id, coalesce(c.name, ''),
		       coalesce(e.poster_key, ''), e.duration_ms, e.created_at
		FROM entries e
		LEFT JOIN categories c ON c.id = e.category_id
		`+where+`
		ORDER BY `+sortCol+`
		LIMIT $`+strconv.Itoa(len(args)-1)+` OFFSET $`+strconv.Itoa(len(args)), args...)
	if err != nil {
		s.internalError(w, r, "catalog list", err)
		return
	}
	defer rows.Close()
	items := []catalogEntry{}
	for rows.Next() {
		var ce catalogEntry
		var poster string
		var catName string
		if err := rows.Scan(&ce.ID, &ce.Title, &ce.CategoryID, &catName, &poster,
			&ce.DurationMs, &ce.CreatedAt); err != nil {
			s.internalError(w, r, "catalog scan", err)
			return
		}
		ce.Slug = slugifyTitle(ce.Title)
		ce.Category = catName
		if poster != "" {
			ce.Poster = "/media/" + strings.TrimPrefix(poster, "/")
		}
		items = append(items, ce)
	}
	if items == nil {
		items = []catalogEntry{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items": items,
		"total": total,
		"page":  page,
		"limit": limit,
	})
}

// slugifyTitle derives a URL-friendly slug from a title (best-effort; the
// catalog still addresses entries by their uuid).
func slugifyTitle(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	var b strings.Builder
	lastDash := false
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			lastDash = false
		default:
			if !lastDash && b.Len() > 0 {
				b.WriteByte('-')
				lastDash = true
			}
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		return "video"
	}
	return out
}

const (
	brandingLogoMaxBytes = 2 << 20 // logos are small; cap the proxy response
	brandingLogoTimeout  = 15 * time.Second
	brandingUserAgent    = "vod-app-branding/0.1"
)

// handleBrandingLogo proxies an external logo image through the app origin.
// The URL must be https (http is refused) and must resolve to public
// addresses only (safeurl rejects loopback/private/link-local — SSRF guard);
// every redirect hop is re-validated by safeurl.Client. Responses are
// capped in size and cached briefly.
func (s *Server) handleBrandingLogo(w http.ResponseWriter, r *http.Request) {
	raw := r.URL.Query().Get("url")
	if raw == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "url is required")
		return
	}
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme != "https" {
		writeError(w, http.StatusBadRequest, "bad_request", "logo url must be https")
		return
	}
	if _, err := safeurl.Validate(r.Context(), u.String()); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "unsafe logo url")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), brandingLogoTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		s.internalError(w, r, "branding logo request", err)
		return
	}
	req.Header.Set("User-Agent", brandingUserAgent)
	resp, err := safeurl.Client().Do(req)
	if err != nil {
		writeError(w, http.StatusBadGateway, "bad_gateway", "cannot fetch logo")
		return
	}
	defer resp.Body.Close()
	ct := strings.ToLower(strings.TrimSpace(strings.Split(resp.Header.Get("Content-Type"), ";")[0]))
	if !strings.HasPrefix(ct, "image/") {
		writeError(w, http.StatusBadRequest, "bad_request", "logo url is not an image")
		return
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Cache-Control", "public, max-age=300")
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, io.LimitReader(resp.Body, brandingLogoMaxBytes))
}

// proxyLogoURL rewrites an absolute logo URL into our same-origin proxy path.
func proxyLogoURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" {
		return raw
	}
	return "/media/branding/logo?url=" + url.QueryEscape(raw)
}

// proxiedPlayerConfig rewrites the logoUrl in a player config so the browser
// loads it from our origin (CSP img-src 'self').
func proxiedPlayerConfig(raw json.RawMessage) json.RawMessage {
	var cfg map[string]any
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return raw
	}
	logo, _ := cfg["logoUrl"].(string)
	if logo == "" {
		return raw
	}
	cfg["logoUrl"] = proxyLogoURL(logo)
	out, err := json.Marshal(cfg)
	if err != nil {
		return raw
	}
	return out
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
		out.Player = proxiedPlayerConfig(cfg)
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
