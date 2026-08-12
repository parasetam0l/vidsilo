package api

import (
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/parasetam0l/vod-app/internal/db"
	"github.com/parasetam0l/vod-app/internal/store"
)

// registerStorageRoutes: storage usage and per-entry file breakdown.
func (s *Server) registerStorageRoutes(mux *http.ServeMux) {
	mux.Handle("GET /api/storage/usage", s.requireAuth(http.HandlerFunc(s.handleStorageUsage)))
	mux.Handle("GET /api/storage/files", s.requireAuth(http.HandlerFunc(s.handleStorageFiles)))
}

type storageUsage struct {
	UsedBytes   int64  `json:"usedBytes"`
	TotalBytes  int64  `json:"totalBytes"`
	FreeBytes   int64  `json:"freeBytes"`
	ObjectCount int64  `json:"objectCount"`
	Driver      string `json:"driver"`
}

func (s *Server) handleStorageUsage(w http.ResponseWriter, r *http.Request) {
	u, driver, err := store.UsageOf(r.Context(), s.store)
	if err != nil {
		s.internalError(w, r, "storage usage", err)
		return
	}
	writeJSON(w, http.StatusOK, storageUsage{
		UsedBytes:   u.UsedBytes,
		TotalBytes:  u.TotalBytes,
		FreeBytes:   u.FreeBytes,
		ObjectCount: u.ObjectCount,
		Driver:      driver,
	})
}

type storageEntryFile struct {
	Label string `json:"label"`
	Bytes int64  `json:"bytes"`
	Count int    `json:"count"`
}

type storageEntry struct {
	PublicID   string             `json:"publicId"`
	Title      string             `json:"title"`
	Status     string             `json:"status"`
	TotalBytes int64              `json:"totalBytes"`
	Files      []storageEntryFile `json:"files"`
}

// classifyFile groups a media key into source / poster / flavors /
// subtitles / other.
func classifyFile(key string) string {
	base := key[strings.LastIndex(key, "/")+1:]
	switch {
	case strings.HasPrefix(base, "original."):
		return "source"
	case strings.HasPrefix(base, "poster."), strings.HasPrefix(base, "sprite."):
		return "poster"
	case strings.Contains(key, "/flavors/"):
		return "flavors"
	case strings.Contains(key, "/subs/"):
		return "subtitles"
	default:
		return "other"
	}
}

// handleStorageFiles lists every entry with a breakdown of the files
// generated for it (source, poster, flavors, subtitles) and their sizes.
func (s *Server) handleStorageFiles(w http.ResponseWriter, r *http.Request) {
	entries, err := db.ListAllEntries(r.Context(), s.pool)
	if err != nil {
		s.internalError(w, r, "list entries", err)
		return
	}
	files, err := store.ListSizesOf(r.Context(), s.store, "entries/")
	if err != nil {
		s.internalError(w, r, "list media files", err)
		return
	}

	type group struct {
		bytes int64
		count int
	}
	byEntry := map[int64]map[string]*group{}
	order := []int64{}
	for _, f := range files {
		parts := strings.Split(f.Key, "/")
		if len(parts) < 3 {
			continue
		}
		id, err := strconv.ParseInt(parts[1], 10, 64)
		if err != nil {
			continue
		}
		if _, ok := byEntry[id]; !ok {
			byEntry[id] = map[string]*group{}
			order = append(order, id)
		}
		label := classifyFile(f.Key)
		g := byEntry[id][label]
		if g == nil {
			g = &group{}
			byEntry[id][label] = g
		}
		g.bytes += f.Size
		g.count++
	}

	byID := map[int64]db.Entry{}
	for _, e := range entries {
		byID[e.ID] = e
	}

	const labelOrder = "source,poster,flavors,subtitles,other"
	out := []storageEntry{}
	for _, id := range order {
		e, ok := byID[id]
		if !ok {
			continue
		}
		groups := byEntry[id]
		entry := storageEntry{PublicID: e.PublicID, Title: e.Title, Status: string(e.Status)}
		for _, label := range strings.Split(labelOrder, ",") {
			if g, ok := groups[label]; ok {
				entry.TotalBytes += g.bytes
				entry.Files = append(entry.Files, storageEntryFile{Label: label, Bytes: g.bytes, Count: g.count})
			}
		}
		if entry.TotalBytes == 0 && len(entry.Files) == 0 {
			continue
		}
		out = append(out, entry)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].TotalBytes > out[j].TotalBytes })
	writeJSON(w, http.StatusOK, out)
}
