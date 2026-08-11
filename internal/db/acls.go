package db

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DomainACL is a named embed restriction: whitelist (allowed domains) and
// blocklist (denied domains). Blocklist wins over whitelist at evaluation.
type DomainACL struct {
	ID        int64     `json:"id"`
	Title     string    `json:"title"`
	Whitelist []string  `json:"whitelist"`
	Blocklist []string  `json:"blocklist"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

const aclColumns = `id, title, whitelist, blocklist, created_at, updated_at`

func scanACL(row pgx.Row) (DomainACL, error) {
	var a DomainACL
	err := row.Scan(&a.ID, &a.Title, &a.Whitelist, &a.Blocklist, &a.CreatedAt, &a.UpdatedAt)
	return a, err
}

func ListACLs(ctx context.Context, pool *pgxpool.Pool) ([]DomainACL, error) {
	rows, err := pool.Query(ctx, `SELECT `+aclColumns+` FROM domain_acls ORDER BY title`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []DomainACL{}
	for rows.Next() {
		a, err := scanACL(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func ACLByID(ctx context.Context, pool *pgxpool.Pool, id int64) (DomainACL, error) {
	a, err := scanACL(pool.QueryRow(ctx, `SELECT `+aclColumns+` FROM domain_acls WHERE id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return DomainACL{}, ErrNotFound
	}
	return a, err
}

func CreateACL(ctx context.Context, pool *pgxpool.Pool, title string, whitelist, blocklist []string) (DomainACL, error) {
	a, err := scanACL(pool.QueryRow(ctx, `
		INSERT INTO domain_acls (title, whitelist, blocklist)
		VALUES ($1, $2, $3)
		RETURNING `+aclColumns, title, whitelist, blocklist))
	return a, err
}

func UpdateACL(ctx context.Context, pool *pgxpool.Pool, id int64, title string, whitelist, blocklist []string) (DomainACL, error) {
	a, err := scanACL(pool.QueryRow(ctx, `
		UPDATE domain_acls SET title = $1, whitelist = $2, blocklist = $3, updated_at = now()
		WHERE id = $4
		RETURNING `+aclColumns, title, whitelist, blocklist, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return DomainACL{}, ErrNotFound
	}
	return a, err
}

func DeleteACL(ctx context.Context, pool *pgxpool.Pool, id int64) error {
	tag, err := pool.Exec(ctx, `DELETE FROM domain_acls WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
