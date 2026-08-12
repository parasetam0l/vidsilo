package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Denylist revokes access JWTs on logout. Tokens are stateless, so their
// sha256 hashes are stored until natural expiry. DB-backed: a logout on any
// app node revokes the token cluster-wide (multi-node safe). Expired rows
// are pruned opportunistically on access, throttled to once a minute.
type Denylist struct {
	pool *pgxpool.Pool

	mu        sync.Mutex
	lastPrune time.Time
}

func NewDenylist(pool *pgxpool.Pool) *Denylist {
	return &Denylist{pool: pool}
}

func (d *Denylist) hash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// Revoke marks a token invalid until it would have expired anyway.
func (d *Denylist) Revoke(ctx context.Context, token string, ttl time.Duration) {
	if d.pool == nil {
		return
	}
	_, _ = d.pool.Exec(ctx, `
		INSERT INTO access_denylist (token_hash, expires_at)
		VALUES ($1, $2)
		ON CONFLICT (token_hash) DO UPDATE SET expires_at = GREATEST(access_denylist.expires_at, EXCLUDED.expires_at)`,
		d.hash(token), time.Now().Add(ttl))
}

// Revoked reports whether the token is on the denylist, pruning expired
// entries opportunistically (at most once per minute).
func (d *Denylist) Revoked(ctx context.Context, token string) bool {
	if token == "" || d.pool == nil {
		return false
	}
	var revoked bool
	err := d.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM access_denylist
			WHERE token_hash = $1 AND expires_at > now()
		)`, d.hash(token)).Scan(&revoked)
	if err != nil {
		return false // DB hiccup: fail open, the JWT TTL still applies
	}
	if d.shouldPrune() {
		// Opportunistic prune: rows expired over an hour ago are dead
		// weight. Bounded by a subquery so a backlog can't stall a request.
		_, _ = d.pool.Exec(ctx, `
			DELETE FROM access_denylist
			WHERE token_hash IN (
				SELECT token_hash FROM access_denylist
				WHERE expires_at <= now() - interval '1 hour'
				LIMIT 500
			)`)
	}
	return revoked
}

func (d *Denylist) shouldPrune() bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	if time.Since(d.lastPrune) < time.Minute {
		return false
	}
	d.lastPrune = time.Now()
	return true
}
