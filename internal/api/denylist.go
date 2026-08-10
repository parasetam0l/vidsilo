package api

import (
	"crypto/sha256"
	"encoding/hex"
	"sync"
	"time"
)

// Denylist revokes access JWTs on logout. Tokens are stateless, so we keep
// their sha256 hashes until natural expiry. In-memory and per-node: a
// single-node deployment revokes instantly; multi-node setups should add a
// shared store (documented limitation).
type Denylist struct {
	mu    sync.Mutex
	until map[string]time.Time
}

func NewDenylist() *Denylist {
	return &Denylist{until: map[string]time.Time{}}
}

func (d *Denylist) hash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// Revoke marks a token invalid until it would have expired anyway.
func (d *Denylist) Revoke(token string, ttl time.Duration) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.until[d.hash(token)] = time.Now().Add(ttl)
}

// Revoked reports whether the token is on the denylist, pruning expired
// entries on access.
func (d *Denylist) Revoked(token string) bool {
	if token == "" {
		return false
	}
	h := d.hash(token)
	now := time.Now()
	d.mu.Lock()
	defer d.mu.Unlock()
	exp, ok := d.until[h]
	if !ok {
		return false
	}
	if exp.Before(now) {
		delete(d.until, h)
		return false
	}
	return true
}
