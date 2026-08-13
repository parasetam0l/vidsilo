package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/parasetam0l/vod-app/internal/db"
	"github.com/parasetam0l/vod-app/internal/password"
	"github.com/parasetam0l/vod-app/internal/secrets"
)

// Viewers are public library accounts. Their sessions use separate cookies
// and a separate token kind, so they can never authenticate against the
// admin API (role checks see no user at all).

const (
	viewerAccessCookieName  = "vod_viewer"
	viewerRefreshCookieName = "vod_viewer_refresh"
	viewerRefreshTTL        = 7 * 24 * time.Hour
)

type viewerCtxKey struct{}

func viewerFromContext(ctx context.Context) db.Viewer {
	v, _ := ctx.Value(viewerCtxKey{}).(db.Viewer)
	return v
}

// registerViewerRoutes: public viewer session endpoints + admin CRUD.
func (s *Server) registerViewerRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/viewer/login", s.handleViewerLogin)
	mux.HandleFunc("POST /api/viewer/refresh", s.handleViewerRefresh)
	mux.HandleFunc("POST /api/viewer/logout", s.handleViewerLogout)
	mux.Handle("GET /api/viewer/me", s.requireViewer(http.HandlerFunc(s.handleViewerMe)))
	mux.Handle("GET /api/viewers", s.requireRole(roleAdmin)(http.HandlerFunc(s.handleViewersList)))
	mux.Handle("POST /api/viewers", s.requireRole(roleAdmin)(http.HandlerFunc(s.handleViewerCreate)))
	mux.Handle("PATCH /api/viewers/{id}", s.requireRole(roleAdmin)(http.HandlerFunc(s.handleViewerUpdate)))
	mux.Handle("DELETE /api/viewers/{id}", s.requireRole(roleAdmin)(http.HandlerFunc(s.handleViewerDelete)))
}

// --- viewer sessions ----------------------------------------------------------

func (s *Server) handleViewerLogin(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid JSON body")
		return
	}
	req.Email = strings.TrimSpace(req.Email)
	if req.Email == "" || req.Password == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "email and password are required")
		return
	}
	if left, locked := s.loginGuard.locked(req.Email); locked {
		w.Header().Set("Retry-After", strconv.Itoa(int(left.Seconds())+1))
		writeError(w, http.StatusTooManyRequests, "too_many_attempts",
			"too many failed sign-in attempts — try again later")
		return
	}
	v, err := db.ViewerByEmail(r.Context(), s.pool, req.Email)
	if errors.Is(err, pgx.ErrNoRows) {
		password.Verify(req.Password, "$argon2id$v=19,m=65536,t=1,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
		s.loginGuard.failure(req.Email)
		writeError(w, http.StatusUnauthorized, "unauthorized", "invalid credentials")
		return
	}
	if err != nil {
		s.internalError(w, r, "viewer login lookup", err)
		return
	}
	ok, upgrade := password.Verify(req.Password, v.PasswordHash)
	if !ok {
		s.loginGuard.failure(req.Email)
		writeError(w, http.StatusUnauthorized, "unauthorized", "invalid credentials")
		return
	}
	if v.Disabled {
		writeError(w, http.StatusForbidden, "forbidden", "account disabled")
		return
	}
	s.loginGuard.success(req.Email)
	if upgrade {
		if newHash, err := password.Hash(req.Password); err == nil {
			_, _ = db.UpdateViewer(r.Context(), s.pool, v.ID, v.Email, v.NameSurname, newHash, v.Disabled)
		}
	}
	s.issueViewerSession(w, r, v)
}

func (s *Server) handleViewerRefresh(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie(viewerRefreshCookieName)
	if err != nil || c.Value == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized", "no refresh token")
		return
	}
	hash := sha256.Sum256([]byte(c.Value))
	var tokenID, viewerID int64
	var revoked bool
	var expiresAt time.Time
	err = s.pool.QueryRow(r.Context(), `
		SELECT id, viewer_id, revoked, expires_at
		FROM viewer_refresh_tokens WHERE token_hash = $1`, hex.EncodeToString(hash[:])).
		Scan(&tokenID, &viewerID, &revoked, &expiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusUnauthorized, "unauthorized", "invalid refresh token")
		return
	}
	if err != nil {
		s.internalError(w, r, "viewer refresh lookup", err)
		return
	}
	if revoked || expiresAt.Before(time.Now()) {
		_, _ = s.pool.Exec(r.Context(), `DELETE FROM viewer_refresh_tokens WHERE viewer_id = $1`, viewerID)
		s.clearViewerCookies(w, r)
		writeError(w, http.StatusUnauthorized, "unauthorized", "session revoked")
		return
	}
	v, err := db.ViewerByID(r.Context(), s.pool, viewerID)
	if err != nil || v.Disabled {
		writeError(w, http.StatusUnauthorized, "unauthorized", "invalid refresh token")
		return
	}
	_, _ = s.pool.Exec(r.Context(), `DELETE FROM viewer_refresh_tokens WHERE id = $1`, tokenID)
	s.issueViewerSession(w, r, v)
}

func (s *Server) handleViewerLogout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(viewerAccessCookieName); err == nil && c.Value != "" {
		s.denylist.Revoke(r.Context(), c.Value, accessTokenTTL)
	}
	if c, err := r.Cookie(viewerRefreshCookieName); err == nil && c.Value != "" {
		hash := sha256.Sum256([]byte(c.Value))
		_, _ = s.pool.Exec(r.Context(),
			`DELETE FROM viewer_refresh_tokens WHERE token_hash = $1`, hex.EncodeToString(hash[:]))
	}
	s.clearViewerCookies(w, r)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleViewerMe(w http.ResponseWriter, r *http.Request) {
	v := viewerFromContext(r.Context())
	writeJSON(w, http.StatusOK, v)
}

func (s *Server) issueViewerSession(w http.ResponseWriter, r *http.Request, v db.Viewer) {
	access, err := signViewerAccessToken(s.secret, v)
	if err != nil {
		s.internalError(w, r, "sign viewer token", err)
		return
	}
	raw, err := secrets.RandomToken(32)
	if err != nil {
		s.internalError(w, r, "generate viewer refresh token", err)
		return
	}
	hash := sha256.Sum256([]byte(raw))
	_, err = s.pool.Exec(r.Context(), `
		INSERT INTO viewer_refresh_tokens (viewer_id, token_hash, expires_at)
		VALUES ($1, $2, $3)`,
		v.ID, hex.EncodeToString(hash[:]), time.Now().Add(viewerRefreshTTL))
	if err != nil {
		s.internalError(w, r, "store viewer refresh token", err)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     viewerAccessCookieName,
		Value:    access,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   r.TLS != nil,
		MaxAge:   int(accessTokenTTL.Seconds()),
	})
	http.SetCookie(w, &http.Cookie{
		Name:     viewerRefreshCookieName,
		Value:    raw,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   r.TLS != nil,
		MaxAge:   int(viewerRefreshTTL.Seconds()),
	})
	writeJSON(w, http.StatusOK, v)
}

func (s *Server) clearViewerCookies(w http.ResponseWriter, r *http.Request) {
	for _, name := range []string{viewerAccessCookieName, viewerRefreshCookieName} {
		http.SetCookie(w, &http.Cookie{
			Name:     name,
			Value:    "",
			Path:     "/",
			HttpOnly: true,
			SameSite: http.SameSiteLaxMode,
			Secure:   r.TLS != nil,
			MaxAge:   -1,
		})
	}
}

// requireViewer authenticates a viewer session; admin users are NOT viewers.
func (s *Server) requireViewer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(viewerAccessCookieName)
		if err != nil || c.Value == "" {
			writeError(w, http.StatusUnauthorized, "unauthorized", "not signed in")
			return
		}
		if s.denylist.Revoked(r.Context(), c.Value) {
			writeError(w, http.StatusUnauthorized, "unauthorized", "session revoked")
			return
		}
		claims, err := verifyViewerAccessToken(s.secret, c.Value)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "unauthorized", "session expired")
			return
		}
		v, err := db.ViewerByID(r.Context(), s.pool, claims.ViewerID)
		if err != nil || v.Disabled {
			writeError(w, http.StatusUnauthorized, "unauthorized", "not signed in")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), viewerCtxKey{}, v)))
	})
}

// optionalViewer attaches the viewer to the context when a valid viewer
// session exists; anonymous requests pass through untouched.
func (s *Server) optionalViewer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(viewerAccessCookieName)
		if err != nil || c.Value == "" {
			next.ServeHTTP(w, r)
			return
		}
		if s.denylist.Revoked(r.Context(), c.Value) {
			next.ServeHTTP(w, r)
			return
		}
		claims, err := verifyViewerAccessToken(s.secret, c.Value)
		if err != nil {
			next.ServeHTTP(w, r)
			return
		}
		v, err := db.ViewerByID(r.Context(), s.pool, claims.ViewerID)
		if err != nil || v.Disabled {
			next.ServeHTTP(w, r)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), viewerCtxKey{}, v)))
	})
}

// --- admin CRUD ---------------------------------------------------------------

type viewerBody struct {
	Email       string `json:"email"`
	NameSurname string `json:"nameSurname"`
	Password    string `json:"password"`
	Disabled    bool   `json:"disabled"`
}

func (s *Server) handleViewersList(w http.ResponseWriter, r *http.Request) {
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	viewers, total, err := db.ListViewersPage(r.Context(), s.pool, page, limit)
	if err != nil {
		s.internalError(w, r, "list viewers", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": viewers, "total": total})
}

func (s *Server) handleViewerCreate(w http.ResponseWriter, r *http.Request) {
	var body viewerBody
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid JSON body")
		return
	}
	body.Email = strings.TrimSpace(body.Email)
	body.NameSurname = strings.TrimSpace(body.NameSurname)
	if body.Email == "" || body.Password == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "email and password are required")
		return
	}
	hash, err := password.Hash(body.Password)
	if err != nil {
		s.internalError(w, r, "hash viewer password", err)
		return
	}
	v, err := db.CreateViewer(r.Context(), s.pool, body.Email, body.NameSurname, hash)
	if err != nil {
		if isUniqueViolation(err) {
			writeError(w, http.StatusConflict, "conflict", "email already in use")
			return
		}
		s.internalError(w, r, "create viewer", err)
		return
	}
	writeJSON(w, http.StatusCreated, v)
}

func (s *Server) handleViewerUpdate(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid viewer id")
		return
	}
	var body viewerBody
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid JSON body")
		return
	}
	body.Email = strings.TrimSpace(body.Email)
	body.NameSurname = strings.TrimSpace(body.NameSurname)
	if body.Email == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "email is required")
		return
	}
	hash := ""
	if body.Password != "" {
		if hash, err = password.Hash(body.Password); err != nil {
			s.internalError(w, r, "hash viewer password", err)
			return
		}
	}
	v, err := db.UpdateViewer(r.Context(), s.pool, id, body.Email, body.NameSurname, hash, body.Disabled)
	if err != nil {
		if isUniqueViolation(err) {
			writeError(w, http.StatusConflict, "conflict", "email already in use")
			return
		}
		if errors.Is(err, db.ErrNotFound) {
			writeError(w, http.StatusNotFound, "not_found", "viewer not found")
			return
		}
		s.internalError(w, r, "update viewer", err)
		return
	}
	writeJSON(w, http.StatusOK, v)
}

func (s *Server) handleViewerDelete(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid viewer id")
		return
	}
	if err := db.DeleteViewer(r.Context(), s.pool, id); err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeError(w, http.StatusNotFound, "not_found", "viewer not found")
			return
		}
		s.internalError(w, r, "delete viewer", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// isUniqueViolation reports a Postgres unique-constraint violation.
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// libraryMode resolves the public library policy.
func (s *Server) libraryMode() string {
	return s.settings.String("library.mode", "disabled")
}
