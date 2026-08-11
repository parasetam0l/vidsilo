package db

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// URLDownload tracks in-flight URL imports for progress reporting.
type URLDownload struct {
	EntryID    int64     `json:"entryId"`
	PublicID   string    `json:"publicId"`
	URL        string    `json:"url"`
	Bytes      int64     `json:"bytes"`
	TotalBytes int64     `json:"totalBytes"`
	UpdatedAt  time.Time `json:"updatedAt"`
}

func ActiveURLDownloads(ctx context.Context, pool *pgxpool.Pool) ([]URLDownload, error) {
	rows, err := pool.Query(ctx, `
		SELECT d.entry_id, e.public_id::text, d.url, d.bytes, d.total_bytes, d.updated_at
		FROM url_downloads d
		JOIN entries e ON e.id = d.entry_id
		ORDER BY d.entry_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []URLDownload{}
	for rows.Next() {
		var d URLDownload
		if err := rows.Scan(&d.EntryID, &d.PublicID, &d.URL, &d.Bytes, &d.TotalBytes, &d.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func CreateURLDownload(ctx context.Context, pool *pgxpool.Pool, entryID int64, url string) error {
	_, err := pool.Exec(ctx, `
		INSERT INTO url_downloads (entry_id, url) VALUES ($1, $2)`, entryID, url)
	return err
}

func UpdateURLDownloadProgress(ctx context.Context, pool *pgxpool.Pool, entryID, bytes, total int64) error {
	_, err := pool.Exec(ctx, `
		UPDATE url_downloads SET bytes = $2, total_bytes = $3, updated_at = now() WHERE entry_id = $1`,
		entryID, bytes, total)
	return err
}

func DeleteURLDownload(ctx context.Context, pool *pgxpool.Pool, entryID int64) error {
	_, err := pool.Exec(ctx, `DELETE FROM url_downloads WHERE entry_id = $1`, entryID)
	return err
}
