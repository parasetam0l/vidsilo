// Package password hashes credentials with argon2id and verifies both
// argon2id and legacy bcrypt hashes (upgraded transparently on next login).
package password

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/bcrypt"
)

const (
	argonTime    = 1
	argonMemory  = 64 * 1024
	argonThreads = 4
	argonKeyLen  = 32
	argonSaltLen = 16
)

// Hash returns an argon2id-encoded hash.
func Hash(pw string) (string, error) {
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := argon2.IDKey([]byte(pw), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	b64 := func(b []byte) string { return base64.RawStdEncoding.EncodeToString(b) }
	return fmt.Sprintf("$argon2id$v=%d,m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, argonMemory, argonTime, argonThreads, b64(salt), b64(key)), nil
}

// Verify checks pw against an argon2id or legacy bcrypt hash. It returns
// (ok, upgradeNeeded): upgradeNeeded is true when a bcrypt hash should be
// re-hashed with argon2id.
func Verify(pw, encoded string) (bool, bool) {
	if strings.HasPrefix(encoded, "$argon2id$") {
		return verifyArgon(pw, encoded), false
	}
	if strings.HasPrefix(encoded, "$2a$") || strings.HasPrefix(encoded, "$2b$") {
		return bcrypt.CompareHashAndPassword([]byte(encoded), []byte(pw)) == nil, true
	}
	return false, false
}

func verifyArgon(pw, encoded string) bool {
	parts := strings.Split(encoded, "$")
	// $argon2id$v=19,m=65536,t=1,p=4$salt$hash
	if len(parts) != 5 {
		return false
	}
	var version int
	var m, t, p uint32
	for _, param := range strings.Split(parts[2], ",") {
		kv := strings.SplitN(param, "=", 2)
		if len(kv) != 2 {
			return false
		}
		n, err := strconv.ParseUint(kv[1], 10, 32)
		if err != nil {
			return false
		}
		switch kv[0] {
		case "v":
			version = int(n)
		case "m":
			m = uint32(n)
		case "t":
			t = uint32(n)
		case "p":
			p = uint32(n)
		}
	}
	if version != argon2.Version {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[3])
	if err != nil {
		return false
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false
	}
	got := argon2.IDKey([]byte(pw), salt, t, m, uint8(p), uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1
}

var ErrInvalidFormat = errors.New("password: invalid hash format")
