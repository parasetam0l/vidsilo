// Package secrets persists the JWT signing key on first boot.
package secrets

import (
	"crypto/rand"
	"encoding/hex"
	"os"
	"path/filepath"
)

// LoadOrCreate returns the signing key, generating and persisting a random
// 32-byte key at path when none exists yet. Rotating the file logs everyone
// out (documented in README).
func LoadOrCreate(path string) ([]byte, error) {
	if data, err := os.ReadFile(path); err == nil && len(data) >= 32 { // #nosec G304 -- operator-set config path
		return data, nil
	}
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	if err := os.WriteFile(path, key, 0o600); err != nil {
		return nil, err
	}
	return key, nil
}

// RandomToken returns n random bytes hex-encoded (for refresh tokens).
func RandomToken(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
