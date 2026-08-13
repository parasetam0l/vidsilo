// Package jobs implements the pipeline job handlers: probe, transcode and
// URL-import download.
package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/parasetam0l/vidsilo/internal/db"
	"github.com/parasetam0l/vidsilo/internal/media"
	"github.com/parasetam0l/vidsilo/internal/queue"
	"github.com/parasetam0l/vidsilo/internal/safeurl"
	"github.com/parasetam0l/vidsilo/internal/settings"
	"github.com/parasetam0l/vidsilo/internal/store"
)

type Runner struct {
	Pool     *pgxpool.Pool
	Store    store.Store
	Queue    *queue.Queue
	Settings *settings.Service
	Log      *slog.Logger

	// downloadSem serializes URL downloads (one at a time) within this
	// worker process.
	downloadSem chan struct{}
	// transcodeSems serializes flavor transcodes PER ENTRY: flavors of the
	// same entry run one at a time, different entries run in parallel.
	transcodeMu   sync.Mutex
	transcodeSems map[int64]*entrySem
	// SpoolDir caches one downloaded source copy per entry across the whole
	// pipeline (probe + every flavor). Defaults to os.TempDir().
	SpoolDir string
	spoolMu    sync.Mutex
	spoolCache map[int64]spoolEntry
	// Busy flags mirror the semaphores so the claim loop can leave queued
	// jobs of a busy kind alone (they then honestly show as "queued").
	downloadBusy atomic.Bool
}

type entrySem struct {
	ch     chan struct{}
	active int
}

// EnsureDownloadSem lazily creates the download semaphore.
func (r *Runner) EnsureDownloadSem() {
	if r.downloadSem == nil {
		r.downloadSem = make(chan struct{}, 1)
	}
}

// acquireTranscodeSem reserves this entry's transcode slot (capacity 1).
func (r *Runner) acquireTranscodeSem(ctx context.Context, entryID int64) (func(), error) {
	r.transcodeMu.Lock()
	if r.transcodeSems == nil {
		r.transcodeSems = map[int64]*entrySem{}
	}
	sem := r.transcodeSems[entryID]
	if sem == nil {
		sem = &entrySem{ch: make(chan struct{}, 1)}
		r.transcodeSems[entryID] = sem
	}
	sem.active++
	r.transcodeMu.Unlock()

	select {
	case sem.ch <- struct{}{}:
		var once sync.Once
		release := func() {
			once.Do(func() {
				<-sem.ch
				r.transcodeMu.Lock()
				sem.active--
				if sem.active == 0 {
					delete(r.transcodeSems, entryID)
				}
				r.transcodeMu.Unlock()
			})
		}
		return release, nil
	case <-ctx.Done():
		r.transcodeMu.Lock()
		sem.active--
		if sem.active == 0 {
			delete(r.transcodeSems, entryID)
		}
		r.transcodeMu.Unlock()
		return nil, ctx.Err()
	}
}

// DownloadBusy reports whether a URL download is currently executing.
func (r *Runner) DownloadBusy() bool { return r.downloadBusy.Load() }

// Handle dispatches a claimed job to its handler.
func (r *Runner) Handle(ctx context.Context, job db.Job) error {
	switch job.Type {
	case "probe":
		return r.Probe(ctx, job)
	case "transcode":
		return r.Transcode(ctx, job)
	case "download":
		return r.Download(ctx, job)
	default:
		return fmt.Errorf("unknown job type %q", job.Type)
	}
}

func (r *Runner) media() *media.Manager {
	return &media.Manager{Store: r.Store}
}

// Download fetches a remote video URL into the store and hands off to the
// probe pipeline. SSRF-guarded, size-capped, sequential (one at a time),
// with progress reported through the url_downloads table.
func (r *Runner) Download(ctx context.Context, job db.Job) error {
	if job.EntryID == nil {
		return errors.New("download job without entry")
	}
	var params struct {
		URL string `json:"url"`
	}
	if err := json.Unmarshal(job.Payload, &params); err != nil {
		return err
	}
	e, err := db.EntryByID(ctx, r.Pool, *job.EntryID)
	if err != nil {
		return err
	}
	fail := func(msg string) error {
		r.failEntry(ctx, e, "download failed: "+msg)
		_ = db.DeleteURLDownload(ctx, r.Pool, e.ID)
		return errors.New("download failed: " + msg)
	}

	u, err := safeurl.Validate(ctx, params.URL)
	if err != nil {
		return fail(err.Error())
	}
	client := safeurl.Client()
	ext := strings.ToLower(strings.TrimPrefix(path.Ext(u.Path), "."))
	if ext == "" {
		// No extension in the path: follow the URL to learn the real type.
		ext, err = safeurl.ResolveExt(ctx, client, params.URL, 15*time.Second)
		if err != nil {
			return fail(err.Error())
		}
	}
	if ext == "" {
		return fail("cannot determine file type")
	}
	allowed := r.Settings.StringSlice("upload.allowed_extensions", []string{"mp4", "mov", "mkv", "webm", "m4v", "avi"})
	extOK := false
	for _, a := range allowed {
		if ext == a {
			extOK = true
			break
		}
	}
	if !extOK {
		return fail("file extension ." + ext + " is not allowed")
	}
	maxSize := r.Settings.Int64("upload.max_size_bytes", 8<<30)

	r.EnsureDownloadSem()
	select {
	case r.downloadSem <- struct{}{}:
		defer func() { <-r.downloadSem }()
	case <-ctx.Done():
		return ctx.Err()
	}
	r.downloadBusy.Store(true)
	defer r.downloadBusy.Store(false)

	// A browser-like user-agent avoids CDN blocks on Go's default client UA;
	// every redirect hop is re-validated by safeurl.Client (SSRF).
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, params.URL, nil)
	if err != nil {
		return fail(err.Error())
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; vidsilo/0.1)")
	resp, err := client.Do(req)
	if err != nil {
		return fail(err.Error())
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fail(fmt.Sprintf("remote server returned %s", resp.Status))
	}
	total := resp.ContentLength
	if total > maxSize {
		return fail("file exceeds the configured max upload size")
	}

	src, err := os.CreateTemp(os.TempDir(), "vidsilo-download-*."+ext)
	if err != nil {
		return fail(err.Error())
	}
	defer os.Remove(src.Name())

	lastUpdate := time.Time{}
	var counted *countingWriter
	counted = &countingWriter{next: src, onWrite: func(n int64) {
		if total <= 0 || time.Since(lastUpdate) < time.Second {
			return
		}
		lastUpdate = time.Now()
		_ = db.UpdateURLDownloadProgress(ctx, r.Pool, e.ID, counted.n, total)
	}}
	written, err := io.Copy(counted, io.LimitReader(resp.Body, maxSize+1))
	if err != nil {
		return fail(err.Error())
	}
	if written > maxSize {
		return fail("file exceeds the configured max upload size")
	}
	if err := src.Close(); err != nil {
		return fail(err.Error())
	}
	if err := db.UpdateURLDownloadProgress(ctx, r.Pool, e.ID, written, written); err != nil {
		r.Log.Warn("download progress update", "err", err)
	}

	// Entry deleted while downloading? Stop before writing the file into
	// storage (avoids an orphaned original).
	if _, err := db.EntryByID(ctx, r.Pool, e.ID); err != nil {
		return errors.New("entry deleted during download")
	}

	key := store.OriginalKey(e.ID, ext)
	f, err := os.Open(src.Name())
	if err != nil {
		return fail(err.Error())
	}
	err = r.Store.Put(ctx, key, f, written)
	f.Close()
	if err != nil {
		return fail(err.Error())
	}
	if _, err := r.Pool.Exec(ctx, `
		UPDATE entries SET status = 'probing', source_key = $1, source_size = $2, error = NULL, updated_at = now()
		WHERE id = $3`, key, written, e.ID); err != nil {
		return err
	}
	_ = db.DeleteURLDownload(ctx, r.Pool, e.ID)
	if _, err := r.Queue.Enqueue(ctx, "probe", e.ID, map[string]any{}, 3); err != nil {
		return err
	}
	r.Log.Info("url download finished, probe queued", "entry", e.ID, "bytes", written, "url", params.URL)
	return nil
}

// countingWriter counts bytes while forwarding to an underlying writer.
type countingWriter struct {
	next    io.Writer
	n       int64
	onWrite func(n int64)
}

func (c *countingWriter) Write(p []byte) (int, error) {
	n, err := c.next.Write(p)
	c.n += int64(n)
	if c.onWrite != nil {
		c.onWrite(c.n)
	}
	return n, err
}

// spoolEntry is a cached source copy plus the source key it was downloaded
// from, so a re-uploaded source never reuses a stale file.
type spoolEntry struct {
	path      string
	sourceKey string
}

// spoolSource returns a local copy of the entry's source file, cached per
// entry for the lifetime of the pipeline: probe + every transcode flavor
// share one download from remote stores. Callers must NOT delete the file;
// it is removed by clearSpool when the entry reaches a terminal state.
func (r *Runner) spoolSource(ctx context.Context, e db.Entry) (string, error) {
	if e.SourceKey == "" {
		return "", errors.New("entry has no source media")
	}
	r.spoolMu.Lock()
	if r.spoolCache == nil {
		r.spoolCache = map[int64]spoolEntry{}
	}
	if cached, ok := r.spoolCache[e.ID]; ok && cached.sourceKey == e.SourceKey {
		r.spoolMu.Unlock()
		return cached.path, nil
	}
	r.spoolMu.Unlock()

	rc, err := r.Store.Open(ctx, e.SourceKey)
	if err != nil {
		return "", err
	}
	defer rc.Close()
	dir := r.SpoolDir
	if dir == "" {
		dir = os.TempDir()
	}
	tmp, err := os.CreateTemp(dir, "vidsilo-source-*"+path.Ext(e.SourceKey))
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

	r.spoolMu.Lock()
	// A concurrent job may have finished the same download while we were
	// copying; prefer the registered copy and drop ours.
	if cached, ok := r.spoolCache[e.ID]; ok && cached.sourceKey == e.SourceKey {
		r.spoolMu.Unlock()
		os.Remove(tmp.Name())
		return cached.path, nil
	}
	// Source changed under us (re-upload): replace the stale copy.
	if old, ok := r.spoolCache[e.ID]; ok {
		os.Remove(old.path)
	}
	r.spoolCache[e.ID] = spoolEntry{path: tmp.Name(), sourceKey: e.SourceKey}
	r.spoolMu.Unlock()
	return tmp.Name(), nil
}

// clearSpool removes the cached source copy for an entry whose pipeline
// reached a terminal state (ready, failed, deleted).
func (r *Runner) clearSpool(entryID int64) {
	r.spoolMu.Lock()
	defer r.spoolMu.Unlock()
	if e, ok := r.spoolCache[entryID]; ok {
		os.Remove(e.path) // best effort; temp dir cleans leftovers
		delete(r.spoolCache, entryID)
	}
}

// transcodeParams is the transcode job payload.
type transcodeParams struct {
	FlavorID int64 `json:"flavorId"`
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

	res, err := media.Probe(ctx, src)
	if err != nil {
		r.failEntry(ctx, e, "probe failed: "+err.Error())
		return err
	}
	// Entry deleted while probing? Stop before writing poster/sprite.
	if _, err := db.EntryByID(ctx, r.Pool, e.ID); err != nil {
		r.clearSpool(e.ID)
		return errors.New("entry deleted during probing")
	}

	// Poster at 10% + sprite sheet.
	_ = db.UpdateJobProgress(ctx, r.Pool, job.ID, "Extracting poster & sprite…")
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
		// Record the sprite frame closest to the initial poster (extracted
		// above at atMs) so the admin poster picker reopens on it. The sprite
		// window is the first min(duration, 60s); clamp when the poster time
		// falls outside it.
		scanEnd := res.DurationMs
		if scanEnd > 60000 {
			scanEnd = 60000
		}
		if scanEnd < 2000 {
			scanEnd = 2000
		}
		posterFrame := int(float64(atMs) / float64(scanEnd) * float64(frames))
		if posterFrame < 0 {
			posterFrame = 0
		}
		if posterFrame >= frames {
			posterFrame = frames - 1
		}
		_, _ = r.Pool.Exec(ctx, `UPDATE entries SET sprite_key = $1, sprite_frames = $2, poster_frame = $3 WHERE id = $4`,
			store.SpriteKey(e.ID), frames, posterFrame, e.ID)
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
		r.clearSpool(e.ID)
		return nil
	}

	_, err = r.Pool.Exec(ctx, `
		UPDATE entries SET status = 'transcoding', duration_ms = $1, error = NULL, updated_at = now() WHERE id = $2`,
		res.DurationMs, e.ID)
	if err != nil {
		return err
	}
	// One transcode job per flavor; the queue orders flavors per entry and
	// runs different entries in parallel.
	for _, fid := range pending {
		if _, err := r.Queue.Enqueue(ctx, "transcode", e.ID, transcodeParams{FlavorID: fid}, 3); err != nil {
			return err
		}
	}
	return nil
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

// Transcode encodes ONE flavor (executed per-entry serially via the
// entry's transcode semaphore) and, when it is the last flavor of the
// entry, assembles the master playlist and marks the entry ready.
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

	segmentSecs := r.Settings.Int("transcode.segment_seconds", 4)
	gopSecs := r.Settings.Int("transcode.gop_seconds", 2)
	preset := r.Settings.String("transcode.preset", "veryfast")

	// Per-entry serialization: flavors of one entry transcode in order,
	// different entries run in parallel (the worker pool bounds ffmpeg
	// processes globally).
	releaseSem, err := r.acquireTranscodeSem(ctx, e.ID)
	if err != nil {
		return err
	}
	defer releaseSem()

	f, err := db.FlavorByID(ctx, r.Pool, params.FlavorID)
	if err != nil {
		r.markFlavor(ctx, e.ID, params.FlavorID, db.FlavorFailed, err.Error())
		return r.finalizeTranscode(ctx, e)
	}
	// Live visibility: mark the flavor as transcoding and surface it on the
	// jobs page (re-trying a failed flavor overwrites its status).
	r.markFlavor(ctx, e.ID, params.FlavorID, db.FlavorTranscoding, "")
	_ = db.UpdateJobProgress(ctx, r.Pool, job.ID, "Transcoding "+f.Label)
	r.Log.Info("transcoding flavor", "entry", e.ID, "flavor", f.Name)

	flavor := media.Flavor{
		Name: f.Name, Codec: f.Codec, Height: f.Height,
		VideoMode: f.VideoMode, CRF: orZero(f.CRF), VideoBitrate: orZeroI(f.VideoBitrate),
		AudioBitrate: f.AudioBitrate, Preset: preset,
		SegmentSecs: segmentSecs, GopSecs: gopSecs,
	}

	// Entry deleted while waiting for the transcode slot? Stop before
	// starting ffmpeg.
	if _, err := db.EntryByID(ctx, r.Pool, e.ID); err != nil {
		r.clearSpool(e.ID)
		return errors.New("entry deleted during transcoding")
	}

	outDir, cleanup, err := r.flavorOutputDir(ctx, e, f)
	if err != nil {
		r.markFlavor(ctx, e.ID, params.FlavorID, db.FlavorFailed, err.Error())
		return r.finalizeTranscode(ctx, e)
	}
	err = media.TranscodeFlavor(ctx, src, outDir, flavor, nil)
	if err != nil {
		cleanup()
		r.markFlavor(ctx, e.ID, params.FlavorID, db.FlavorFailed, err.Error())
		return r.finalizeTranscode(ctx, e)
	}
	// Entry deleted while encoding? Remove the flavor files that were just
	// written into the store tree (local driver) so nothing is left behind.
	if _, err := db.EntryByID(ctx, r.Pool, e.ID); err != nil {
		cleanup()
		r.clearSpool(e.ID)
		return errors.New("entry deleted during transcoding")
	}
	playlistKey, err := r.publishFlavor(ctx, e, f, outDir, cleanup)
	if err != nil {
		cleanup()
		r.markFlavor(ctx, e.ID, params.FlavorID, db.FlavorFailed, err.Error())
		return r.finalizeTranscode(ctx, e)
	}
	r.markFlavorDone(ctx, e.ID, params.FlavorID, playlistKey)
	_ = db.UpdateJobProgress(ctx, r.Pool, job.ID, "")
	return r.finalizeTranscode(ctx, e)
}

// finalizeTranscode runs after a flavor reaches a terminal state. If no
// flavors are still pending/transcoding, it assembles the master playlist
// (when at least one flavor succeeded) and marks the entry ready — or fails
// the entry when every flavor failed.
func (r *Runner) finalizeTranscode(ctx context.Context, e db.Entry) error {
	// Entry deleted (or being deleted): the job row is already cascaded
	// away — nothing to finalize.
	if _, err := db.EntryByID(ctx, r.Pool, e.ID); err != nil {
		return nil
	}
	var remaining int
	if err := r.Pool.QueryRow(ctx, `
		SELECT count(*) FROM entry_flavors
		WHERE entry_id = $1 AND status IN ('pending', 'transcoding')`, e.ID).Scan(&remaining); err != nil {
		return err
	}
	if remaining > 0 {
		return nil // more flavors queued; they finalize in turn
	}
	var done int
	if err := r.Pool.QueryRow(ctx, `
		SELECT count(*) FROM entry_flavors WHERE entry_id = $1 AND status = 'done'`, e.ID).Scan(&done); err != nil {
		return err
	}
	if done == 0 {
		r.failEntry(ctx, e, "all flavors failed")
		return errors.New("all flavors failed")
	}
	if err := r.buildMaster(ctx, e); err != nil {
		return err
	}
	_, err := r.Pool.Exec(ctx, `
		UPDATE entries SET status = 'ready', error = NULL, updated_at = now() WHERE id = $1`, e.ID)
	r.clearSpool(e.ID)
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
	dir, err := os.MkdirTemp("", "vidsilo-flavor-*")
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
		fh, err := os.Open(p) // #nosec G304 -- internal segment path
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
	r.clearSpool(e.ID)
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
