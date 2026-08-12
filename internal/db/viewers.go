package db

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Viewer is a public library account (email/password/name), separate from
// staff users. Viewers never reach the admin API.
type Viewer struct {
	ID           int64     `json:"id"`
	Email        string    `json:"email"`
	NameSurname  string    `json:"nameSurname"`
	PasswordHash string    `json:"-"`
	Disabled     bool      `json:"disabled"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

func (v Viewer) DisplayName() string {
	if v.NameSurname == "" {
		return v.Email
	}
	return v.NameSurname
}

const viewerColumns = "id, email, name_surname, password_hash, disabled, created_at, updated_at"

func scanViewer(row pgx.Row) (Viewer, error) {
	var v Viewer
	err := row.Scan(&v.ID, &v.Email, &v.NameSurname, &v.PasswordHash,
		&v.Disabled, &v.CreatedAt, &v.UpdatedAt)
	return v, err
}

func ViewerByEmail(ctx context.Context, pool *pgxpool.Pool, email string) (Viewer, error) {
	return scanViewer(pool.QueryRow(ctx,
		`SELECT `+viewerColumns+` FROM viewers WHERE lower(email) = lower($1)`, email))
}

func ViewerByID(ctx context.Context, pool *pgxpool.Pool, id int64) (Viewer, error) {
	return scanViewer(pool.QueryRow(ctx,
		`SELECT `+viewerColumns+` FROM viewers WHERE id = $1`, id))
}

func ListViewersPage(ctx context.Context, pool *pgxpool.Pool, page, limit int) ([]Viewer, int, error) {
	if page < 1 {
		page = 1
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	var total int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM viewers`).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := pool.Query(ctx,
		`SELECT `+viewerColumns+` FROM viewers ORDER BY id
		 LIMIT $1 OFFSET $2`, limit, (page-1)*limit)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	viewers := []Viewer{}
	for rows.Next() {
		v, err := scanViewer(rows)
		if err != nil {
			return nil, 0, err
		}
		viewers = append(viewers, v)
	}
	return viewers, total, rows.Err()
}

func CreateViewer(ctx context.Context, pool *pgxpool.Pool, email, nameSurname, hash string) (Viewer, error) {
	return scanViewer(pool.QueryRow(ctx, `
		INSERT INTO viewers (email, name_surname, password_hash)
		VALUES ($1, $2, $3) RETURNING `+viewerColumns,
		email, nameSurname, hash))
}

// UpdateViewer edits a viewer. Empty passwordHash keeps the current one.
func UpdateViewer(ctx context.Context, pool *pgxpool.Pool, id int64, email, nameSurname, hash string, disabled bool) (Viewer, error) {
	if hash == "" {
		return scanViewer(pool.QueryRow(ctx, `
			UPDATE viewers SET email = $1, name_surname = $2, disabled = $3, updated_at = now()
			WHERE id = $4 RETURNING `+viewerColumns, email, nameSurname, disabled, id))
	}
	return scanViewer(pool.QueryRow(ctx, `
		UPDATE viewers SET email = $1, name_surname = $2, password_hash = $3, disabled = $4, updated_at = now()
		WHERE id = $5 RETURNING `+viewerColumns, email, nameSurname, hash, disabled, id))
}

func DeleteViewer(ctx context.Context, pool *pgxpool.Pool, id int64) error {
	tag, err := pool.Exec(ctx, `DELETE FROM viewers WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ErrEmailTaken mirrors the users constraint message.
var ErrViewerEmailTaken = errors.New("db: viewer email taken")
