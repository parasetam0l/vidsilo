package api

import (
	"net/http"
	"sort"
	"strings"

	"github.com/parasetam0l/vod-app/internal/settings"
)

// registerSettingsRoutes: GET lists everything with restart flags; PATCH
// applies validated key-value pairs. /api/site-config is public — it backs
// the site name and default language for the UI, cached client-side.
func (s *Server) registerSettingsRoutes(mux *http.ServeMux) {
	mux.Handle("GET /api/settings", s.requireRole(settingsAdminRole)(http.HandlerFunc(s.handleSettingsGet)))
	mux.Handle("PATCH /api/settings", s.requireRole(settingsAdminRole)(http.HandlerFunc(s.handleSettingsPatch)))
	mux.Handle("GET /api/site-config", http.HandlerFunc(s.handleSiteConfig))
}

const settingsAdminRole = "admin"

// handleSiteConfig serves the public branding/site defaults. Served with a
// cache header so clients can hold it without re-asking on every page load;
// the settings cache refreshes in the background, so staleness is bounded.
func (s *Server) handleSiteConfig(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "public, max-age=300")
	writeJSON(w, http.StatusOK, map[string]string{
		"siteName":    s.settings.String("site_name", "VOD"),
		"defaultLang": s.settings.String("default_lang", "en"),
	})
}

// panelUnitDivisor converts settings stored in canonical units into
// friendlier panel units and back. Storage always keeps the canonical byte
// value (upload_config etc. read it directly); only the admin panel works
// in megabytes.
var panelUnitDivisor = map[string]float64{
	"upload.max_size_bytes": 1024 * 1024,
	"cache.max_bytes":       1024 * 1024,
}

func (s *Server) handleSettingsGet(w http.ResponseWriter, r *http.Request) {
	all := s.settings.All()
	for k, div := range panelUnitDivisor {
		if v, ok := all[k].(float64); ok {
			all[k] = v / div
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"settings": all,
	})
}

func (s *Server) handleSettingsPatch(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid JSON body")
		return
	}
	updated := make(map[string]any, len(body))
	for key, value := range body {
		// Panel units -> canonical units before validation/storage.
		if div, ok := panelUnitDivisor[key]; ok {
			mb, ok := value.(float64)
			if !ok {
				writeError(w, http.StatusBadRequest, "invalid_setting", key+" must be a number (megabytes)")
				return
			}
			value = mb * div
		}
		canonical, err := settings.Validate(key, value)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_setting", err.Error())
			return
		}
		if err := s.settings.Update(r.Context(), key, canonical); err != nil {
			s.internalError(w, r, "update setting", err)
			return
		}
		updated[key] = value
	}
	s.audit(r, "update", "setting", "", keysString(updated))
	writeJSON(w, http.StatusOK, map[string]any{"updated": updated})
}

func keysString(m map[string]any) string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return strings.Join(keys, ",")
}
