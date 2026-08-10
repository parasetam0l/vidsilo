package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/parasetam0l/vod-app/internal/db"
	"github.com/parasetam0l/vod-app/internal/password"
	"github.com/parasetam0l/vod-app/internal/secrets"
	"github.com/parasetam0l/vod-app/internal/settings"
	"github.com/parasetam0l/vod-app/internal/testdb"
)

// Integration tests against a live database (docker compose up -d db).

func testServer(t *testing.T) (*Server, *pgxpool.Pool, string) {
	t.Helper()
	ctx := context.Background()
	pool := testdb.Pool(t)
	db.MustSeed(ctx, pool, nil)

	svc, err := settings.New(ctx, pool)
	if err != nil {
		t.Fatal(err)
	}
	secret, err := secrets.LoadOrCreate(t.TempDir() + "/secret.key")
	if err != nil {
		t.Fatal(err)
	}
	s := NewServer(nil, nil, pool, secret, nil, svc, nil, nil, nil, nil)
	// Tests run from a single IP; give the token buckets headroom.
	s.apiLimiter = newRateLimiter(1e6, 1e6)
	s.loginLimiter = newRateLimiter(1e5, 1e5)
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	return s, pool, ts.URL
}

func TestAuthFlow(t *testing.T) {
	_, pool, base := testServer(t)
	ctx := context.Background()

	hash, err := password.Hash("testpass")
	if err != nil {
		t.Fatal(err)
	}
	u, err := db.CreateUser(ctx, pool, "apitest@example.com", "Api", "Test", hash, db.RoleEditor)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.DeleteUser(ctx, pool, u.ID) })

	client := &http.Client{}

	// Wrong password.
	resp, err := client.Post(base+"/api/auth/login", "application/json",
		strings.NewReader(`{"email":"apitest@example.com","password":"nope"}`))
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("wrong password -> %d", resp.StatusCode)
	}
	resp.Body.Close()

	// Login.
	resp, err = client.Post(base+"/api/auth/login", "application/json",
		strings.NewReader(`{"email":"apitest@example.com","password":"testpass"}`))
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("login -> %d", resp.StatusCode)
	}
	cookies := resp.Cookies()
	resp.Body.Close()
	session := cookieByName(cookies, accessCookieName)
	refresh := cookieByName(cookies, refreshCookieName)
	if session == nil || refresh == nil {
		t.Fatal("missing session cookies")
	}

	// /me with the session.
	req, _ := http.NewRequest("GET", base+"/api/auth/me", nil)
	req.AddCookie(session)
	resp, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var me db.User
	if err := json.NewDecoder(resp.Body).Decode(&me); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if me.Email != "apitest@example.com" || me.Role != db.RoleEditor {
		t.Fatalf("me = %+v", me)
	}

	// Refresh rotates the refresh cookie.
	req, _ = http.NewRequest("POST", base+"/api/auth/refresh", nil)
	req.AddCookie(refresh)
	resp, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("refresh -> %d", resp.StatusCode)
	}
	cookies = resp.Cookies()
	resp.Body.Close()
	newRefresh := cookieByName(cookies, refreshCookieName)
	if newRefresh == nil || newRefresh.Value == refresh.Value {
		t.Fatal("refresh token was not rotated")
	}

	// Reusing the old refresh token revokes the session family.
	req, _ = http.NewRequest("POST", base+"/api/auth/refresh", nil)
	req.AddCookie(refresh)
	resp, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("reused token -> %d, want 401", resp.StatusCode)
	}
	resp.Body.Close()

	// Logout clears the session.
	req, _ = http.NewRequest("POST", base+"/api/auth/logout", nil)
	req.AddCookie(newRefresh)
	resp, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("logout -> %d", resp.StatusCode)
	}
	resp.Body.Close()
}

func TestRoleEnforcement(t *testing.T) {
	_, pool, base := testServer(t)
	ctx := context.Background()

	hash, err := password.Hash("pw12345")
	if err != nil {
		t.Fatal(err)
	}
	viewer, err := db.CreateUser(ctx, pool, "viewer@example.com", "Viewer", "Test", hash, db.RoleViewer)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.DeleteUser(ctx, pool, viewer.ID) })

	client := &http.Client{}
	resp, err := client.Post(base+"/api/auth/login", "application/json",
		strings.NewReader(`{"email":"viewer@example.com","password":"pw12345"}`))
	if err != nil {
		t.Fatal(err)
	}
	session := cookieByName(resp.Cookies(), accessCookieName)
	resp.Body.Close()

	req, _ := http.NewRequest("GET", base+"/api/users", nil)
	req.AddCookie(session)
	r2, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer r2.Body.Close()
	if r2.StatusCode != http.StatusForbidden {
		t.Fatalf("viewer on /api/users -> %d, want 403", r2.StatusCode)
	}
}

func cookieByName(cookies []*http.Cookie, name string) *http.Cookie {
	for _, c := range cookies {
		if c.Name == name {
			return c
		}
	}
	return nil
}
