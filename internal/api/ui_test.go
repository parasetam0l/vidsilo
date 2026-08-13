package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/parasetam0l/vod-app/internal/ui"
)

func TestServeUICleanURLs(t *testing.T) {
	fs, err := ui.FS()
	if err != nil {
		t.Fatal(err)
	}
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
