package db

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func scanFlavor(row pgx.Row) (Flavor, error) {
	var f Flavor
	err := row.Scan(
		&f.ID, &f.Name, &f.Label, &f.Codec, &f.Height,
		&f.VideoMode, &f.CRF, &f.VideoBitrate, &f.AudioBitrate,
		&f.Preset, &f.Enabled, &f.Position,
	)
	return f, err
}

const flavorColumns = `
	id, name, label, codec, height, video_mode, crf, video_bitrate, audio_bitrate,
	preset, enabled, position`

func FlavorByID(ctx context.Context, pool *pgxpool.Pool, id int64) (Flavor, error) {
	f, err := scanFlavor(pool.QueryRow(ctx, `SELECT `+flavorColumns+` FROM flavors WHERE id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return Flavor{}, ErrNotFound
	}
	return f, err
}

func FlavorByName(ctx context.Context, pool *pgxpool.Pool, name string) (Flavor, error) {
	f, err := scanFlavor(pool.QueryRow(ctx, `SELECT `+flavorColumns+` FROM flavors WHERE name = $1`, name))
	if errors.Is(err, pgx.ErrNoRows) {
		return Flavor{}, ErrNotFound
	}
	return f, err
}

func ListFlavors(ctx context.Context, pool *pgxpool.Pool) ([]Flavor, error) {
	rows, err := pool.Query(ctx, `SELECT `+flavorColumns+` FROM flavors ORDER BY position, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Flavor{}
	for rows.Next() {
		f, err := scanFlavor(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

func EnabledFlavors(ctx context.Context, pool *pgxpool.Pool) ([]Flavor, error) {
	rows, err := pool.Query(ctx, `SELECT `+flavorColumns+` FROM flavors WHERE enabled ORDER BY position, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Flavor{}
	for rows.Next() {
		f, err := scanFlavor(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

func CreateFlavor(ctx context.Context, pool *pgxpool.Pool, f Flavor) (Flavor, error) {
	var out Flavor
	err := pool.QueryRow(ctx, `
		INSERT INTO flavors (name, label, codec, height, video_mode, crf, video_bitrate, audio_bitrate, preset, enabled, position)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		RETURNING `+flavorColumns,
		f.Name, f.Label, f.Codec, f.Height, f.VideoMode, f.CRF, f.VideoBitrate,
		f.AudioBitrate, f.Preset, f.Enabled, f.Position).Scan(
		&out.ID, &out.Name, &out.Label, &out.Codec, &out.Height,
		&out.VideoMode, &out.CRF, &out.VideoBitrate, &out.AudioBitrate,
		&out.Preset, &out.Enabled, &out.Position)
	return out, err
}

func UpdateFlavor(ctx context.Context, pool *pgxpool.Pool, id int64, f Flavor) (Flavor, error) {
	var out Flavor
	err := pool.QueryRow(ctx, `
		UPDATE flavors SET name = $1, label = $2, codec = $3, height = $4, video_mode = $5,
			crf = $6, video_bitrate = $7, audio_bitrate = $8, preset = $9, enabled = $10, position = $11
		WHERE id = $12
		RETURNING `+flavorColumns,
		f.Name, f.Label, f.Codec, f.Height, f.VideoMode, f.CRF, f.VideoBitrate,
		f.AudioBitrate, f.Preset, f.Enabled, f.Position, id).Scan(
		&out.ID, &out.Name, &out.Label, &out.Codec, &out.Height,
		&out.VideoMode, &out.CRF, &out.VideoBitrate, &out.AudioBitrate,
		&out.Preset, &out.Enabled, &out.Position)
	return out, err
}

func DeleteFlavor(ctx context.Context, pool *pgxpool.Pool, id int64) error {
	_, err := pool.Exec(ctx, `DELETE FROM flavors WHERE id = $1`, id)
	return err
}
