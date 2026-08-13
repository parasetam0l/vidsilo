package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/parasetam0l/vidsilo/internal/settings"
	"github.com/parasetam0l/vidsilo/internal/ui"
)

func TestServeUICleanURLs(t *testing.T) {
	fs, err := ui.FS()
	if err != nil {
		t.Fatal(err)
	}
	// A source checkout embeds the placeholder UI (see internal/ui): the
	// SPA clean-URL assertions need the real static export, which CI and
	// the Dockerfile produce before compiling the binary.
	if _, err := fs.Open("_next/placeholder.txt"); err == nil {
		t.Skip("placeholder UI embedded — build the web export to test SPA routes")
	}
	// Nil settings = "enabled" mode (see libraryMode): pages serve normally.
	s := NewServer(nil, fs, nil, nil, nil, nil, nil, nil, nil, nil)
	// /upload is intentionally absent: the page became a dialog and the
	// path is owned by the tus subtree. Admin pages live under /admin;
	// the old root-level routes must 404 (nothing stale embedded).
	for _, path := range []string{"/login", "/admin/login", "/admin/dashboard", "/admin/entries", "/play"} {
		req := httptest.NewRequest("GET", path, nil)
		rec := httptest.NewRecorder()
		s.serveUI(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s -> %d", path, rec.Code)
		}
		if ct := rec.Header().Get("Content-Type"); ct == "" {
			t.Fatalf("%s missing content type", path)
		}
	}
	for _, path := range []string{"/dashboard", "/entries", "/library"} {
		req := httptest.NewRequest("GET", path, nil)
		rec := httptest.NewRecorder()
		s.serveUI(rec, req)
		if rec.Code == http.StatusOK {
			t.Fatalf("%s -> 200, stale page still embedded", path)
		}
	}
}

// TestServeUIDisabledRedirects: with an empty settings service the library
// mode resolves to "disabled" — every public surface must point at the
// staff login, while /embed stays untouched.
func TestServeUIDisabledRedirects(t *testing.T) {
	fs, err := ui.FS()
	if err != nil {
		t.Fatal(err)
	}
	s := NewServer(nil, fs, nil, nil, nil, nil, nil, nil, nil, nil)
	s.settings = &settings.Service{}
	for _, path := range []string{"/", "/play", "/play/x", "/login"} {
		req := httptest.NewRequest("GET", path, nil)
		rec := httptest.NewRecorder()
		s.serveUI(rec, req)
		if rec.Code != http.StatusFound {
			t.Fatalf("%s -> %d, want 302 to /admin/login", path, rec.Code)
		}
		if loc := rec.Header().Get("Location"); loc != "/admin/login" {
			t.Fatalf("%s -> Location %q, want /admin/login", path, loc)
		}
	}
}
