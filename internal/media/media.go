// Package media wraps ffprobe/ffmpeg: metadata probing, sprite/poster
// extraction, multi-rendition HLS transcoding with aligned GOPs, and master
// playlist assembly.
package media

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path"
	"strconv"
	"strings"

	"github.com/parasetam0l/vod-app/internal/store"
)

// Manager runs ffmpeg/ffprobe and reads/writes media through a Store.
type Manager struct {
	Store store.Store
	// TempDir is where spooled copies land; defaults to os.TempDir().
	TempDir string
}

// spool downloads a store key to a local temp file.
func (m *Manager) spool(ctx context.Context, key string) (string, error) {
	rc, err := m.Store.Open(ctx, key)
	if err != nil {
		return "", err
	}
	defer rc.Close()
	tmp, err := os.CreateTemp(m.TempDir, "vod-media-*")
	if err != nil {
		return "", err
	}
	if _, err := io.Copy(tmp, rc); err != nil {
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

// ProbeResult is the subset of ffprobe output the pipeline needs.
type ProbeResult struct {
	DurationMs int64 `json:"durationMs"`
	Width      int   `json:"width"`
	Height     int   `json:"height"`
	VideoCodec string `json:"videoCodec"`
	AudioCodec string `json:"audioCodec"`
	Bitrate    int64 `json:"bitrate"`
}

type ffprobeOutput struct {
	Format struct {
		Duration string `json:"duration"`
		Bitrate  string `json:"bit_rate"`
	} `json:"format"`
	Streams []struct {
		CodecType string `json:"codec_type"`
		CodecName string `json:"codec_name"`
		Width     int    `json:"width"`
		Height    int    `json:"height"`
	} `json:"streams"`
}

// Probe runs ffprobe against the file at srcPath.
func Probe(ctx context.Context, srcPath string) (*ProbeResult, error) {
	cmd := exec.CommandContext(ctx, "ffprobe",
		"-v", "error", "-print_format", "json", "-show_format", "-show_streams", srcPath)
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("ffprobe: %w: %s", err, out.String())
	}
	var fo ffprobeOutput
	if err := json.Unmarshal(out.Bytes(), &fo); err != nil {
		return nil, err
	}
	res := &ProbeResult{}
	if f, err := strconv.ParseFloat(fo.Format.Duration, 64); err == nil {
		res.DurationMs = int64(f * 1000)
	}
	if b, err := strconv.ParseInt(fo.Format.Bitrate, 10, 64); err == nil {
		res.Bitrate = b
	}
	for _, st := range fo.Streams {
		if st.CodecType == "video" {
			res.Width, res.Height, res.VideoCodec = st.Width, st.Height, st.CodecName
		} else if st.CodecType == "audio" && res.AudioCodec == "" {
			res.AudioCodec = st.CodecName
		}
	}
	if res.Width == 0 {
		return nil, errors.New("ffprobe: no video stream found")
	}
	return res, nil
}

// Sprite constants: 160x90 frames, 10 per row, up to 100 frames (10 rows).
const (
	SpriteFrameW = 160
	SpriteFrameH = 90
	spriteCols   = 10
	MaxFrames    = 100
)

// SpriteGrid generates the sprite sheet from the source video, scanning the
// first 10% (capped at 60s) into a 10-wide tile grid. Returns the true frame
// count (never the padded cells of the last row).
func (m *Manager) SpriteGrid(ctx context.Context, entryID int64, srcPath string, durationMs int64) (int, error) {
	scanEnd := durationMs / 10
	if scanEnd < 2000 {
		scanEnd = 2000
	}
	if scanEnd > 60000 {
		scanEnd = 60000
	}
	// Sample at exactly 10fps within the window, then keep every 6th frame:
	// ~100 cells for a full 60s window. Because the count is deterministic
	// (fps=10 → F frames → ceil(F/6) kept), the UI never sees the black
	// padding cells that tile appends to the last row.
	fpsFrames := (scanEnd + 99) / 100 // frames at 10fps over the window
	frames := int((fpsFrames + 5) / 6) // every 6th kept by select
	if frames < 1 {
		frames = 1
	}
	if frames > MaxFrames {
		frames = MaxFrames
	}
	vf := fmt.Sprintf("fps=10,select='not(mod(n,6))',scale=%d:%d,tile=%dx%d",
		SpriteFrameW, SpriteFrameH, spriteCols, spriteCols)
	spriteTmp, err := os.CreateTemp(m.TempDir, "vod-sprite-*.jpg")
	if err != nil {
		return 0, err
	}
	spriteTmp.Close()
	defer os.Remove(spriteTmp.Name())

	cmd := exec.CommandContext(ctx, "ffmpeg", "-y",
		"-ss", fmt.Sprintf("%dms", scanEnd/10),
		"-i", srcPath,
		"-t", fmt.Sprintf("%dms", scanEnd),
		"-vf", vf,
		"-q:v", "4",
		spriteTmp.Name())
	if out, err := cmd.CombinedOutput(); err != nil {
		return 0, fmt.Errorf("ffmpeg sprite: %w: %s", err, out)
	}
	if err := putFile(ctx, m.Store, store.SpriteKey(entryID), spriteTmp.Name()); err != nil {
		return 0, err
	}
	return frames, nil
}

// ExtractPosterFromSource pulls frame atMs from the source video (probe path).
func (m *Manager) ExtractPosterFromSource(ctx context.Context, entryID int64, srcPath string, atMs int64) error {
	posterTmp, err := os.CreateTemp(m.TempDir, "vod-poster-*.jpg")
	if err != nil {
		return err
	}
	posterTmp.Close()
	defer os.Remove(posterTmp.Name())
	cmd := exec.CommandContext(ctx, "ffmpeg", "-y",
		"-ss", fmt.Sprintf("%dms", atMs),
		"-i", srcPath,
		"-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "3",
		posterTmp.Name())
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("ffmpeg poster: %w: %s", err, out)
	}
	return putFile(ctx, m.Store, store.PosterKey(entryID), posterTmp.Name())
}

// ExtractPoster crops frame n out of the stored sprite and scales to 640x360.
func (m *Manager) ExtractPoster(ctx context.Context, entryID int64, frame int) error {
	spritePath, err := m.spool(ctx, store.SpriteKey(entryID))
	if err != nil {
		return err
	}
	defer os.Remove(spritePath)

	col := frame % spriteCols
	row := frame / spriteCols
	crop := fmt.Sprintf("crop=%d:%d:%d:%d,scale=640:-2",
		SpriteFrameW, SpriteFrameH, col*SpriteFrameW, row*SpriteFrameH)
	posterTmp, err := os.CreateTemp(m.TempDir, "vod-poster-*.jpg")
	if err != nil {
		return err
	}
	posterTmp.Close()
	defer os.Remove(posterTmp.Name())

	cmd := exec.CommandContext(ctx, "ffmpeg", "-y", "-i", spritePath,
		"-vf", crop, "-q:v", "3", posterTmp.Name())
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("ffmpeg poster: %w: %s", err, out)
	}
	return putFile(ctx, m.Store, store.PosterKey(entryID), posterTmp.Name())
}

// Flavor describes a transcode target for TranscodeFlavor.
type Flavor struct {
	Name         string
	Codec        string // h264 | h265
	Height       int
	VideoMode    string // crf | bitrate
	CRF          float64
	VideoBitrate int
	AudioBitrate int
	Preset       string
	SegmentSecs  int
	GopSecs      int
}

// TranscodeFlavor encodes one rendition to HLS into outDir.
func TranscodeFlavor(ctx context.Context, srcPath, outDir string, f Flavor, progress func(frac float64)) error {
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		return err
	}
	videoCodec := "libx264"
	if f.Codec == "h265" {
		videoCodec = "libx265"
	}
	args := []string{
		"-y", "-i", srcPath,
		"-map", "0:v:0", "-map", "0:a?",
		"-c:v", videoCodec, "-preset", f.Preset,
	}
	if f.VideoMode == "crf" {
		args = append(args, "-crf", strconv.FormatFloat(f.CRF, 'f', 1, 64))
	} else {
		br := strconv.Itoa(f.VideoBitrate)
		maxRate := strconv.Itoa(int(float64(f.VideoBitrate) * 1.2))
		bufSize := strconv.Itoa(f.VideoBitrate * 2)
		args = append(args, "-b:v", br, "-maxrate", maxRate, "-bufsize", bufSize)
	}
	args = append(args,
		"-g", strconv.Itoa(f.GopSecs),
		"-keyint_min", strconv.Itoa(f.GopSecs),
		"-sc_threshold", "0",
		"-force_key_frames", fmt.Sprintf("expr:gte(t,n_forced*%d)", f.GopSecs),
		"-c:a", "aac", "-b:a", strconv.Itoa(f.AudioBitrate)+"k", "-ac", "2",
		"-hls_time", strconv.Itoa(f.SegmentSecs),
		"-hls_playlist_type", "vod",
		"-hls_segment_filename", path.Join(outDir, "seg_%05d.ts"),
		path.Join(outDir, "index.m3u8"),
	)
	cmd := exec.CommandContext(ctx, "ffmpeg", args...)
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	_, _ = io.Copy(io.Discard, stderr)
	if err := cmd.Wait(); err != nil {
		return err
	}
	if progress != nil {
		progress(1)
	}
	return nil
}

// Rendition is one finished flavor for the master playlist.
type Rendition struct {
	Name        string
	Height      int
	Bitrate     int
	PlaylistKey string
}

// BuildMasterPlaylist writes master.m3u8 for the given finished renditions
// plus optional subtitle renditions.
func BuildMasterPlaylist(w io.Writer, renditions []Rendition, subtitles []SubtitleRendition) error {
	var b strings.Builder
	b.WriteString("#EXTM3U\n")
	b.WriteString("#EXT-X-VERSION:3\n")
	if len(subtitles) > 0 {
		for _, sub := range subtitles {
			b.WriteString(fmt.Sprintf("#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID=\"subs\",NAME=\"%s\",DEFAULT=YES,AUTOSELECT=YES,FORCED=NO,LANGUAGE=\"%s\",URI=\"%s\"\n",
				escapeQuoted(sub.Label), sub.Lang, sub.URI))
		}
	}
	for _, r := range renditions {
		bandwidth := r.Bitrate * 1024
		if bandwidth == 0 {
			bandwidth = 1_000_000
		}
		b.WriteString(fmt.Sprintf("#EXT-X-STREAM-INF:BANDWIDTH=%d,RESOLUTION=0x%d,NAME=\"%s\",SUBTITLES=\"subs\"\n%s\n",
			bandwidth, r.Height, escapeQuoted(r.Name), r.PlaylistKey))
	}
	_, err := io.WriteString(w, b.String())
	return err
}

// SubtitleRendition describes an EXT-X-MEDIA subtitle entry.
type SubtitleRendition struct {
	Lang  string
	Label string
	URI   string
}

func escapeQuoted(s string) string {
	s = strings.ReplaceAll(s, "\\", "\\\\")
	return strings.ReplaceAll(s, "\"", "\\\"")
}

// putFile streams a local file into the store.
func putFile(ctx context.Context, st store.Store, key, path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	fi, err := f.Stat()
	if err != nil {
		return err
	}
	return st.Put(ctx, key, f, fi.Size())
}
