// Package jobs implements the pipeline job handlers: probe and transcode.
package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/parasetam0l/vod-app/internal/db"
	"github.com/parasetam0l/vod-app/internal/media"
	"github.com/parasetam0l/vod-app/internal/queue"
	"github.com/parasetam0l/vod-app/internal/settings"
	"github.com/parasetam0l/vod-app/internal/store"
)

type Runner struct {
	Pool     *pgxpool.Pool
	Store    store.Store
	Queue    *queue.Queue
	Settings *settings.Service
	Log      *slog.Logger
}

// Handle dispatches a claimed job to its handler.
func (r *Runner) Handle(ctx context.Context, job db.Job) error {
	switch job.Type {
	case "probe":
		return r.Probe(ctx, job)
	case "transcode":
		return r.Transcode(ctx, job)
	default:
		return fmt.Errorf("unknown job type %q", job.Type)
	}
}

func (r *Runner) media() *media.Manager {
	return &media.Manager{Store: r.Store}
}

// spoolSource downloads the entry's source file to local disk.
func (r *Runner) spoolSource(ctx context.Context, e db.Entry) (string, error) {
	if e.SourceKey == "" {
		return "", errors.New("entry has no source media")
	}
	rc, err := r.Store.Open(ctx, e.SourceKey)
	if err != nil {
		return "", err
	}
	defer rc.Close()
	tmp, err := os.CreateTemp("", "vod-source-*"+path.Ext(e.SourceKey))
	if err != nil {
		return "", err
	}
	if _, err := ioCopy(tmp, rc); err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		return "", err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmp.Name())
		return "", err
	}
	return tmp.Name(), nil
}

// transcodeParams is the transcode job payload.
type transcodeParams struct {
	FlavorIDs []int64 `json:"flavorIds"`
}

// Probe probes the source, extracts poster + sprite, ticks flavors, and
// enqueues the transcode job.
func (r *Runner) Probe(ctx context.Context, job db.Job) error {
	if job.EntryID == nil {
		return errors.New("probe job without entry")
	}
	e, err := db.EntryByID(ctx, r.Pool, *job.EntryID)
	if err != nil {
		return err
	}
	if e.SourceKey == "" {
		return errors.New("entry has no source media")
	}

	src, err := r.spoolSource(ctx, e)
	if err != nil {
		return err
	}
	defer os.Remove(src)

	res, err := media.Probe(ctx, src)
	if err != nil {
		r.failEntry(ctx, e, "probe failed: "+err.Error())
		return err
	}

	// Poster at 10% + sprite sheet.
	atMs := res.DurationMs / 10
	if atMs < 0 {
		atMs = 0
	}
	m := r.media()
	if err := m.ExtractPosterFromSource(ctx, e.ID, src, atMs); err != nil {
		r.Log.Warn("poster extraction", "err", err)
	} else {
		_, _ = r.Pool.Exec(ctx, `UPDATE entries SET poster_key = $1 WHERE id = $2`,
			store.PosterKey(e.ID), e.ID)
	}
	frames, err := m.SpriteGrid(ctx, e.ID, src, res.DurationMs)
	if err != nil {
		r.Log.Warn("sprite generation", "err", err)
	} else {
		_, _ = r.Pool.Exec(ctx, `UPDATE entries SET sprite_key = $1, sprite_frames = $2 WHERE id = $3`,
			store.SpriteKey(e.ID), frames, e.ID)
	}

	// Effective flavors: enabled ∩ ticked ∩ (height <= source height).
	enabled, err := db.EnabledFlavors(ctx, r.Pool)
	if err != nil {
		return err
	}
	ticked, err := db.EntryFlavors(ctx, r.Pool, e.ID)
	if err != nil {
		return err
	}
	tickedSet := map[int64]bool{}
	for _, ef := range ticked {
		tickedSet[ef.FlavorID] = true
	}
	useTicked := len(tickedSet) > 0

	var pending []int64
	for _, f := range enabled {
		if useTicked && !tickedSet[f.ID] {
			continue
		}
		if f.Height > res.Height {
			_, _ = r.Pool.Exec(ctx, `
				INSERT INTO entry_flavors (entry_id, flavor_id, status, error)
				VALUES ($1, $2, 'skipped', 'source is shorter than flavor height')
				ON CONFLICT (entry_id, flavor_id) DO UPDATE SET status = 'skipped', error = EXCLUDED.error, updated_at = now()`,
				e.ID, f.ID)
			continue
		}
		_, _ = r.Pool.Exec(ctx, `
			INSERT INTO entry_flavors (entry_id, flavor_id, status)
			VALUES ($1, $2, 'pending')
			ON CONFLICT (entry_id, flavor_id) DO UPDATE SET status = 'pending', error = NULL, updated_at = now()`,
			e.ID, f.ID)
		pending = append(pending, f.ID)
	}

	if len(pending) == 0 {
		// Nothing to transcode: publish the source directly.
		_ = r.publishSourcePlaylist(ctx, e)
		_, _ = r.Pool.Exec(ctx, `UPDATE entries SET status = 'ready', duration_ms = $1, error = NULL, updated_at = now() WHERE id = $2`,
			res.DurationMs, e.ID)
		return nil
	}

	_, err = r.Pool.Exec(ctx, `
		UPDATE entries SET status = 'transcoding', duration_ms = $1, error = NULL, updated_at = now() WHERE id = $2`,
		res.DurationMs, e.ID)
	if err != nil {
		return err
	}
	_, err = r.Queue.Enqueue(ctx, "transcode", e.ID, transcodeParams{FlavorIDs: pending}, 3)
	return err
}

// publishSourcePlaylist writes a master pointing at the source file so the
// entry is playable without transcoding.
func (r *Runner) publishSourcePlaylist(ctx context.Context, e db.Entry) error {
	subs, err := db.ListSubtitles(ctx, r.Pool, e.ID)
	if err != nil {
		return err
	}
	var renditions []media.Rendition
	if e.SourceKey != "" {
		renditions = append(renditions, media.Rendition{Name: "source", Height: 0, PlaylistKey: "/media/" + strings.TrimPrefix(e.SourceKey, "/")})
	}
	var subRends []media.SubtitleRendition
	for _, s := range subs {
		subRends = append(subRends, media.SubtitleRendition{Lang: s.Lang, Label: s.Label, URI: "/media/" + strings.TrimPrefix(s.VTTKey, "/")})
	}
	var b strings.Builder
	if err := media.BuildMasterPlaylist(&b, renditions, subRends); err != nil {
		return err
	}
	return r.Store.Put(ctx, store.MasterKey(e.ID), strings.NewReader(b.String()), int64(b.Len()))
}

// Transcode encodes each pending flavor and assembles the master playlist.
func (r *Runner) Transcode(ctx context.Context, job db.Job) error {
	if job.EntryID == nil {
		return errors.New("transcode job without entry")
	}
	var params transcodeParams
	if err := json.Unmarshal(job.Payload, &params); err != nil {
		return err
	}
	e, err := db.EntryByID(ctx, r.Pool, *job.EntryID)
	if err != nil {
		return err
	}
	src, err := r.spoolSource(ctx, e)
	if err != nil {
		r.failEntry(ctx, e, "transcode failed: "+err.Error())
		return err
	}
	defer os.Remove(src)

	segmentSecs := r.Settings.Int("transcode.segment_seconds", 4)
	gopSecs := r.Settings.Int("transcode.gop_seconds", 2)
	preset := r.Settings.String("transcode.preset", "veryfast")

	done := 0
	for _, flavorID := range params.FlavorIDs {
		f, err := db.FlavorByID(ctx, r.Pool, flavorID)
		if err != nil {
			r.markFlavor(ctx, e.ID, flavorID, db.FlavorFailed, err.Error())
			continue
		}
		r.Log.Info("transcoding flavor", "entry", e.ID, "flavor", f.Name)

		flavor := media.Flavor{
			Name: f.Name, Codec: f.Codec, Height: f.Height,
			VideoMode: f.VideoMode, CRF: orZero(f.CRF), VideoBitrate: orZeroI(f.VideoBitrate),
			AudioBitrate: f.AudioBitrate, Preset: preset,
			SegmentSecs: segmentSecs, GopSecs: gopSecs,
		}

		outDir, cleanup, err := r.flavorOutputDir(ctx, e, f)
		if err != nil {
			r.markFlavor(ctx, e.ID, flavorID, db.FlavorFailed, err.Error())
			continue
		}
		err = media.TranscodeFlavor(ctx, src, outDir, flavor, nil)
		if err != nil {
			cleanup()
			r.markFlavor(ctx, e.ID, flavorID, db.FlavorFailed, err.Error())
			continue
		}
		playlistKey, err := r.publishFlavor(ctx, e, f, outDir, cleanup)
		if err != nil {
			cleanup()
			r.markFlavor(ctx, e.ID, flavorID, db.FlavorFailed, err.Error())
			continue
		}
		r.markFlavorDone(ctx, e.ID, flavorID, playlistKey)
		done++
	}

	if done == 0 {
		r.failEntry(ctx, e, "all flavors failed")
		return errors.New("all flavors failed")
	}
	if err := r.buildMaster(ctx, e); err != nil {
		return err
	}
	_, err = r.Pool.Exec(ctx, `
		UPDATE entries SET status = 'ready', error = NULL, updated_at = now() WHERE id = $1`, e.ID)
	return err
}

// flavorOutputDir returns where ffmpeg writes. For the local driver the
// output lands directly in the store tree (no copy); otherwise a temp dir
// that is uploaded by publishFlavor.
func (r *Runner) flavorOutputDir(ctx context.Context, e db.Entry, f db.Flavor) (string, func(), error) {
	if local, ok := r.Store.(*store.Local); ok {
		dir := local.Root() + "/" + store.FlavorDir(e.ID, f.Name)
		return dir, func() { _ = os.RemoveAll(dir) }, nil
	}
	dir, err := os.MkdirTemp("", "vod-flavor-*")
	if err != nil {
		return "", nil, err
	}
	return dir, func() { _ = os.RemoveAll(dir) }, nil
}

// publishFlavor uploads the HLS output; returns the flavor playlist key.
func (r *Runner) publishFlavor(ctx context.Context, e db.Entry, f db.Flavor, dir string, cleanup func()) (string, error) {
	playlistKey := store.FlavorPlaylistKey(e.ID, f.Name)
	if _, ok := r.Store.(*store.Local); ok {
		// Already written into the store tree by ffmpeg.
		return playlistKey, nil
	}
	var files []string
	_ = filepath.Walk(dir, func(p string, info os.FileInfo, err error) error {
		if err == nil && !info.IsDir() {
			files = append(files, p)
		}
		return nil
	})
	for _, p := range files {
		fi, err := os.Stat(p)
		if err != nil {
			return "", err
		}
		rel, err := filepath.Rel(dir, p)
		if err != nil {
			return "", err
		}
		key := store.FlavorSegmentKey(e.ID, f.Name, filepath.ToSlash(rel))
		fh, err := os.Open(p)
		if err != nil {
			return "", err
		}
		err = r.Store.Put(ctx, key, fh, fi.Size())
		fh.Close()
		if err != nil {
			return "", err
		}
	}
	return playlistKey, nil
}

// buildMaster assembles master.m3u8 from done flavors + subtitles.
func (r *Runner) buildMaster(ctx context.Context, e db.Entry) error {
	flavors, err := db.EntryFlavors(ctx, r.Pool, e.ID)
	if err != nil {
		return err
	}
	subs, err := db.ListSubtitles(ctx, r.Pool, e.ID)
	if err != nil {
		return err
	}
	var renditions []media.Rendition
	for _, ef := range flavors {
		if ef.Status != db.FlavorDone {
			continue
		}
		f, err := db.FlavorByID(ctx, r.Pool, ef.FlavorID)
		if err != nil {
			continue
		}
		renditions = append(renditions, media.Rendition{
			Name:        f.Name,
			Height:      f.Height,
			Bitrate:     orZeroI(f.VideoBitrate),
			PlaylistKey: "/media/" + strings.TrimPrefix(ef.PlaylistKey, "/"),
		})
	}
	var subRends []media.SubtitleRendition
	for _, s := range subs {
		subRends = append(subRends, media.SubtitleRendition{Lang: s.Lang, Label: s.Label, URI: "/media/" + strings.TrimPrefix(s.VTTKey, "/")})
	}
	var b strings.Builder
	if err := media.BuildMasterPlaylist(&b, renditions, subRends); err != nil {
		return err
	}
	return r.Store.Put(ctx, store.MasterKey(e.ID), strings.NewReader(b.String()), int64(b.Len()))
}

func (r *Runner) failEntry(ctx context.Context, e db.Entry, msg string) {
	r.Log.Error(msg, "entry", e.ID)
	_ = db.SetEntryError(ctx, r.Pool, e.ID, db.StatusFailed, msg)
}

func (r *Runner) markFlavor(ctx context.Context, entryID, flavorID int64, status db.EntryFlavorStatus, errMsg string) {
	_, _ = r.Pool.Exec(ctx, `
		UPDATE entry_flavors SET status = $1, error = $2, updated_at = now()
		WHERE entry_id = $3 AND flavor_id = $4`, status, errMsg, entryID, flavorID)
}

func (r *Runner) markFlavorDone(ctx context.Context, entryID, flavorID int64, playlistKey string) {
	_, _ = r.Pool.Exec(ctx, `
		UPDATE entry_flavors SET status = 'done', error = NULL, playlist_key = $1, updated_at = now()
		WHERE entry_id = $2 AND flavor_id = $3`, playlistKey, entryID, flavorID)
}

func orZero(f *float64) float64 {
	if f == nil {
		return 23
	}
	return *f
}

func orZeroI(v *int) int {
	if v == nil {
		return 0
	}
	return *v
}

func ioCopy(dst io.Writer, src io.Reader) (int64, error) {
	return io.Copy(dst, src)
}
