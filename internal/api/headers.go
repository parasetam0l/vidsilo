package api

import (
	"net/http"
	"strings"
)

// Hardening headers per README: nosniff, Referrer-Policy, CSP, X-Frame-Options
// on admin, HSTS when TLS is enabled.
//
// CSP note: the Next.js static export inlines its theme-init script and RSC
// payloads, and those inline scripts change on every web rebuild — the
// sha256-hash approach proved brittle across rebuilds/deployments (browsers
// kept blocking legit inline scripts after cache/rebuild mismatches). For a
// self-hosted single-origin admin we allow inline scripts ('unsafe-inline')
// while keeping every other source restricted to 'self' (external scripts,
// styles, images, media, connections, fonts). External resources from other
// origins remain blocked, and admin pages are still frame-protected.
func (s *Server) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		if r.TLS != nil {
			h.Set("Strict-Transport-Security", "max-age=63072000")
		}

		isEmbed := strings.HasPrefix(r.URL.Path, "/embed")
		csp := "default-src 'self'; " +
			"script-src 'self' 'unsafe-inline'; " +
			"style-src 'self' 'unsafe-inline'; " +
			"img-src 'self' data:; " +
			"media-src 'self' blob:; " +
			"connect-src 'self' blob:; " +
			"font-src 'self'; " +
			"base-uri 'self'; " +
			"form-action 'self'"
		if !isEmbed {
			// Admin/player pages must not be framed; /embed exists to be
			// framed, so the server-side domain ACL governs it instead.
			csp += "; frame-ancestors 'none'"
			h.Set("X-Frame-Options", "DENY")
		}
		h.Set("Content-Security-Policy", csp)

		next.ServeHTTP(w, r)
	})
}
