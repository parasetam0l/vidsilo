package jobs

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/parasetam0l/vod-app/internal/db"
	"github.com/parasetam0l/vod-app/internal/queue"
	"github.com/parasetam0l/vod-app/internal/settings"
	"github.com/parasetam0l/vod-app/internal/store"
	"github.com/parasetam0l/vod-app/internal/testdb"
)

// Integration test of the full probe + transcode pipeline against a live DB.
// Skips when DATABASE_URL is unset or ffmpeg is missing.

func testLogger(t *testing.T) *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestPipelineProbeAndTranscode(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set")
	}
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not installed")
	}
	if _, err := exec.LookPath("ffprobe"); err != nil {
		t.Skip("ffprobe not installed")
	}

	ctx := context.Background()
	pool := testdb.Pool(t)
	db.MustSeed(ctx, pool, nil)
	svc, err := settings.New(ctx, pool)
	if err != nil {
		t.Fatal(err)
	}
	mediaStore, err := store.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	q := queue.New(pool)
	runner := &Runner{Pool: pool, Store: mediaStore, Queue: q, Settings: svc, Log: testLogger(t)}

	// 3-second 320x240 clip.
	src := filepath.Join(t.TempDir(), "clip.mp4")
	cmd := exec.CommandContext(ctx, "ffmpeg", "-y",
		"-f", "lavfi", "-i", "testsrc=duration=3:size=640x360:rate=24",
		"-f", "lavfi", "-i", "sine=frequency=440:duration=3",
		"-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", src)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("ffmpeg test clip: %v: %s", err, out)
	}

	var entryID int64
	if err := pool.QueryRow(ctx, `
		INSERT INTO entries (title, status, source_key) VALUES ('pipeline-test', 'probing', $1) RETURNING id`,
		store.OriginalKey(0, "mp4")).Scan(&entryID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM entries WHERE id = $1`, entryID) })

	// Write the source into the store under the real key.
	key := store.OriginalKey(entryID, "mp4")
	f, err := os.Open(src)
	if err != nil {
		t.Fatal(err)
	}
	fi, _ := f.Stat()
	if err := mediaStore.Put(ctx, key, f, fi.Size()); err != nil {
		t.Fatal(err)
	}
	f.Close()
	_, _ = pool.Exec(ctx, `UPDATE entries SET source_key = $1 WHERE id = $2`, key, entryID)

	jobID, err := q.Enqueue(ctx, "probe", entryID, map[string]any{}, 3)
	if err != nil {
		t.Fatal(err)
	}
	job, err := q.Get(ctx, jobID)
	if err != nil {
		t.Fatal(err)
	}
	if err := runner.Handle(ctx, job); err != nil {
		t.Fatal(err)
	}

	// Transcode job should be queued; run it too.
	jobs, err := q.Claim(ctx, "test-worker", 10)
	if err != nil {
		t.Fatal(err)
	}
	var transcodeJob *db.Job
	for i := range jobs {
		if jobs[i].Type == "transcode" && jobs[i].EntryID != nil && *jobs[i].EntryID == entryID {
			transcodeJob = &jobs[i]
		}
	}
	if transcodeJob == nil {
		t.Fatalf("no transcode job for entry %d (claimed: %+v)", entryID, jobs)
	}
	if err := runner.Handle(ctx, *transcodeJob); err != nil {
		t.Fatal(err)
	}

	e, err := db.EntryByID(ctx, pool, entryID)
	if err != nil {
		t.Fatal(err)
	}
	if e.Status != db.StatusReady {
		t.Fatalf("entry status = %s, want ready (error: %s)", e.Status, e.Error)
	}
	if e.DurationMS == nil || *e.DurationMS < 2000 {
		t.Fatalf("duration = %v, want >= 2s", e.DurationMS)
	}
	if e.SpriteFrames == 0 {
		t.Fatal("sprite frames not set")
	}

	// Master playlist must exist and reference a rendition.
	rc, err := mediaStore.Open(ctx, store.MasterKey(entryID))
	if err != nil {
		t.Fatalf("master playlist: %v", err)
	}
	defer rc.Close()
	content, _ := io.ReadAll(rc)
	if !containsStr(string(content), "EXT-X-STREAM-INF") {
		t.Fatalf("master playlist has no renditions:\n%s", content)
	}

	flavors, err := db.EntryFlavors(ctx, pool, entryID)
	if err != nil {
		t.Fatal(err)
	}
	doneCount := 0
	for _, ef := range flavors {
		if ef.Status == db.FlavorDone {
			doneCount++
		}
	}
	if doneCount == 0 {
		t.Fatal("no flavors finished")
	}

	// Poster + sprite must be published (and the poster frame recorded).
	for _, k := range []string{store.PosterKey(entryID), store.SpriteKey(entryID)} {
		rc, err := mediaStore.Open(ctx, k)
		if err != nil {
			t.Fatalf("open %s: %v", k, err)
		}
		b, _ := io.ReadAll(rc)
		rc.Close()
		if len(b) == 0 {
			t.Fatalf("%s is empty", k)
		}
	}
	if e.PosterFrame < 0 || e.PosterFrame >= e.SpriteFrames {
		t.Fatalf("poster_frame = %d out of range [0, %d)", e.PosterFrame, e.SpriteFrames)
	}

	// Playback path: resolve the first done flavor's playlist and a segment
	// the player would fetch — the whole HLS chain must be servable.
	checked := 0
	for _, ef := range flavors {
		if ef.Status != db.FlavorDone || ef.PlaylistKey == "" || checked >= 1 {
			continue
		}
		rc, err := mediaStore.Open(ctx, ef.PlaylistKey)
		if err != nil {
			t.Fatalf("rendition playlist %s: %v", ef.PlaylistKey, err)
		}
		pl, _ := io.ReadAll(rc)
		rc.Close()
		segName := firstSegment(string(pl))
		if segName == "" {
			t.Fatalf("no segments in rendition playlist %s:\n%s", ef.PlaylistKey, pl)
		}
		segKey := filepath.ToSlash(filepath.Join(filepath.Dir(ef.PlaylistKey), segName))
		rc, err = mediaStore.Open(ctx, segKey)
		if err != nil {
			t.Fatalf("segment %s: %v", segKey, err)
		}
		seg, _ := io.ReadAll(rc)
		rc.Close()
		if len(seg) < 1024 {
			t.Fatalf("segment %s suspiciously small: %d bytes", segKey, len(seg))
		}
		checked++
	}
	if checked == 0 {
		t.Fatal("no done flavor with a playlist to verify")
	}
	_ = errors.Is
}

// firstSegment extracts the media key on the line after the first #EXTINF.
func firstSegment(playlist string) string {
	lines := strings.Split(playlist, "\n")
	for i := 0; i+1 < len(lines); i++ {
		if strings.HasPrefix(lines[i], "#EXTINF") {
			name := strings.TrimSpace(lines[i+1])
			if name != "" && !strings.HasPrefix(name, "#") {
				return name
			}
		}
	}
	return ""
}

func containsStr(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || len(sub) == 0 || indexOf(s, sub) >= 0)
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
