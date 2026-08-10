package db

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrEmailTaken = errors.New("db: email taken")

const userColumns = "id, email, name, surname, password_hash, role, disabled, created_at"

func scanUser(row pgx.Row) (User, error) {
	var u User
	err := row.Scan(&u.ID, &u.Email, &u.Name, &u.Surname, &u.PasswordHash,
		&u.Role, &u.Disabled, &u.CreatedAt)
	return u, err
}

// UserByEmail looks up a user case-insensitively.
func UserByEmail(ctx context.Context, pool *pgxpool.Pool, email string) (User, error) {
	return scanUser(pool.QueryRow(ctx,
		`SELECT `+userColumns+` FROM users WHERE lower(email) = lower($1)`, email))
}

func UserByID(ctx context.Context, pool *pgxpool.Pool, id int64) (User, error) {
	return scanUser(pool.QueryRow(ctx,
		`SELECT `+userColumns+` FROM users WHERE id = $1`, id))
}

// UpdateUserPassword stores a fresh hash (argon2id upgrade path).
func UpdateUserPassword(ctx context.Context, pool *pgxpool.Pool, id int64, hash string) error {
	_, err := pool.Exec(ctx, `UPDATE users SET password_hash = $1 WHERE id = $2`, hash, id)
	return err
}

func ListUsers(ctx context.Context, pool *pgxpool.Pool) ([]User, error) {
	rows, err := pool.Query(ctx,
		`SELECT `+userColumns+` FROM users ORDER BY id`)
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

func CreateUser(ctx context.Context, pool *pgxpool.Pool, email, name, surname, hash string, role Role) (User, error) {
	var u User
	err := pool.QueryRow(ctx, `
		INSERT INTO users (email, name, surname, password_hash, role)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING `+userColumns,
		email, name, surname, hash, role).Scan(
		&u.ID, &u.Email, &u.Name, &u.Surname, &u.PasswordHash,
		&u.Role, &u.Disabled, &u.CreatedAt)
	if isUniqueViolation(err) {
		return User{}, ErrEmailTaken
	}
	return u, err
}

func UpdateUser(ctx context.Context, pool *pgxpool.Pool, id int64, email, name, surname string, role Role, disabled bool) error {
	_, err := pool.Exec(ctx, `
		UPDATE users SET email = $1, name = $2, surname = $3, role = $4, disabled = $5
		WHERE id = $6`, email, name, surname, role, disabled, id)
	if isUniqueViolation(err) {
		return ErrEmailTaken
	}
	return err
}

func DeleteUser(ctx context.Context, pool *pgxpool.Pool, id int64) error {
	_, err := pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, id)
	return err
}

func isUniqueViolation(err error) bool {
	return err != nil && strings.Contains(fmt.Sprintf("%v", err), "duplicate key")
}
