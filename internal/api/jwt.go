package api

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/parasetam0l/vod-app/internal/db"
)

// Hand-rolled HS256 JWT: header.payload.signature, constant-time verify.
// Kept tiny on purpose — no framework, exactly two claims we need.

const accessTokenTTL = 15 * time.Minute

type accessClaims struct {
	UserID int64    `json:"uid"`
	Role   db.Role  `json:"rol"`
	Exp    int64    `json:"exp"`
}

func b64url(b []byte) string {
	return base64.RawURLEncoding.EncodeToString(b)
}

func un64url(s string) ([]byte, error) {
	return base64.RawURLEncoding.DecodeString(s)
}

func signAccessToken(secret []byte, u db.User) (string, error) {
	header := b64url([]byte(`{"alg":"HS256","typ":"JWT"}`))
	claims, err := json.Marshal(accessClaims{
		UserID: u.ID,
		Role:   u.Role,
		Exp:    time.Now().Add(accessTokenTTL).Unix(),
	})
	if err != nil {
		return "", err
	}
	payload := b64url(claims)
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(header + "." + payload))
	return header + "." + payload + "." + b64url(mac.Sum(nil)), nil
}

var errBadToken = errors.New("jwt: invalid token")

func verifyAccessToken(secret []byte, token string) (*accessClaims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, errBadToken
	}
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(parts[0] + "." + parts[1]))
	want := mac.Sum(nil)
	got, err := un64url(parts[2])
	if err != nil || subtle.ConstantTimeCompare(got, want) != 1 {
		return nil, errBadToken
	}
	payload, err := un64url(parts[1])
	if err != nil {
		return nil, errBadToken
	}
	var c accessClaims
	if err := json.Unmarshal(payload, &c); err != nil {
		return nil, errBadToken
	}
	if c.Exp < time.Now().Unix() {
		return nil, errors.New("jwt: token expired")
	}
	return &c, nil
}
