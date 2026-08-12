package db

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrNotFound = errors.New("db: not found")

func scanEntry(row pgx.Row) (Entry, error) {
	var e Entry
	err := row.Scan(
		&e.ID, &e.PublicID, &e.CategoryID, &e.UploadedBy,
		&e.Title, &e.Description, &e.Status, &e.DurationMS,
		&e.SourceKey, &e.SourceSize, &e.IsPublic,
		&e.AccessDenied,
		&e.DomainACLID,
		&e.PlayerID,
		&e.PosterKey, &e.PosterFrame, &e.SpriteKey, &e.SpriteFrames, &e.Error,
		&e.CreatedAt, &e.UpdatedAt,
	)
	return e, err
}

const entryColumns = `
	e.id, e.public_id::text, e.category_id, e.uploaded_by,
	e.title, e.description, e.status, e.duration_ms,
	coalesce(e.source_key, ''), e.source_size, e.is_public,
	e.access_denied,
	e.domain_acl_id,
	e.player_id,
	coalesce(e.poster_key, ''), coalesce(e.poster_frame, 0), coalesce(e.sprite_key, ''), coalesce(e.sprite_frames, 0), coalesce(e.error, ''),
	e.created_at, e.updated_at`

func EntryByID(ctx context.Context, pool *pgxpool.Pool, id int64) (Entry, error) {
	e, err := scanEntry(pool.QueryRow(ctx,
		`SELECT `+entryColumns+` FROM entries e WHERE e.id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return Entry{}, ErrNotFound
	}
	return e, err
}

// EntryByPublicID resolves the non-enumerable public uuid.
func EntryByPublicID(ctx context.Context, pool *pgxpool.Pool, publicID string) (Entry, error) {
	e, err := scanEntry(pool.QueryRow(ctx,
		`SELECT `+entryColumns+` FROM entries e WHERE e.public_id = $1`, publicID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Entry{}, ErrNotFound
	}
	return e, err
}

type EntryFilter struct {
	Q         string
	Status    string
	Category  int64
	Uploader  int64
	Page      int
	Limit     int
	ExcludeID int64 // used when fetching related entries
}

func (f *EntryFilter) Validate() {
	if f.Limit <= 0 || f.Limit > 100 {
		f.Limit = 20
	}
	if f.Page <= 0 {
		f.Page = 1
	}
}

type EntryList struct {
	Items []Entry `json:"items"`
	Total int     `json:"total"`
	// CatalogTotal is the unfiltered entry count, so the UI can tell an
	// empty catalog apart from "no results for the current filters".
	CatalogTotal int `json:"catalogTotal"`
	Page         int `json:"page"`
	Limit        int `json:"limit"`
}

func ListEntries(ctx context.Context, pool *pgxpool.Pool, f EntryFilter) (EntryList, error) {
	f.Validate()
	var conds []string
	var args []any
	add := func(cond string, arg any) {
		args = append(args, arg)
		conds = append(conds, fmt.Sprintf(cond, len(args)))
	}
	// qIdx tracks the argument index of the search term so the ORDER BY can
	// rank results by pg_trgm similarity when searching (index-assisted).
	qIdx := 0
	if f.Q != "" {
		add(`(e.title ILIKE '%%' || $%[1]d || '%%' OR e.description ILIKE '%%' || $%[1]d || '%%')`, f.Q)
		qIdx = len(args)
	}
	if f.Status != "" {
		add(`e.status = $%d`, f.Status)
	}
	if f.Category > 0 {
		add(`e.category_id = $%d`, f.Category)
	}
	if f.Uploader > 0 {
		add(`e.uploaded_by = $%d`, f.Uploader)
	}
	if f.ExcludeID > 0 {
		add(`e.id <> $%d`, f.ExcludeID)
	}
	where := ""
	if len(conds) > 0 {
		where = "WHERE " + strings.Join(conds, " AND ")
	}

	var total int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM entries e `+where, args...).Scan(&total); err != nil {
		return EntryList{}, err
	}
	var catalogTotal int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM entries`).Scan(&catalogTotal); err != nil {
		return EntryList{}, err
	}

	orderBy := "e.created_at DESC"
	if qIdx > 0 {
		orderBy = fmt.Sprintf(
			"greatest(coalesce(similarity(e.title, $%d), 0), coalesce(similarity(e.description, $%d), 0)) DESC, e.created_at DESC",
			qIdx, qIdx)
	}
	offset := (f.Page - 1) * f.Limit
	rows, err := pool.Query(ctx,
		`SELECT `+entryColumns+` FROM entries e `+where+`
		 ORDER BY `+orderBy+`
		 LIMIT $`+fmt.Sprintf("%d", len(args)+1)+` OFFSET $`+fmt.Sprintf("%d", len(args)+2),
		append(args, f.Limit, offset)...)
	if err != nil {
		return EntryList{}, err
	}
	defer rows.Close()
	items := []Entry{}
	for rows.Next() {
		e, err := scanEntry(rows)
		if err != nil {
			return EntryList{}, err
		}
		items = append(items, e)
	}
	if err := rows.Err(); err != nil {
		return EntryList{}, err
	}
	return EntryList{Items: items, Total: total, CatalogTotal: catalogTotal, Page: f.Page, Limit: f.Limit}, nil
}

// ListAllEntries returns every entry ordered by id (storage page, exports).
func ListAllEntries(ctx context.Context, pool *pgxpool.Pool) ([]Entry, error) {
	rows, err := pool.Query(ctx, `SELECT `+entryColumns+` FROM entries e ORDER BY e.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Entry{}
	for rows.Next() {
		e, err := scanEntry(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func UpdateEntry(ctx context.Context, pool *pgxpool.Pool, id int64, patch EntryPatch) (Entry, error) {
	if _, err := pool.Exec(ctx, `
		UPDATE entries SET title = $1, description = $2, category_id = $3, is_public = $4,
			domain_acl_id = $5, access_denied = COALESCE($6::boolean, access_denied),
			player_id = $7, updated_at = now()
		WHERE id = $8`,
		patch.Title, patch.Description, patch.CategoryID, patch.IsPublic, patch.DomainACLID,
		patch.AccessDenied, patch.PlayerID, id); err != nil {
		return Entry{}, err
	}
	return EntryByID(ctx, pool, id)
}

type EntryPatch struct {
	Title       string   `json:"title"`
	Description string   `json:"description"`
	CategoryID  *int64   `json:"categoryId"`
	IsPublic    bool     `json:"isPublic"`
	// DomainACLID is the named embed ACL; nil = "Allow All".
	DomainACLID *int64   `json:"domainAclId"`
	// PlayerID is the assigned player design; nil = the Default player.
	PlayerID *int64 `json:"playerId"`
	// AccessDenied hides the entry from all viewers (editors/admins can
	// still manage it). Omit to leave access untouched.
	AccessDenied *bool `json:"accessDenied"`
	// FlavorIDs, when present, replaces the ticked flavor set and re-queues
	// processing (reprocess path). Omit to leave flavors untouched.
	FlavorIDs *[]int64 `json:"flavorIds"`
	// PosterFrame, when present, re-extracts the poster from this sprite frame.
	PosterFrame *int `json:"posterFrame"`
}

func DeleteEntry(ctx context.Context, pool *pgxpool.Pool, id int64) error {
	tag, err := pool.Exec(ctx, `DELETE FROM entries WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// SetEntryError marks an entry failed with a human-readable error.
func SetEntryError(ctx context.Context, pool *pgxpool.Pool, id int64, status EntryStatus, errMsg string) error {
	_, err := pool.Exec(ctx, `
		UPDATE entries SET status = $1, error = $2, updated_at = now() WHERE id = $3`,
		status, errMsg, id)
	return err
}

// EntryFlavors returns the current flavor state for an entry.
func EntryFlavors(ctx context.Context, pool *pgxpool.Pool, entryID int64) ([]EntryFlavor, error) {
	rows, err := pool.Query(ctx, `
		SELECT entry_id, flavor_id, status, coalesce(error, ''), coalesce(playlist_key, '')
		FROM entry_flavors WHERE entry_id = $1 ORDER BY flavor_id`, entryID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []EntryFlavor{}
	for rows.Next() {
		var ef EntryFlavor
		if err := rows.Scan(&ef.EntryID, &ef.FlavorID, &ef.Status, &ef.Error, &ef.PlaylistKey); err != nil {
			return nil, err
		}
		out = append(out, ef)
	}
	return out, rows.Err()
}

// SetEntryFlavors replaces the ticked flavor set for an entry (reprocess path).
func SetEntryFlavors(ctx context.Context, pool *pgxpool.Pool, entryID int64, flavorIDs []int64) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `DELETE FROM entry_flavors WHERE entry_id = $1`, entryID); err != nil {
		return err
	}
	for _, fid := range flavorIDs {
		if _, err := tx.Exec(ctx, `
			INSERT INTO entry_flavors (entry_id, flavor_id, status) VALUES ($1, $2, 'pending')
			ON CONFLICT (entry_id, flavor_id) DO NOTHING`, entryID, fid); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func ListSubtitles(ctx context.Context, pool *pgxpool.Pool, entryID int64) ([]Subtitle, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, lang, label, vtt_key FROM subtitles WHERE entry_id = $1 ORDER BY id`, entryID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Subtitle{}
	for rows.Next() {
		var s Subtitle
		if err := rows.Scan(&s.ID, &s.Lang, &s.Label, &s.VTTKey); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func AddSubtitle(ctx context.Context, pool *pgxpool.Pool, entryID int64, lang, label, vttKey string) (Subtitle, error) {
	var s Subtitle
	err := pool.QueryRow(ctx, `
		INSERT INTO subtitles (entry_id, lang, label, vtt_key)
		VALUES ($1, $2, $3, $4)
		RETURNING id, lang, label, vtt_key`, entryID, lang, label, vttKey).
		Scan(&s.ID, &s.Lang, &s.Label, &s.VTTKey)
	return s, err
}

func DeleteSubtitle(ctx context.Context, pool *pgxpool.Pool, entryID, subID int64) error {
	tag, err := pool.Exec(ctx, `DELETE FROM subtitles WHERE entry_id = $1 AND id = $2`, entryID, subID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
