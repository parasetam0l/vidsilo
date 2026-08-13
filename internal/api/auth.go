package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/parasetam0l/vidsilo/internal/db"
	"github.com/parasetam0l/vidsilo/internal/password"
	"github.com/parasetam0l/vidsilo/internal/secrets"
)

const (
	accessCookieName  = "vidsilo_session"
	refreshCookieName = "vidsilo_refresh"
	refreshTTL        = 7 * 24 * time.Hour
	userCtxKey        = ctxKey("user")
)

// Per-account login throttling: after N failed attempts an account is
// locked for a cooldown window regardless of the source IP, stopping
// distributed brute force (the IP limiter still bounds the raw volume).
const (
	loginMaxFailures = 5
	loginLockout     = 10 * time.Minute
)

type loginGuard struct {
	mu       sync.Mutex
	failures map[string]int
	lockedAt map[string]time.Time
}

// prune drops stale entries so the maps stay bounded: an attacker rotating
// through random emails must not be able to grow them without limit.
func (g *loginGuard) prune(now time.Time) {
	if len(g.failures)+len(g.lockedAt) < 10_000 {
		return
	}
	for k, n := range g.failures {
		if n <= 0 {
			delete(g.failures, k)
		}
	}
	for k, at := range g.lockedAt {
		if loginLockout-time.Since(at) <= 0 {
			delete(g.lockedAt, k)
			delete(g.failures, k)
		}
	}
}

func (g *loginGuard) locked(email string) (time.Duration, bool) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.prune(time.Now())
	if at, ok := g.lockedAt[strings.ToLower(email)]; ok {
		left := loginLockout - time.Since(at)
		if left > 0 {
			return left, true
		}
		delete(g.lockedAt, strings.ToLower(email))
		delete(g.failures, strings.ToLower(email))
	}
	return 0, false
}

func (g *loginGuard) failure(email string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.prune(time.Now())
	key := strings.ToLower(email)
	g.failures[key]++
	if g.failures[key] >= loginMaxFailures {
		g.lockedAt[key] = time.Now()
		delete(g.failures, key)
	}
}

func (g *loginGuard) success(email string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	key := strings.ToLower(email)
	delete(g.failures, key)
	delete(g.lockedAt, key)
}

type ctxKey string

func (s *Server) registerAuthRoutes(mux *http.ServeMux) {
	// All /api routes are token-bucket limited by rateLimitAPI (tighter on
	// /api/auth/*); individual handlers stay plain.
	mux.HandleFunc("POST /api/auth/login", s.handleLogin)
	mux.HandleFunc("POST /api/auth/refresh", s.handleRefresh)
	mux.HandleFunc("POST /api/auth/logout", s.handleLogout)
	mux.Handle("PATCH /api/auth/password", s.requireAuth(http.HandlerFunc(s.handleChangePassword)))
	mux.Handle("GET /api/auth/me", s.requireAuth(http.HandlerFunc(s.handleMe)))
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
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

	u, err := db.UserByEmail(r.Context(), s.pool, req.Email)
	if errors.Is(err, pgx.ErrNoRows) {
		// Constant-ish time: burn a verify against a dummy hash.
		password.Verify(req.Password, "$argon2id$v=19,m=65536,t=1,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
		s.loginGuard.failure(req.Email)
		writeError(w, http.StatusUnauthorized, "unauthorized", "invalid credentials")
		return
	}
	if err != nil {
		s.internalError(w, r, "login lookup", err)
		return
	}
	ok, upgrade := password.Verify(req.Password, u.PasswordHash)
	if !ok {
		s.loginGuard.failure(req.Email)
		writeError(w, http.StatusUnauthorized, "unauthorized", "invalid credentials")
		return
	}
	if u.Disabled {
		writeError(w, http.StatusForbidden, "forbidden", "account disabled")
		return
	}
	s.loginGuard.success(req.Email)
	if upgrade {
		// Legacy bcrypt hash: transparently re-hash with argon2id.
		if newHash, err := password.Hash(req.Password); err == nil {
			_ = db.UpdateUserPassword(r.Context(), s.pool, u.ID, newHash)
		}
	}
	s.issueSession(w, r, u)
}

func (s *Server) handleRefresh(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie(refreshCookieName)
	if err != nil || c.Value == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized", "no refresh token")
		return
	}
	hash := sha256.Sum256([]byte(c.Value))
	var tokenID, userID int64
	var revoked bool
	var expiresAt time.Time
	err = s.pool.QueryRow(r.Context(), `
		SELECT id, user_id, revoked, expires_at
		FROM refresh_tokens WHERE token_hash = $1`, hex.EncodeToString(hash[:])).
		Scan(&tokenID, &userID, &revoked, &expiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusUnauthorized, "unauthorized", "invalid refresh token")
		return
	}
	if err != nil {
		s.internalError(w, r, "refresh lookup", err)
		return
	}

	if revoked || expiresAt.Before(time.Now()) {
		// Token reuse after rotation: revoke the whole session family.
		_, _ = s.pool.Exec(r.Context(), `DELETE FROM refresh_tokens WHERE user_id = $1`, userID)
		s.clearSessionCookies(w, r)
		writeError(w, http.StatusUnauthorized, "unauthorized", "session revoked")
		return
	}

	u, err := db.UserByID(r.Context(), s.pool, userID)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized", "invalid refresh token")
		return
	}
	if u.Disabled {
		writeError(w, http.StatusForbidden, "forbidden", "account disabled")
		return
	}

	// Rotate: delete this token, issue a fresh pair.
	_, _ = s.pool.Exec(r.Context(), `DELETE FROM refresh_tokens WHERE id = $1`, tokenID)
	s.issueSession(w, r, u)
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	// Revoke the access JWT immediately (stateless tokens otherwise live
	// out their TTL); also drop the refresh token from the DB.
	if c, err := r.Cookie(accessCookieName); err == nil && c.Value != "" {
		s.denylist.Revoke(r.Context(), c.Value, accessTokenTTL)
	}
	if c, err := r.Cookie(refreshCookieName); err == nil && c.Value != "" {
		hash := sha256.Sum256([]byte(c.Value))
		_, _ = s.pool.Exec(r.Context(),
			`DELETE FROM refresh_tokens WHERE token_hash = $1`, hex.EncodeToString(hash[:]))
	}
	s.clearSessionCookies(w, r)
	w.WriteHeader(http.StatusNoContent)
}

type changePasswordRequest struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}

// handleChangePassword lets a signed-in user rotate their own password;
// other sessions are revoked so a leaked password stops working everywhere.
func (s *Server) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	u := userFromContext(r.Context())
	var req changePasswordRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "invalid JSON body")
		return
	}
	if len(req.NewPassword) < 8 {
		writeError(w, http.StatusBadRequest, "bad_request", "new password must be at least 8 characters")
		return
	}
	ok, _ := password.Verify(req.CurrentPassword, u.PasswordHash)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized", "current password is incorrect")
		return
	}
	hash, err := password.Hash(req.NewPassword)
	if err != nil {
		s.internalError(w, r, "hash password", err)
		return
	}
	if err := db.UpdateUserPassword(r.Context(), s.pool, u.ID, hash); err != nil {
		s.internalError(w, r, "update password", err)
		return
	}
	// Revoke every refresh token except the one in this request's cookie.
	if c, err := r.Cookie(refreshCookieName); err == nil && c.Value != "" {
		hash := sha256.Sum256([]byte(c.Value))
		_, _ = s.pool.Exec(r.Context(), `
			DELETE FROM refresh_tokens
			WHERE user_id = $1 AND token_hash <> $2`, u.ID, hex.EncodeToString(hash[:]))
	} else {
		_, _ = s.pool.Exec(r.Context(), `DELETE FROM refresh_tokens WHERE user_id = $1`, u.ID)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	u := userFromContext(r.Context())
	writeJSON(w, http.StatusOK, u)
}

// issueSession signs an access JWT and creates a fresh refresh token.
func (s *Server) issueSession(w http.ResponseWriter, r *http.Request, u db.User) {
	access, err := signAccessToken(s.secret, u)
	if err != nil {
		s.internalError(w, r, "sign access token", err)
		return
	}
	raw, err := secrets.RandomToken(32)
	if err != nil {
		s.internalError(w, r, "generate refresh token", err)
		return
	}
	hash := sha256.Sum256([]byte(raw))
	_, err = s.pool.Exec(r.Context(), `
		INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
		VALUES ($1, $2, $3)`,
		u.ID, hex.EncodeToString(hash[:]), time.Now().Add(refreshTTL))
	if err != nil {
		s.internalError(w, r, "store refresh token", err)
		return
	}

	http.SetCookie(w, &http.Cookie{ // #nosec G124 -- HttpOnly+SameSite below; Secure follows TLS
		Name:     accessCookieName,
		Value:    access,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   r.TLS != nil, // #nosec G124 -- cookie already HttpOnly+SameSite; Secure follows TLS
		MaxAge:   int(accessTokenTTL.Seconds()),
	})
	http.SetCookie(w, &http.Cookie{ // #nosec G124 -- HttpOnly+SameSite below; Secure follows TLS
		Name:     refreshCookieName,
		Value:    raw,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   r.TLS != nil, // #nosec G124 -- cookie already HttpOnly+SameSite; Secure follows TLS
		MaxAge:   int(refreshTTL.Seconds()),
	})
	writeJSON(w, http.StatusOK, u)
}

func (s *Server) clearSessionCookies(w http.ResponseWriter, r *http.Request) {
	for _, name := range []string{accessCookieName, refreshCookieName} {
		http.SetCookie(w, &http.Cookie{ // #nosec G124 -- HttpOnly+SameSite below; Secure follows TLS
			Name:     name,
			Value:    "",
			Path:     "/",
			HttpOnly: true,
			SameSite: http.SameSiteLaxMode,
			Secure:   r.TLS != nil, // #nosec G124 -- cookie already HttpOnly+SameSite; Secure follows TLS
			MaxAge:   -1,
		})
	}
}

// --- middleware -------------------------------------------------------------

// requireAuth loads the user for valid sessions, 401 otherwise.
func (s *Server) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(accessCookieName)
		if err != nil || c.Value == "" {
			writeError(w, http.StatusUnauthorized, "unauthorized", "not signed in")
			return
		}
		if s.denylist.Revoked(r.Context(), c.Value) {
			writeError(w, http.StatusUnauthorized, "unauthorized", "session revoked")
			return
		}
		claims, err := verifyAccessToken(s.secret, c.Value)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "unauthorized", "session expired")
			return
		}
		u, err := db.UserByID(r.Context(), s.pool, claims.UserID)
		if err != nil || u.Disabled {
			writeError(w, http.StatusUnauthorized, "unauthorized", "not signed in")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userCtxKey, u)))
	})
}

// requireRole composes requireAuth with a role check (first match wins).
func (s *Server) requireRole(roles ...db.Role) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return s.requireAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			u := userFromContext(r.Context())
			for _, role := range roles {
				if u.Role == role {
					next.ServeHTTP(w, r)
					return
				}
			}
			writeError(w, http.StatusForbidden, "forbidden", "insufficient permissions")
		}))
	}
}

// originCheck rejects cross-site state-changing requests (CSRF in depth,
// layered on top of SameSite=Lax cookies).
func (s *Server) originCheck(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions {
			next.ServeHTTP(w, r)
			return
		}
		origin := r.Header.Get("Origin")
		if origin != "" && !sameOrigin(r, origin) {
			writeError(w, http.StatusForbidden, "forbidden", "cross-origin request rejected")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func sameOrigin(r *http.Request, origin string) bool {
	if origin == "null" {
		return false
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	want := scheme + "://" + r.Host
	return origin == want || strings.HasPrefix(origin, want+"/")
}

// userFromContext returns the authenticated user or the zero value.
func userFromContext(ctx context.Context) db.User {
	u, _ := ctx.Value(userCtxKey).(db.User)
	return u
}
