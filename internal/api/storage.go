package api

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
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
	Name  string `json:"name,omitempty"`
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
// subtitles / other. Flavor keys also carry the flavor name so the storage
// table can show one row per flavor.
func classifyFile(key string) (label, name string) {
	base := key[strings.LastIndex(key, "/")+1:]
	parts := strings.Split(key, "/")
	switch {
	case strings.HasPrefix(base, "original."):
		return "source", ""
	case strings.HasPrefix(base, "poster."), strings.HasPrefix(base, "sprite."):
		return "poster", ""
	case len(parts) >= 4 && parts[2] == "flavors":
		return "flavors", parts[3]
	case strings.Contains(key, "/subs/"):
		return "subtitles", ""
	default:
		return "other", ""
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
	type gkey struct {
		label string
		name  string
	}
	byEntry := map[int64]map[gkey]*group{}
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
			byEntry[id] = map[gkey]*group{}
			order = append(order, id)
		}
		label, name := classifyFile(f.Key)
		k := gkey{label, name}
		g := byEntry[id][k]
		if g == nil {
			g = &group{}
			byEntry[id][k] = g
		}
		g.bytes += f.Size
		g.count++
	}

	byID := map[int64]db.Entry{}
	for _, e := range entries {
		byID[e.ID] = e
	}

		out := []storageEntry{}
	for _, id := range order {
		e, ok := byID[id]
		if !ok {
			continue
		}
		groups := byEntry[id]
		entry := storageEntry{PublicID: e.PublicID, Title: e.Title, Status: string(e.Status)}
		// Flavors are emitted one row per flavor name; other labels in order.
		flavorRows := []storageEntryFile{}
		for k, g := range groups {
			row := storageEntryFile{Label: k.label, Name: k.name, Bytes: g.bytes, Count: g.count}
			if k.label == "flavors" {
				flavorRows = append(flavorRows, row)
				continue
			}
			entry.Files = append(entry.Files, row)
		}
		sort.Slice(flavorRows, func(i, j int) bool { return flavorRows[i].Name < flavorRows[j].Name })
		entry.Files = append(entry.Files, flavorRows...)
		for _, f := range entry.Files {
			entry.TotalBytes += f.Bytes
		}
		if entry.TotalBytes == 0 && len(entry.Files) == 0 {
			continue
		}
		out = append(out, entry)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].TotalBytes > out[j].TotalBytes })

	// System row: non-media files in the data dir (uploads spools, logs,
	// cache, secret key/certs) — everything outside the entries/ tree.
	if root, ok := store.LocalRootOf(s.store); ok {
		if sys := systemUsage(r.Context(), root); sys.TotalBytes > 0 {
			out = append(out, sys)
		}
	}
	writeJSON(w, http.StatusOK, out)
}

// systemUsage walks the data dir excluding the entries/ media tree and
// groups the remainder (uploads, logs, cache, other) as a storage entry.
func systemUsage(ctx context.Context, root string) storageEntry {
	type group struct {
		bytes int64
		count int
	}
	groups := map[string]*group{}
	total := int64(0)
	_ = filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(root, p)
		if err != nil {
			return nil
		}
		if rel == "entries" || strings.HasPrefix(rel, "entries/") {
			return nil
		}
		fi, err := d.Info()
		if err != nil {
			return nil
		}
		top := strings.SplitN(rel, string(filepath.Separator), 2)[0]
		g := groups[top]
		if g == nil {
			g = &group{}
			groups[top] = g
		}
		g.bytes += fi.Size()
		g.count++
		total += fi.Size()
		return nil
	})

	sys := storageEntry{Title: "System"}
	for _, top := range []string{"uploads", "logs", "cache"} {
		if g, ok := groups[top]; ok {
			sys.TotalBytes += g.bytes
			sys.Files = append(sys.Files, storageEntryFile{Label: "system", Name: top, Bytes: g.bytes, Count: g.count})
		}
	}
	rest := &group{}
	for top, g := range groups {
		if top != "uploads" && top != "logs" && top != "cache" {
			rest.bytes += g.bytes
			rest.count += g.count
		}
	}
	if rest.bytes > 0 {
		sys.TotalBytes += rest.bytes
		sys.Files = append(sys.Files, storageEntryFile{Label: "system", Name: "other", Bytes: rest.bytes, Count: rest.count})
	}
	return sys
}
