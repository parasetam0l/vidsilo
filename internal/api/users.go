package api

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/parasetam0l/vidsilo/internal/db"
	"github.com/parasetam0l/vidsilo/internal/password"
)

// registerUserRoutes: admin-only user management.
func (s *Server) registerUserRoutes(mux *http.ServeMux) {
	admin := s.requireRole(roleAdmin)
	mux.Handle("GET /api/users", admin(http.HandlerFunc(s.handleUsersList)))
	mux.Handle("POST /api/users", admin(http.HandlerFunc(s.handleUsersCreate)))
	mux.Handle("PATCH /api/users/{id}", admin(http.HandlerFunc(s.handleUsersPatch)))
	mux.Handle("DELETE /api/users/{id}", admin(http.HandlerFunc(s.handleUsersDelete)))
}

func (s *Server) handleUsersList(w http.ResponseWriter, r *http.Request) {
	// Paginated variant; the plain array stays for the existing admin UI.
	if pageStr := r.URL.Query().Get("page"); pageStr != "" {
		page, _ := strconv.Atoi(pageStr)
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		users, total, err := db.ListUsersPage(r.Context(), s.pool, page, limit)
		if err != nil {
			s.internalError(w, r, "list users", err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"items": users,
			"total": total,
			"page":  page,
			"limit": limit,
		})
		return
	}
	users, err := db.ListUsers(r.Context(), s.pool)
	if err != nil {
		s.internalError(w, r, "list users", err)
		return
	}
	writeJSON(w, http.StatusOK, users)
}

type userBody struct {
	Email       string  `json:"email"`
	NameSurname string  `json:"nameSurname"`
	Password    string  `json:"password"`
	Role        db.Role `json:"role"`
	Disabled    *bool   `json:"disabled"`
}

func validRole(role db.Role) bool {
	switch role {
	case db.RoleAdmin, db.RoleEditor, db.RoleUploader, db.RoleViewer:
		return true
	}
	return false
}

func (s *Server) handleUsersCreate(w http.ResponseWriter, r *http.Request) {
	var body userBody
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid JSON body")
		return
	}
	body.Email = strings.TrimSpace(body.Email)
	if body.Email == "" || body.Password == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "email and password are required")
		return
	}
	if !validRole(body.Role) {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid role")
		return
	}
	hash, err := password.Hash(body.Password)
	if err != nil {
		s.internalError(w, r, "hash password", err)
		return
	}
	u, err := db.CreateUser(r.Context(), s.pool, body.Email, body.NameSurname, hash, body.Role)
	if errors.Is(err, db.ErrEmailTaken) {
		writeError(w, http.StatusConflict, "conflict", "email already taken")
		return
	}
	if err != nil {
		s.internalError(w, r, "create user", err)
		return
	}
	s.audit(r, "create", "user", strconv.FormatInt(u.ID, 10), u.Email)
	writeJSON(w, http.StatusCreated, u)
}

func (s *Server) handleUsersPatch(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid user id")
		return
	}
	var body userBody
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid JSON body")
		return
	}
	me := userFromContext(r.Context())
	if me.ID == id && body.Disabled != nil && *body.Disabled {
		writeError(w, http.StatusBadRequest, "bad_request", "you cannot disable your own account")
		return
	}
	if !validRole(body.Role) {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid role")
		return
	}
	current, err := db.UserByID(r.Context(), s.pool, id)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "user not found")
		return
	}
	email := strings.TrimSpace(body.Email)
	if email == "" {
		email = current.Email
	}
	if body.Password != "" {
		hash, err := password.Hash(body.Password)
		if err != nil {
			s.internalError(w, r, "hash password", err)
			return
		}
		if err := db.UpdateUserPassword(r.Context(), s.pool, id, hash); err != nil {
			s.internalError(w, r, "update password", err)
			return
		}
	}
	disabled := current.Disabled
	if body.Disabled != nil {
		disabled = *body.Disabled
	}
	if err := db.UpdateUser(r.Context(), s.pool, id, email, body.NameSurname, body.Role, disabled); err != nil {
		if errors.Is(err, db.ErrEmailTaken) {
			writeError(w, http.StatusConflict, "conflict", "email already taken")
			return
		}
		s.internalError(w, r, "update user", err)
		return
	}
	u, err := db.UserByID(r.Context(), s.pool, id)
	if err != nil {
		s.internalError(w, r, "reload user", err)
		return
	}
	s.audit(r, "update", "user", strconv.FormatInt(id, 10), u.Email)
	writeJSON(w, http.StatusOK, u)
}

func (s *Server) handleUsersDelete(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid user id")
		return
	}
	me := userFromContext(r.Context())
	if me.ID == id {
		writeError(w, http.StatusBadRequest, "bad_request", "you cannot delete your own account")
		return
	}
	if err := db.DeleteUser(r.Context(), s.pool, id); err != nil {
		s.internalError(w, r, "delete user", err)
		return
	}
	s.audit(r, "delete", "user", strconv.FormatInt(id, 10), "")
	w.WriteHeader(http.StatusNoContent)
}
