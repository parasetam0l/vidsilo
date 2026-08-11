package db

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/parasetam0l/vod-app/internal/password"
)

// defaultSettings are the code defaults from DESIGN §4.3. Admin edits land in
// the settings table and win over these.
var defaultSettings = map[string]any{
	"site_name":                 "VOD",
	"default_lang":              "en",
	"upload.max_size_bytes":     8 << 30,
	"upload.allowed_extensions": []string{"mp4", "mov", "mkv", "webm", "m4v", "avi"},
	"transcode.concurrency":     0,
	"transcode.segment_seconds": 4,
	"transcode.gop_seconds":     2,
	"transcode.preset":          "veryfast",
	"cache.enabled":             false,
	"cache.max_bytes":           1 << 30,
	"analytics.enabled":         true,
	"analytics.retention_days":  30,
	"analytics.flush_interval_s": 10,
	"tls.mode":                  "off",
	"tls.acme_domains":          []string{},
	"tls.cert_dir":              "/data/certs",
}

// seedSettings inserts missing defaults; existing values are preserved.
func seedSettings(ctx context.Context, conn *pgxpool.Conn) error {
	for key, value := range defaultSettings {
		raw, err := json.Marshal(value)
		if err != nil {
			return err
		}
		if _, err := conn.Exec(ctx,
			`INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)
			 ON CONFLICT (key) DO NOTHING`, key, raw); err != nil {
			return err
		}
	}
	return nil
}

// defaultFlavors is a reasonable starter ladder; admins manage them in the
// panel and disabled entries are never transcoded.
var defaultFlavors = []Flavor{
	{Name: "1080p-h264", Label: "1080p", Codec: "h264", Height: 1080, VideoMode: "crf", CRF: f64(23), AudioBitrate: 128, Preset: "veryfast", Enabled: true, Position: 1},
	{Name: "720p-h264", Label: "720p", Codec: "h264", Height: 720, VideoMode: "crf", CRF: f64(23), AudioBitrate: 128, Preset: "veryfast", Enabled: true, Position: 2},
	{Name: "480p-h264", Label: "480p", Codec: "h264", Height: 480, VideoMode: "crf", CRF: f64(24), AudioBitrate: 128, Preset: "veryfast", Enabled: true, Position: 3},
	{Name: "360p-h264", Label: "360p", Codec: "h264", Height: 360, VideoMode: "crf", CRF: f64(25), AudioBitrate: 96, Preset: "veryfast", Enabled: true, Position: 4},
	{Name: "1080p-h265", Label: "1080p HEVC", Codec: "h265", Height: 1080, VideoMode: "crf", CRF: f64(26), AudioBitrate: 128, Preset: "veryfast", Enabled: false, Position: 5},
	{Name: "720p-h265", Label: "720p HEVC", Codec: "h265", Height: 720, VideoMode: "crf", CRF: f64(27), AudioBitrate: 128, Preset: "veryfast", Enabled: false, Position: 6},
}

func f64(v float64) *float64 { return &v }

// seedFlavors inserts default flavors that are not yet present (by name).
func seedFlavors(ctx context.Context, conn *pgxpool.Conn) error {
	for _, f := range defaultFlavors {
		var crf *float64
		var vbr *int
		if f.VideoMode == "crf" {
			crf = f.CRF
		} else {
			vbr = f.VideoBitrate
		}
		_, err := conn.Exec(ctx, `
			INSERT INTO flavors (name, label, codec, height, video_mode, crf, video_bitrate, audio_bitrate, preset, enabled, position)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
			ON CONFLICT (name) DO NOTHING`,
			f.Name, f.Label, f.Codec, f.Height, f.VideoMode, crf, vbr, f.AudioBitrate, f.Preset, f.Enabled, f.Position)
		if err != nil {
			return err
		}
	}
	return nil
}

// seedAdmin creates the first-run admin when the users table is empty. The
// random password is logged once; reset-admin rotates it later.
func seedAdmin(ctx context.Context, conn *pgxpool.Conn, log *slog.Logger) error {
	var n int
	if err := conn.QueryRow(ctx, `SELECT count(*) FROM users`).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	pw := randomPassword(32)
	hash, err := password.Hash(pw)
	if err != nil {
		return err
	}
	if _, err := conn.Exec(ctx,
		`INSERT INTO users (email, name_surname, password_hash, role) VALUES ($1, $2, $3, 'admin')`,
		"admin@localhost", "Admin", hash); err != nil {
		return err
	}
	log.Info("First-run admin created", "email", "admin@localhost", "password", pw)
	return nil
}

func randomPassword(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err) // crypto/rand failure is unrecoverable
	}
	return hex.EncodeToString(b)
}
