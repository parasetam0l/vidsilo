package db

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// UpdateJobProgress stores a short human-readable status line on a running
// job (e.g. "Transcoding 1080p-h264 (2/4)") shown by the jobs page.
func UpdateJobProgress(ctx context.Context, pool *pgxpool.Pool, jobID int64, text string) error {
	_, err := pool.Exec(ctx, `
		UPDATE jobs SET progress = $1, updated_at = now() WHERE id = $2`, text, jobID)
	return err
}
