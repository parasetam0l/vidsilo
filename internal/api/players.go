package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/parasetam0l/vidsilo/internal/db"
)

// registerPlayerRoutes: player design CRUD. Listing is open to editors+
// (the entry dialog needs it); mutations are admin-only. The seeded
// Default player is immutable.
func (s *Server) registerPlayerRoutes(mux *http.ServeMux) {
	mux.Handle("GET /api/players", s.requireRole(roleEditor, roleAdmin)(http.HandlerFunc(s.handlePlayerList)))
	mux.Handle("POST /api/players", s.requireRole(roleAdmin)(http.HandlerFunc(s.handlePlayerCreate)))
	mux.Handle("PATCH /api/players/{id}", s.requireRole(roleAdmin)(http.HandlerFunc(s.handlePlayerUpdate)))
	mux.Handle("DELETE /api/players/{id}", s.requireRole(roleAdmin)(http.HandlerFunc(s.handlePlayerDelete)))
}

func (s *Server) handlePlayerList(w http.ResponseWriter, r *http.Request) {
	players, err := db.ListPlayers(r.Context(), s.pool)
	if err != nil {
		s.internalError(w, r, "list players", err)
		return
	}
	writeJSON(w, http.StatusOK, players)
}

type playerBody struct {
	Name   string         `json:"name"`
	Config map[string]any `json:"config"`
}

func (s *Server) handlePlayerCreate(w http.ResponseWriter, r *http.Request) {
	var body playerBody
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid JSON body")
		return
	}
	if strings.TrimSpace(body.Name) == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "name is required")
		return
	}
	config, err := db.SanitizePlayerConfig(body.Config)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid config")
		return
	}
	player, err := db.CreatePlayer(r.Context(), s.pool, strings.TrimSpace(body.Name), config)
	if err != nil {
		s.internalError(w, r, "create player", err)
		return
	}
	writeJSON(w, http.StatusCreated, player)
}

func (s *Server) handlePlayerUpdate(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid player id")
		return
	}
	var body playerBody
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid JSON body")
		return
	}
	if strings.TrimSpace(body.Name) == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "name is required")
		return
	}
	config, err := db.SanitizePlayerConfig(body.Config)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid config")
		return
	}
	player, err := db.UpdatePlayer(r.Context(), s.pool, id, strings.TrimSpace(body.Name), config)
	if errors.Is(err, db.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "player not found")
		return
	}
	if err != nil {
		s.internalError(w, r, "update player", err)
		return
	}
	writeJSON(w, http.StatusOK, player)
}

func (s *Server) handlePlayerDelete(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid player id")
		return
	}
	if err := db.DeletePlayer(r.Context(), s.pool, id); err != nil {
		if errors.Is(err, db.ErrImmutable) {
			writeError(w, http.StatusConflict, "conflict", "the Default player can never be deleted")
			return
		}
		if errors.Is(err, db.ErrNotFound) {
			writeError(w, http.StatusNotFound, "not_found", "player not found")
			return
		}
		s.internalError(w, r, "delete player", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// resolvedPlayerConfig returns the config JSON for the entry's assigned
// player, falling back to the seeded Default design (nil player).
func (s *Server) resolvedPlayerConfig(r *http.Request, playerID *int64) json.RawMessage {
	player, err := db.DefaultPlayer(r.Context(), s.pool)
	if err != nil {
		return json.RawMessage("{}")
	}
	if playerID != nil {
		if p, err := db.PlayerByID(r.Context(), s.pool, *playerID); err == nil {
			player = p
		}
	}
	return player.Config
}
