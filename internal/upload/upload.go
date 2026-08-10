// Package upload wires tusd to the VOD catalog + storage. Uploads spool to
// local disk (always resumable, driver-independent), then stream into the
// media store on completion — a zero-copy rename for the local driver, one
// PUT for s3. Completion flips the entry into the probe pipeline.
package upload

import (
	"context"
	cryptorand "crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tus/tusd/v2/pkg/handler"

	"github.com/parasetam0l/vod-app/internal/queue"
	"github.com/parasetam0l/vod-app/internal/settings"
	"github.com/parasetam0l/vod-app/internal/store"
)

// CtxUserID is set by the API layer on requests entering the tus handler.
type ctxKey string

const CtxUserID ctxKey = "vod-uploader-id"

// newUploadID generates the tus upload resource id.
func newUploadID() string {
	b := make([]byte, 16)
	if _, err := cryptorand.Read(b); err != nil {
		panic(err) // crypto/rand failure is unrecoverable
	}
	return hex.EncodeToString(b)
}

// DataStore implements tusd's core store: upload metadata in Postgres, chunks
// spooled to local disk, final blob in the media store.
type DataStore struct {
	Pool     *pgxpool.Pool
	Store    store.Store
	Queue    *queue.Queue
	Settings *settings.Service
	Log      *slog.Logger
	SpoolDir string
}

type uploadMeta struct {
	EntryID int64
	Size    int64
	Ext     string
	Meta    map[string]string
}

func (ds *DataStore) NewUpload(ctx context.Context, info handler.FileInfo) (handler.Upload, error) {
	ext := strings.ToLower(strings.TrimSpace(strings.TrimPrefix(info.MetaData["filename"], ".")))
	ext = strings.TrimPrefix(path.Ext("."+ext), ".")
	if ext == "" {
		return nil, errors.New("filename metadata with a file extension is required")
	}
	allowed := ds.Settings.StringSlice("upload.allowed_extensions", []string{"mp4", "mov", "mkv", "webm", "m4v", "avi"})
	if !contains(allowed, ext) {
		return nil, fmt.Errorf("file extension .%s is not allowed (allowed: %s)", ext, strings.Join(allowed, ", "))
	}
	if max := ds.Settings.Int64("upload.max_size_bytes", 8<<30); info.Size > max {
		return nil, fmt.Errorf("file exceeds the configured max upload size")
	}

	userID := int64(0)
	if v, ok := ctx.Value(CtxUserID).(int64); ok {
		userID = v
	}
	catID := parseCategoryID(info.MetaData["category"])
	var cat *int64
	if catID > 0 {
		cat = &catID
	}

	var entryID int64
	err := ds.Pool.QueryRow(ctx, `
		INSERT INTO entries (title, description, category_id, uploaded_by, status)
		VALUES ($1, $2, $3, $4, 'uploading')
		RETURNING id`, info.MetaData["title"], info.MetaData["description"], cat, userID).Scan(&entryID)
	if err != nil {
		return nil, err
	}
	id := newUploadID()
	meta, err := json.Marshal(uploadMeta{EntryID: entryID, Size: info.Size, Ext: ext, Meta: info.MetaData})
	if err != nil {
		return nil, err
	}
	if _, err := ds.Pool.Exec(ctx, `
		INSERT INTO uploads (upload_id, entry_id, meta) VALUES ($1, $2, $3::jsonb)`,
		id, entryID, meta); err != nil {
		return nil, err
	}
	ds.Log.Info("upload started", "upload", id, "entry", entryID, "title", info.MetaData["title"], "size", info.Size)
	return &Upload{ds: ds, id: id, meta: uploadMeta{EntryID: entryID, Size: info.Size, Ext: ext, Meta: info.MetaData}}, nil
}

func (ds *DataStore) GetUpload(ctx context.Context, id string) (handler.Upload, error) {
	var raw []byte
	err := ds.Pool.QueryRow(ctx,
		`SELECT meta FROM uploads WHERE upload_id = $1`, id).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, handler.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	var m uploadMeta
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, err
	}
	return &Upload{ds: ds, id: id, meta: m}, nil
}

func (ds *DataStore) AsTerminatableUpload(upload handler.Upload) handler.TerminatableUpload {
	return upload.(*Upload)
}

// spoolPath is the local file backing a tus upload.
func (ds *DataStore) spoolPath(id string) string {
	return filepath.Join(ds.SpoolDir, id)
}

func contains(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}

func parseCategoryID(s string) int64 {
	if s == "" {
		return 0
	}
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return 0
	}
	return n
}

// Upload is a single tus upload resource backed by a spool file.
type Upload struct {
	ds   *DataStore
	id   string
	meta uploadMeta
}

func (u *Upload) WriteChunk(ctx context.Context, offset int64, src io.Reader) (int64, error) {
	p := u.ds.spoolPath(u.id)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return 0, err
	}
	f, err := os.OpenFile(p, os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return 0, err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return 0, err
	}
	if st.Size() != offset {
		return 0, handler.ErrMismatchOffset
	}
	if _, err := f.Seek(offset, io.SeekStart); err != nil {
		return 0, err
	}
	n, err := io.Copy(f, src)
	if err != nil {
		return 0, err
	}
	return n, nil
}

func (u *Upload) GetInfo(ctx context.Context) (handler.FileInfo, error) {
	offset := int64(0)
	if st, err := os.Stat(u.ds.spoolPath(u.id)); err == nil {
		offset = st.Size()
	}
	return handler.FileInfo{
		ID:            u.id,
		Size:          u.meta.Size,
		SizeIsDeferred: false,
		Offset:        offset,
		MetaData:      u.meta.Meta,
	}, nil
}

func (u *Upload) WriteInfo(ctx context.Context, info handler.FileInfo) error {
	u.meta.Size = info.Size
	u.meta.Meta = info.MetaData
	raw, err := json.Marshal(u.meta)
	if err != nil {
		return err
	}
	_, err = u.ds.Pool.Exec(ctx,
		`UPDATE uploads SET meta = $2::jsonb WHERE upload_id = $1`, u.id, raw)
	return err
}

func (u *Upload) GetReader(ctx context.Context) (io.ReadCloser, error) {
	return os.Open(u.ds.spoolPath(u.id))
}

// FinishUpload streams the spool into the media store at the final key
// (rename for the local driver) and enqueues the probe job.
func (u *Upload) FinishUpload(ctx context.Context) error {
	spool := u.ds.spoolPath(u.id)
	st, err := os.Stat(spool)
	if err != nil {
		return err
	}
	key := store.OriginalKey(u.meta.EntryID, u.meta.Ext)

	if local, ok := u.ds.Store.(*store.Local); ok {
		// Zero-copy: move the file into the store tree.
		if err := local.MoveIn(key, spool); err != nil {
			return err
		}
	} else {
		f, err := os.Open(spool)
		if err != nil {
			return err
		}
		err = u.ds.Store.Put(ctx, key, f, st.Size())
		f.Close()
		if err != nil {
			return err
		}
		os.Remove(spool)
	}

	if _, err := u.ds.Pool.Exec(ctx, `
		UPDATE entries SET status = 'probing', source_key = $1, source_size = $2, updated_at = now()
		WHERE id = $3`, key, st.Size(), u.meta.EntryID); err != nil {
		return err
	}
	if _, err := u.ds.Queue.Enqueue(ctx, "probe", u.meta.EntryID, map[string]any{}, 3); err != nil {
		return err
	}
	if _, err := u.ds.Pool.Exec(ctx, `DELETE FROM uploads WHERE upload_id = $1`, u.id); err != nil {
		u.ds.Log.Warn("upload row cleanup", "err", err)
	}
	u.ds.Log.Info("upload finished, probe queued", "entry", u.meta.EntryID, "bytes", st.Size())
	return nil
}

func (u *Upload) Terminate(ctx context.Context) error {
	os.Remove(u.ds.spoolPath(u.id))
	_, _ = u.ds.Pool.Exec(ctx, `DELETE FROM uploads WHERE upload_id = $1`, u.id)
	_, _ = u.ds.Pool.Exec(ctx, `DELETE FROM entries WHERE id = $1 AND status = 'uploading'`, u.meta.EntryID)
	return nil
}

var _ handler.Upload = (*Upload)(nil)
var _ handler.TerminatableUpload = (*Upload)(nil)
