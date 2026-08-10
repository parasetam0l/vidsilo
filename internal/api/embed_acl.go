package api

import (
	"context"
	"net/http"
	"net/url"
	"strings"

	"github.com/parasetam0l/vod-app/internal/db"
	"github.com/parasetam0l/vod-app/internal/store"
)

func (s *Server) entryAllowed(ctx context.Context, r *http.Request, e db.Entry) bool {
	if u := userFromContext(ctx); u.ID > 0 {
		return true // authenticated sessions always pass
	}
	if !e.IsPublic {
		return false
	}

	policy := e.EmbedPolicy
	domains := e.EmbedDomains
	if policy == db.EmbedDefault {
		policy = db.EmbedPolicy(s.settings.String("embed.default_policy", "same-origin"))
		domains = s.settings.StringSlice("embed.default_allowlist", nil)
	}

	switch policy {
	case db.EmbedAll:
		return true
	case db.EmbedSameOrigin:
		return s.sameOriginRequest(r)
	case db.EmbedAllowlist:
		host := refererHost(r)
		if host == "" {
			return false
		}
		for _, d := range domains {
			if host == d || strings.HasSuffix(host, "."+d) {
				return true
			}
		}
		return false
	default:
		return false
	}
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

func (s *Server) sameOriginRequest(r *http.Request) bool {
	host := refererHost(r)
	if host == "" {
		return false // direct navigation is not an embed
	}
	return host == r.Host
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
		// Original source files: authenticated editor+ only.
		if isOriginalKey(key) {
			u := userFromContext(r.Context())
			if u.ID == 0 || (u.Role != db.RoleAdmin && u.Role != db.RoleEditor) {
				writeError(w, http.StatusForbidden, "forbidden", "source files require editor access")
				return
			}
		} else if !s.entryAllowed(r.Context(), r, e) {
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
