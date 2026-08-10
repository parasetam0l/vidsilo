package db

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func scanCategory(row pgx.Row) (Category, error) {
	var c Category
	err := row.Scan(&c.ID, &c.ParentID, &c.Name, &c.Slug, &c.Position)
	return c, err
}

func ListCategories(ctx context.Context, pool *pgxpool.Pool) ([]Category, error) {
	rows, err := pool.Query(ctx, `SELECT id, parent_id, name, slug, position FROM categories ORDER BY position, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Category{}
	for rows.Next() {
		c, err := scanCategory(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// CategoryTree returns categories as a nested tree.
func CategoryTree(ctx context.Context, pool *pgxpool.Pool) ([]Category, error) {
	flat, err := ListCategories(ctx, pool)
	if err != nil {
		return nil, err
	}
	byID := map[int64]*Category{}
	for i := range flat {
		byID[flat[i].ID] = &flat[i]
	}
	roots := []Category{}
	for i := range flat {
		c := &flat[i]
		if c.ParentID != nil {
			if p, ok := byID[*c.ParentID]; ok {
				p.Children = append(p.Children, *c)
				continue
			}
		}
		roots = append(roots, *c)
	}
	return roots, nil
}

func CreateCategory(ctx context.Context, pool *pgxpool.Pool, parentID *int64, name string, position int) (Category, error) {
	var c Category
	slug := slugify(name)
	err := pool.QueryRow(ctx, `
		INSERT INTO categories (parent_id, name, slug, position)
		VALUES ($1, $2, $3, $4)
		RETURNING id, parent_id, name, slug, position`,
		parentID, name, slug, position).
		Scan(&c.ID, &c.ParentID, &c.Name, &c.Slug, &c.Position)
	return c, err
}

func UpdateCategory(ctx context.Context, pool *pgxpool.Pool, id int64, parentID *int64, name string, position int) (Category, error) {
	if parentID != nil && *parentID == id {
		return Category{}, errors.New("category cannot be its own parent")
	}
	var c Category
	err := pool.QueryRow(ctx, `
		UPDATE categories SET parent_id = $1, name = $2, slug = $3, position = $4
		WHERE id = $5
		RETURNING id, parent_id, name, slug, position`,
		parentID, name, slugify(name), position, id).
		Scan(&c.ID, &c.ParentID, &c.Name, &c.Slug, &c.Position)
	if errors.Is(err, pgx.ErrNoRows) {
		return Category{}, ErrNotFound
	}
	return c, err
}

func DeleteCategory(ctx context.Context, pool *pgxpool.Pool, id int64) error {
	tag, err := pool.Exec(ctx, `DELETE FROM categories WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func slugify(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
		default:
			b.WriteByte('-')
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		return "category"
	}
	return out
}
