package store

import (
	"fmt"
	"path"
	"strconv"
	"strings"
)

// Key layout. All keys are relative, slash-separated, and safe by construction:
// identifiers are numeric ids or single-path segments.
//
//	entries/{id}/original.{ext}
//	entries/{id}/poster.jpg
//	entries/{id}/sprite.jpg
//	entries/{id}/subs/{lang}.vtt
//	entries/{id}/flavors/{flavor}/index.m3u8
//	entries/{id}/flavors/{flavor}/seg_{n}.ts
//	entries/{id}/master.m3u8
const EntriesRoot = "entries"

func entryDir(id int64) string {
	return path.Join(EntriesRoot, strconv.FormatInt(id, 10))
}

func OriginalKey(id int64, ext string) string {
	return path.Join(entryDir(id), "original."+strings.TrimPrefix(ext, "."))
}

func PosterKey(id int64) string {
	return path.Join(entryDir(id), "poster.jpg")
}

func SpriteKey(id int64) string {
	return path.Join(entryDir(id), "sprite.jpg")
}

func MasterKey(id int64) string {
	return path.Join(entryDir(id), "master.m3u8")
}

func FlavorDir(id int64, flavor string) string {
	return path.Join(entryDir(id), "flavors", flavor)
}

func FlavorPlaylistKey(id int64, flavor string) string {
	return path.Join(FlavorDir(id, flavor), "index.m3u8")
}

func FlavorSegmentKey(id int64, flavor, segment string) string {
	return path.Join(FlavorDir(id, flavor), segment)
}

func SubtitleKey(id int64, lang string) string {
	return path.Join(entryDir(id), "subs", sanitizeLang(lang)+".vtt")
}

func sanitizeLang(lang string) string {
	lang = strings.TrimSpace(strings.ToLower(lang))
	for _, r := range lang {
		if !(r >= 'a' && r <= 'z') && !(r >= '0' && r <= '9') && r != '-' && r != '_' {
			return "en"
		}
	}
	if lang == "" {
		return "en"
	}
	return lang
}

// EntryIDFromMediaKey maps a /media/... path back to its storage key and entry
// id, refusing anything outside entries/.
func EntryIDFromMediaKey(mediaKey string) (int64, error) {
	parts := strings.Split(strings.Trim(mediaKey, "/"), "/")
	if len(parts) < 2 || parts[0] != EntriesRoot {
		return 0, fmt.Errorf("invalid media key %q", mediaKey)
	}
	id, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid entry id in key %q", mediaKey)
	}
	return id, nil
}
