package api

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/parasetam0l/vod-app/internal/db"
)

// registerCategoryRoutes: tree list for everyone, admin CRUD.
func (s *Server) registerCategoryRoutes(mux *http.ServeMux) {
	admin := s.requireRole(roleAdmin)
	mux.Handle("GET /api/categories", s.requireAuth(http.HandlerFunc(s.handleCategoriesList)))
	mux.Handle("POST /api/categories", admin(http.HandlerFunc(s.handleCategoriesCreate)))
	mux.Handle("PATCH /api/categories/{id}", admin(http.HandlerFunc(s.handleCategoriesPatch)))
	mux.Handle("DELETE /api/categories/{id}", admin(http.HandlerFunc(s.handleCategoriesDelete)))
}

func (s *Server) handleCategoriesList(w http.ResponseWriter, r *http.Request) {
	tree, err := db.CategoryTree(r.Context(), s.pool)
	if err != nil {
		s.internalError(w, r, "list categories", err)
		return
	}
	writeJSON(w, http.StatusOK, tree)
}

type categoryBody struct {
	Name     string `json:"name"`
	ParentID *int64 `json:"parentId"`
	Position int    `json:"position"`
}

func (s *Server) handleCategoriesCreate(w http.ResponseWriter, r *http.Request) {
	var body categoryBody
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid JSON body")
		return
	}
	if body.Name == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "name is required")
		return
	}
	c, err := db.CreateCategory(r.Context(), s.pool, body.ParentID, body.Name, body.Position)
	if err != nil {
		s.internalError(w, r, "create category", err)
		return
	}
	writeJSON(w, http.StatusCreated, c)
}

func (s *Server) handleCategoriesPatch(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid category id")
		return
	}
	var body categoryBody
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid JSON body")
		return
	}
	c, err := db.UpdateCategory(r.Context(), s.pool, id, body.ParentID, body.Name, body.Position)
	if errors.Is(err, db.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "category not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, c)
}

func (s *Server) handleCategoriesDelete(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid category id")
		return
	}
	if err := db.DeleteCategory(r.Context(), s.pool, id); err != nil {
		writeError(w, http.StatusNotFound, "not_found", "category not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// registerFlavorRoutes: flavor list for editors (entry detail needs it),
// admin CRUD.
func (s *Server) registerFlavorRoutes(mux *http.ServeMux) {
	admin := s.requireRole(roleAdmin)
	mux.Handle("GET /api/flavors", s.requireRole(roleEditor, roleAdmin)(http.HandlerFunc(s.handleFlavorsList)))
	mux.Handle("POST /api/flavors", admin(http.HandlerFunc(s.handleFlavorsCreate)))
	mux.Handle("PATCH /api/flavors/{id}", admin(http.HandlerFunc(s.handleFlavorsPatch)))
	mux.Handle("DELETE /api/flavors/{id}", admin(http.HandlerFunc(s.handleFlavorsDelete)))
}

func (s *Server) handleFlavorsList(w http.ResponseWriter, r *http.Request) {
	flavors, err := db.ListFlavors(r.Context(), s.pool)
	if err != nil {
		s.internalError(w, r, "list flavors", err)
		return
	}
	writeJSON(w, http.StatusOK, flavors)
}

func (s *Server) handleFlavorsCreate(w http.ResponseWriter, r *http.Request) {
	var body db.Flavor
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid JSON body")
		return
	}
	f, err := db.CreateFlavor(r.Context(), s.pool, body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, f)
}

func (s *Server) handleFlavorsPatch(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid flavor id")
		return
	}
	var body db.Flavor
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid JSON body")
		return
	}
	f, err := db.UpdateFlavor(r.Context(), s.pool, id, body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, f)
}

func (s *Server) handleFlavorsDelete(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid flavor id")
		return
	}
	if err := db.DeleteFlavor(r.Context(), s.pool, id); err != nil {
		writeError(w, http.StatusNotFound, "not_found", "flavor not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
