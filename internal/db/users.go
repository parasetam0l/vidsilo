package db

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrUsernameTaken = errors.New("db: username taken")

func scanUser(row pgx.Row) (User, error) {
	var u User
	err := row.Scan(&u.ID, &u.Username, &u.PasswordHash, &u.Role, &u.Disabled, &u.CreatedAt)
	return u, err
}

// UserByUsername looks up a user case-insensitively.
func UserByUsername(ctx context.Context, pool *pgxpool.Pool, username string) (User, error) {
	return scanUser(pool.QueryRow(ctx, `
		SELECT id, username, password_hash, role, disabled, created_at
		FROM users WHERE lower(username) = lower($1)`, username))
}

func UserByID(ctx context.Context, pool *pgxpool.Pool, id int64) (User, error) {
	return scanUser(pool.QueryRow(ctx, `
		SELECT id, username, password_hash, role, disabled, created_at
		FROM users WHERE id = $1`, id))
}

// UpdateUserPassword stores a fresh hash (argon2id upgrade path).
func UpdateUserPassword(ctx context.Context, pool *pgxpool.Pool, id int64, hash string) error {
	_, err := pool.Exec(ctx, `UPDATE users SET password_hash = $1 WHERE id = $2`, hash, id)
	return err
}

func ListUsers(ctx context.Context, pool *pgxpool.Pool) ([]User, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, username, password_hash, role, disabled, created_at
		FROM users ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	users := []User{}
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, rows.Err()
}

func CreateUser(ctx context.Context, pool *pgxpool.Pool, username, hash string, role Role) (User, error) {
	var u User
	err := pool.QueryRow(ctx, `
		INSERT INTO users (username, password_hash, role)
		VALUES ($1, $2, $3)
		RETURNING id, username, password_hash, role, disabled, created_at`,
		username, hash, role).Scan(&u.ID, &u.Username, &u.PasswordHash, &u.Role, &u.Disabled, &u.CreatedAt)
	if isUniqueViolation(err) {
		return User{}, ErrUsernameTaken
	}
	return u, err
}

func UpdateUser(ctx context.Context, pool *pgxpool.Pool, id int64, role Role, disabled bool) error {
	_, err := pool.Exec(ctx,
		`UPDATE users SET role = $1, disabled = $2 WHERE id = $3`, role, disabled, id)
	return err
}

func DeleteUser(ctx context.Context, pool *pgxpool.Pool, id int64) error {
	_, err := pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, id)
	return err
}

func isUniqueViolation(err error) bool {
	return err != nil && strings.Contains(fmt.Sprintf("%v", err), "duplicate key")
}
