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
	// path is owned by the tus subtree.
	for _, path := range []string{"/login", "/dashboard", "/entries"} {
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
}
