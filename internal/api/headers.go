package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"io/fs"
	"net/http"
	"path/filepath"
	"regexp"
	"strings"
)

// Hardening headers per README: nosniff, Referrer-Policy, CSP with
// sha256-hashed inline scripts (no unsafe-inline), X-Frame-Options on admin,
// HSTS when TLS is enabled.

var inlineScriptRe = regexp.MustCompile(`(?s)<script([^>]*)>(.*?)</script>`)

// collectInlineScriptHashes scans every exported HTML page for inline scripts
// and returns their sha256 hashes, so the CSP can allow exactly the scripts
// the static export emits (theme init, RSC payloads) without unsafe-inline.
func collectInlineScriptHashes(uiFS fs.FS) []string {
	if uiFS == nil {
		return nil
	}
	seen := map[string]bool{}
	var hashes []string
	_ = fs.WalkDir(uiFS, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || filepath.Ext(p) != ".html" {
			return nil
		}
		raw, err := fs.ReadFile(uiFS, p)
		if err != nil {
			return nil
		}
		for _, m := range inlineScriptRe.FindAllSubmatch(raw, -1) {
			if bytes.Contains(m[1], []byte("src=")) {
				continue // external script tag, no hash needed
			}
			sum := sha256.Sum256(m[2])
			h := hex.EncodeToString(sum[:])
			if !seen[h] {
				seen[h] = true
				hashes = append(hashes, h)
			}
		}
		return nil
	})
	return hashes
}

func (s *Server) securityHeaders(next http.Handler) http.Handler {
	hashes := collectInlineScriptHashes(s.uiFS)
	var scriptSrc strings.Builder
	scriptSrc.WriteString("'self'")
	for _, h := range hashes {
		scriptSrc.WriteString(" 'sha256-" + h + "'")
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		if r.TLS != nil {
			h.Set("Strict-Transport-Security", "max-age=63072000")
		}

		isEmbed := strings.HasPrefix(r.URL.Path, "/embed")
		csp := "default-src 'self'; " +
			"script-src " + scriptSrc.String() + "; " +
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
