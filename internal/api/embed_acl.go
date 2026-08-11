package api

import (
	"context"
	"net/http"
	"net/url"
	"strings"

	"github.com/parasetam0l/vod-app/internal/db"
	"github.com/parasetam0l/vod-app/internal/store"
)

// entryAllowed decides whether an anonymous viewer may load an entry's
// embed page / media. Authenticated sessions always pass; entries without a
// domain ACL are "Allow All". A named ACL is evaluated blocklist-first
// (deny wins), then whitelist (empty whitelist = allow the rest). Any ACL
// resolution failure denies (fail closed).
func (s *Server) entryAllowed(ctx context.Context, r *http.Request, e db.Entry) bool {
	if u := userFromContext(ctx); u.ID > 0 {
		return true // authenticated sessions always pass
	}
	if !e.IsPublic {
		return false
	}
	if e.DomainACLID == nil {
		return true // Allow All
	}
	acl, err := db.ACLByID(ctx, s.pool, *e.DomainACLID)
	if err != nil {
		return false
	}
	host := refererHost(r)
	if host == "" {
		return false
	}
	for _, d := range acl.Blocklist {
		if host == d || strings.HasSuffix(host, "."+d) {
			return false
		}
	}
	if len(acl.Whitelist) == 0 {
		return true
	}
	for _, d := range acl.Whitelist {
		if host == d || strings.HasSuffix(host, "."+d) {
			return true
		}
	}
	return false
}

// refererHost extracts the host from Referer or Origin (anonymous embeds).
func refererHost(r *http.Request) string {
	for _, header := range []string{"Referer", "Origin"} {
		if v := r.Header.Get(header); v != "" {
			if u, err := url.Parse(v); err == nil && u.Host != "" {
				return u.Host
			}
		}
	}
	return ""
}

// optionalAuth resolves a valid session when one is present, leaving
// anonymous requests untouched. Used by media/embed routes so the ACL can
// distinguish "editor with session" from "anonymous viewer".
func (s *Server) optionalAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if c, err := r.Cookie(accessCookieName); err == nil && c.Value != "" && !s.denylist.Revoked(c.Value) {
			if claims, err := verifyAccessToken(s.secret, c.Value); err == nil {
				if u, err := db.UserByID(r.Context(), s.pool, claims.UserID); err == nil && !u.Disabled {
					next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userCtxKey, u)))
					return
				}
			}
		}
		next.ServeHTTP(w, r)
	})
}

// embedACL wraps a handler that serves entry-scoped content.
func (s *Server) embedACL(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		uuid := r.PathValue("uuid")
		if uuid == "" {
			writeError(w, http.StatusNotFound, "not_found", "not found")
			return
		}
		e, err := db.EntryByPublicID(r.Context(), s.pool, uuid)
		if err != nil {
			writeError(w, http.StatusNotFound, "not_found", "not found")
			return
		}
		if !s.entryAllowed(r.Context(), r, e) {
			writeError(w, http.StatusForbidden, "forbidden", "embedding not allowed for this domain")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// mediaACL guards /media/{key...} — resolves the entry from the key and runs
// the embed policy. Original source files additionally require an editor+
// session (download prevention).
func (s *Server) mediaACL(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := strings.TrimPrefix(r.PathValue("key"), "/")
		if key == "" || !strings.HasPrefix(key, store.EntriesRoot+"/") {
			writeError(w, http.StatusNotFound, "not_found", "not found")
			return
		}
		entryID, err := store.EntryIDFromMediaKey(key)
		if err != nil {
			writeError(w, http.StatusNotFound, "not_found", "not found")
			return
		}
		e, err := db.EntryByID(r.Context(), s.pool, entryID)
		if err != nil {
			writeError(w, http.StatusNotFound, "not_found", "not found")
			return
		}
		// Original source files are never served over HTTP — no download
		// path exists for any role. The worker reads originals directly from
		// the store, so blocking them here doesn't affect processing.
		if isOriginalKey(key) {
			writeError(w, http.StatusForbidden, "forbidden", "source files are not downloadable")
			return
		}
		if !s.entryAllowed(r.Context(), r, e) {
			writeError(w, http.StatusForbidden, "forbidden", "embedding not allowed for this domain")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func isOriginalKey(key string) bool {
	base := key[strings.LastIndex(key, "/")+1:]
	return strings.HasPrefix(base, "original.")
}
