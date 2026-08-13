package main

import (
	"context"
	"os"
	"path/filepath"

	"github.com/jackc/pgx/v5/pgxpool"
)

// cleanupStaleUploads removes uploads abandoned for over 24 hours: the
// uploads table row, the local spool file (bytes on disk), and the entry
// that never received its file (still 'uploading'). Runs hourly on the
// worker.
func cleanupStaleUploads(ctx context.Context, pool *pgxpool.Pool, spoolDir string) error {
	rows, err := pool.Query(ctx, `
		SELECT upload_id FROM uploads
		WHERE created_at < now() - interval '24 hours'`)
	if err != nil {
		return err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	for _, id := range ids {
		if spoolDir != "" {
			os.Remove(filepath.Join(spoolDir, id)) // best effort
		}
		if _, err := pool.Exec(ctx, `DELETE FROM uploads WHERE upload_id = $1`, id); err != nil {
			return err
		}
	}

	// Entries stuck in 'uploading' with no active upload row.
	_, err = pool.Exec(ctx, `
		DELETE FROM entries e
		WHERE e.status = 'uploading'
		  AND e.created_at < now() - interval '24 hours'
		  AND NOT EXISTS (SELECT 1 FROM uploads u WHERE u.entry_id = e.id)`)
	return err
}
