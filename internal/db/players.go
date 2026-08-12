package db

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Player is a player design (accent colors, logo, loader). The seeded
// Default player has IsDefault=true and cannot be deleted or edited.
type Player struct {
	ID        int64           `json:"id"`
	Name      string          `json:"name"`
	IsDefault bool            `json:"isDefault"`
	Config    json.RawMessage `json:"config"`
	CreatedAt time.Time       `json:"createdAt"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

// PlayerConfigSpec lists the accepted config keys with their JSON types.
// Unknown keys are dropped on write; values are coerced/validated.
var PlayerConfigSpec = map[string]string{
	"accentColor":      "string", // hex color tinting the controls (empty = current white look)
	"logoUrl":          "string", // watermark image URL (absolute or /media/...)
	"logoHref":         "string", // optional link behind the watermark
	"logoPosition":     "string", // top-left|top-right|bottom-left|bottom-right
	"logoSize":         "number", // watermark side length in px
	"logoOpacity":      "number", // 0..1
	"showLoader":       "bool",   // buffering spinner overlay
	"autoHideControls": "bool",   // hide the control bar until hover
}

// SanitizePlayerConfig validates and normalizes a raw config map against the
// spec: unknown keys are dropped, invalid values fall back to defaults.
func SanitizePlayerConfig(in map[string]any) (json.RawMessage, error) {
	out := map[string]any{}
	str := func(k, def string) {
		v, ok := in[k]
		if !ok || v == nil {
			out[k] = def
			return
		}
		if s, ok := v.(string); ok {
			out[k] = s
		} else {
			out[k] = def
		}
	}
	num := func(k string, def float64, min, max float64) {
		v, ok := in[k]
		if !ok || v == nil {
			out[k] = def
			return
		}
		var f float64
		switch n := v.(type) {
		case float64:
			f = n
		case json.Number:
			f, _ = n.Float64()
		default:
			out[k] = def
			return
		}
		if f < min || f > max {
			out[k] = def
			return
		}
		out[k] = f
	}
	bool := func(k string, def bool) {
		v, ok := in[k]
		if !ok || v == nil {
			out[k] = def
			return
		}
		if b, ok := v.(bool); ok {
			out[k] = b
		} else {
			out[k] = def
		}
	}

	str("accentColor", "")
	str("logoUrl", "")
	str("logoHref", "")
	str("logoPosition", "top-right")
	switch out["logoPosition"] {
	case "top-left", "top-right", "bottom-left", "bottom-right":
	default:
		out["logoPosition"] = "top-right"
	}
	num("logoSize", 64, 16, 512)
	num("logoOpacity", 0.8, 0, 1)
	bool("showLoader", true)
	bool("autoHideControls", true)
	return json.Marshal(out)
}

const playerColumns = `id, name, is_default, config, created_at, updated_at`

func scanPlayer(row pgx.Row) (Player, error) {
	var p Player
	err := row.Scan(&p.ID, &p.Name, &p.IsDefault, &p.Config, &p.CreatedAt, &p.UpdatedAt)
	return p, err
}

func ListPlayers(ctx context.Context, pool *pgxpool.Pool) ([]Player, error) {
	rows, err := pool.Query(ctx, `SELECT `+playerColumns+` FROM players ORDER BY is_default DESC, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Player{}
	for rows.Next() {
		p, err := scanPlayer(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// DefaultPlayer returns the seeded site-wide fallback design.
func DefaultPlayer(ctx context.Context, pool *pgxpool.Pool) (Player, error) {
	p, err := scanPlayer(pool.QueryRow(ctx,
		`SELECT `+playerColumns+` FROM players WHERE is_default ORDER BY id LIMIT 1`))
	if errors.Is(err, pgx.ErrNoRows) {
		return Player{}, ErrNotFound
	}
	return p, err
}

func PlayerByID(ctx context.Context, pool *pgxpool.Pool, id int64) (Player, error) {
	p, err := scanPlayer(pool.QueryRow(ctx,
		`SELECT `+playerColumns+` FROM players WHERE id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return Player{}, ErrNotFound
	}
	return p, err
}

func CreatePlayer(ctx context.Context, pool *pgxpool.Pool, name string, config json.RawMessage) (Player, error) {
	p, err := scanPlayer(pool.QueryRow(ctx, `
		INSERT INTO players (name, config) VALUES ($1, $2)
		RETURNING `+playerColumns, name, config))
	return p, err
}

// UpdatePlayer edits a non-default player design. Editing the seeded
// Default is refused (it defines the out-of-the-box look).
func UpdatePlayer(ctx context.Context, pool *pgxpool.Pool, id int64, name string, config json.RawMessage) (Player, error) {
	tag, err := pool.Exec(ctx, `
		UPDATE players SET name = $1, config = $2, updated_at = now()
		WHERE id = $3 AND NOT is_default`, name, config, id)
	if err != nil {
		return Player{}, err
	}
	if tag.RowsAffected() == 0 {
		// Distinguish "not found" from "default is immutable".
		if _, err := PlayerByID(ctx, pool, id); err != nil {
			return Player{}, err
		}
		return Player{}, ErrImmutable
	}
	return PlayerByID(ctx, pool, id)
}

// ErrImmutable marks the seeded Default player; it can never be deleted.
var ErrImmutable = errors.New("db: player is the immutable default")

// DeletePlayer removes a player design; entries referencing it fall back to
// the Default player (ON DELETE SET NULL).
func DeletePlayer(ctx context.Context, pool *pgxpool.Pool, id int64) error {
	tag, err := pool.Exec(ctx, `DELETE FROM players WHERE id = $1 AND NOT is_default`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		if _, err := PlayerByID(ctx, pool, id); err != nil {
			return ErrNotFound
		}
		return ErrImmutable
	}
	return nil
}
