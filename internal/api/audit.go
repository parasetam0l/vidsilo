package api

import (
	"context"
	"net/http"
	"strconv"
	"time"
)

// registerAuditRoutes exposes the trail to admins.
func (s *Server) registerAuditRoutes(mux *http.ServeMux) {
	mux.Handle("GET /api/audit", s.requireRole(roleAdmin)(http.HandlerFunc(s.handleAuditList)))
}

// audit records a mutating admin action. It is best-effort: a logging
// failure must never fail the action itself. The insert runs on a
// cancel-detached context so a client that disconnects mid-request cannot
// silently drop the trail.
func (s *Server) audit(r *http.Request, action, entity, entityID, detail string) {
	u := userFromContext(r.Context())
	if s.pool == nil {
		return
	}
	_, _ = s.pool.Exec(context.WithoutCancel(r.Context()), `
		INSERT INTO audit_events (actor_id, actor_email, action, entity, entity_id, detail)
		VALUES ($1, $2, $3, $4, $5, $6)`,
		u.ID, u.Email, action, entity, entityID, detail)
}

// AuditEvent is one trail row for the admin API.
type AuditEvent struct {
	ID         int64     `json:"id"`
	ActorID    *int64    `json:"actorId"`
	ActorEmail string    `json:"actorEmail"`
	Action     string    `json:"action"`
	Entity     string    `json:"entity"`
	EntityID   string    `json:"entityId"`
	Detail     string    `json:"detail"`
	CreatedAt  time.Time `json:"createdAt"`
}

// handleAuditList serves the trail (newest first, paginated).
func (s *Server) handleAuditList(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	if page <= 0 {
		page = 1
	}
	limit, _ := strconv.Atoi(q.Get("limit"))
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	entity := q.Get("entity")
	entityID := q.Get("entityId")

	conds := ""
	args := []any{}
	if entity != "" {
		args = append(args, entity)
		conds += " WHERE entity = $" + strconv.Itoa(len(args))
		if entityID != "" {
			args = append(args, entityID)
			conds += " AND entity_id = $" + strconv.Itoa(len(args))
		}
	}
	offset := (page - 1) * limit
	args = append(args, limit, offset)
	rows, err := s.pool.Query(r.Context(), `
		SELECT id, actor_id, actor_email, action, entity, entity_id, detail, created_at
		FROM audit_events`+conds+`
		ORDER BY id DESC
		LIMIT $`+strconv.Itoa(len(args)-1)+` OFFSET $`+strconv.Itoa(len(args)), args...)
	if err != nil {
		s.internalError(w, r, "list audit events", err)
		return
	}
	defer rows.Close()
	out := []AuditEvent{}
	for rows.Next() {
		var ev AuditEvent
		if err := rows.Scan(&ev.ID, &ev.ActorID, &ev.ActorEmail, &ev.Action,
			&ev.Entity, &ev.EntityID, &ev.Detail, &ev.CreatedAt); err != nil {
			s.internalError(w, r, "scan audit events", err)
			return
		}
		out = append(out, ev)
	}
	if err := rows.Err(); err != nil {
		s.internalError(w, r, "list audit events", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": out, "page": page, "limit": limit})
}
