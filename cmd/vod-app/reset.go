package main

import (
	"context"
	cryptorand "crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"os"

	"github.com/parasetam0l/vod-app/internal/config"
	"github.com/parasetam0l/vod-app/internal/db"
	"github.com/parasetam0l/vod-app/internal/password"
)

// cmdResetAdmin rotates the admin password and prints it once. Requires host
// access to the database (operator-only escape hatch, mirrors the README).
func cmdResetAdmin(args []string) {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg, err := config.Load()
	if err != nil {
		log.Error("invalid config", "err", err)
		os.Exit(1)
	}
	ctx := context.Background()
	pool, err := db.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Error("database", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	pw, err := randomHex(32)
	if err != nil {
		log.Error("generate password", "err", err)
		os.Exit(1)
	}
	hash, err := password.Hash(pw)
	if err != nil {
		log.Error("hash password", "err", err)
		os.Exit(1)
	}
	tag, err := pool.Exec(ctx, `
		UPDATE users SET password_hash = $1
		WHERE lower(email) = 'admin@localhost' AND role = 'admin'`, hash)
	if err != nil {
		log.Error("update admin", "err", err)
		os.Exit(1)
	}
	if tag.RowsAffected() == 0 {
		fmt.Fprintln(os.Stderr, "no admin user found — has the server been started once?")
		os.Exit(1)
	}
	// Invalidate all existing sessions.
	_, _ = pool.Exec(ctx, `DELETE FROM refresh_tokens`)
	fmt.Printf("admin password rotated — email: admin@localhost password: %s\n", pw)
}

func randomHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := cryptorand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
