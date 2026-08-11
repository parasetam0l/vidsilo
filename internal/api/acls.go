package api

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/parasetam0l/vod-app/internal/db"
)

// registerAclRoutes: Domain ACL CRUD. Listing is open to editors+ (the entry
// dialog needs it to assign ACLs); mutations are admin-only.
func (s *Server) registerAclRoutes(mux *http.ServeMux) {
	mux.Handle("GET /api/acls", s.requireRole(roleEditor, roleAdmin)(http.HandlerFunc(s.handleAclList)))
	mux.Handle("POST /api/acls", s.requireRole(roleAdmin)(http.HandlerFunc(s.handleAclCreate)))
	mux.Handle("PATCH /api/acls/{id}", s.requireRole(roleAdmin)(http.HandlerFunc(s.handleAclUpdate)))
	mux.Handle("DELETE /api/acls/{id}", s.requireRole(roleAdmin)(http.HandlerFunc(s.handleAclDelete)))
}

type aclBody struct {
	Title     string   `json:"title"`
	Whitelist []string `json:"whitelist"`
	Blocklist []string `json:"blocklist"`
}

// cleanDomains trims, dedupes and drops empty entries from a domain list.
func cleanDomains(in []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, d := range in {
		d = strings.ToLower(strings.TrimSpace(d))
		if d == "" || seen[d] {
			continue
		}
		seen[d] = true
		out = append(out, d)
	}
	return out
}

func (s *Server) handleAclList(w http.ResponseWriter, r *http.Request) {
	acls, err := db.ListACLs(r.Context(), s.pool)
	if err != nil {
		s.internalError(w, r, "list acls", err)
		return
	}
	writeJSON(w, http.StatusOK, acls)
}

func (s *Server) handleAclCreate(w http.ResponseWriter, r *http.Request) {
	var body aclBody
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid JSON body")
		return
	}
	if strings.TrimSpace(body.Title) == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "title is required")
		return
	}
	acl, err := db.CreateACL(r.Context(), s.pool,
		strings.TrimSpace(body.Title), cleanDomains(body.Whitelist), cleanDomains(body.Blocklist))
	if err != nil {
		s.internalError(w, r, "create acl", err)
		return
	}
	writeJSON(w, http.StatusCreated, acl)
}

func (s *Server) handleAclUpdate(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid acl id")
		return
	}
	var body aclBody
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid JSON body")
		return
	}
	if strings.TrimSpace(body.Title) == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "title is required")
		return
	}
	acl, err := db.UpdateACL(r.Context(), s.pool, id,
		strings.TrimSpace(body.Title), cleanDomains(body.Whitelist), cleanDomains(body.Blocklist))
	if errors.Is(err, db.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "acl not found")
		return
	}
	if err != nil {
		s.internalError(w, r, "update acl", err)
		return
	}
	writeJSON(w, http.StatusOK, acl)
}

func (s *Server) handleAclDelete(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid acl id")
		return
	}
	if err := db.DeleteACL(r.Context(), s.pool, id); err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeError(w, http.StatusNotFound, "not_found", "acl not found")
			return
		}
		s.internalError(w, r, "delete acl", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
