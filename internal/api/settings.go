package api

import (
	"net/http"

	"github.com/parasetam0l/vod-app/internal/settings"
)

// registerSettingsRoutes: GET lists everything with restart flags; PATCH
// applies validated key-value pairs.
func (s *Server) registerSettingsRoutes(mux *http.ServeMux) {
	mux.Handle("GET /api/settings", s.requireRole(settingsAdminRole)(http.HandlerFunc(s.handleSettingsGet)))
	mux.Handle("PATCH /api/settings", s.requireRole(settingsAdminRole)(http.HandlerFunc(s.handleSettingsPatch)))
}

const settingsAdminRole = "admin"

func (s *Server) handleSettingsGet(w http.ResponseWriter, r *http.Request) {
	restart := []string{}
	for key, spec := range settings.Specs {
		if spec.RestartRequired {
			restart = append(restart, key)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"settings":        s.settings.All(),
		"restartRequired": restart,
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
	writeJSON(w, http.StatusOK, map[string]any{"updated": updated})
}
