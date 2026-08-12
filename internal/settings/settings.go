// Package settings caches the admin-editable settings table in memory and
// exposes typed accessors with code-baked defaults.
package settings

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	pool  *pgxpool.Pool
	mu    sync.RWMutex
	cache map[string]json.RawMessage
}

// New loads all settings into memory.
func New(ctx context.Context, pool *pgxpool.Pool) (*Service, error) {
	s := &Service{pool: pool}
	if err := s.Reload(ctx); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Service) Reload(ctx context.Context) error {
	rows, err := s.pool.Query(ctx, `SELECT key, value FROM settings`)
	if err != nil {
		return err
	}
	defer rows.Close()
	cache := make(map[string]json.RawMessage)
	for rows.Next() {
		var k string
		var v json.RawMessage
		if err := rows.Scan(&k, &v); err != nil {
			return err
		}
		cache[k] = v
	}
	if err := rows.Err(); err != nil {
		return err
	}
	s.mu.Lock()
	s.cache = cache
	s.mu.Unlock()
	return nil
}

func (s *Service) raw(key string) (json.RawMessage, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	v, ok := s.cache[key]
	return v, ok
}

func (s *Service) String(key, def string) string {
	if v, ok := s.raw(key); ok {
		var out string
		if json.Unmarshal(v, &out) == nil {
			return out
		}
	}
	return def
}

func (s *Service) Bool(key string, def bool) bool {
	if v, ok := s.raw(key); ok {
		var out bool
		if json.Unmarshal(v, &out) == nil {
			return out
		}
	}
	return def
}

func (s *Service) Int(key string, def int) int {
	if v, ok := s.raw(key); ok {
		var out int
		if json.Unmarshal(v, &out) == nil {
			return out
		}
	}
	return def
}

func (s *Service) Int64(key string, def int64) int64 {
	if v, ok := s.raw(key); ok {
		var out int64
		if json.Unmarshal(v, &out) == nil {
			return out
		}
	}
	return def
}

func (s *Service) StringSlice(key string, def []string) []string {
	if v, ok := s.raw(key); ok {
		var out []string
		if json.Unmarshal(v, &out) == nil {
			return out
		}
	}
	return def
}

// Update stores a JSON-typed value and refreshes the cache in place.
func (s *Service) Update(ctx context.Context, key string, value json.RawMessage) error {
	if _, err := s.pool.Exec(ctx, `
		INSERT INTO settings (key, value, updated_at)
		VALUES ($1, $2::jsonb, now())
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
		key, value); err != nil {
		return err
	}
	s.mu.Lock()
	s.cache[key] = value
	s.mu.Unlock()
	return nil
}

// All returns a copy of the cache for the admin panel.
func (s *Service) All() map[string]any {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make(map[string]any, len(s.cache))
	for k, v := range s.cache {
		var anyV any
		if json.Unmarshal(v, &anyV) == nil {
			out[k] = anyV
		}
	}
	return out
}

// Run refreshes the in-memory cache every interval so panel changes made on
// other app nodes propagate without restarts (multi-node deployments). An
// interval <= 0 defaults to 1 minute.
func (s *Service) Run(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = time.Minute
	}
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if err := s.Reload(ctx); err != nil {
				slog.Default().Warn("settings reload", "err", err)
			}
		}
	}
}

// KeySpec describes one editable key for validation in the API layer.
type KeySpec struct {
	Type string   // "string" | "int" | "bool" | "strings" | "enum"
	Enums []string
	// IntMin/IntMax bound int-typed keys (inclusive; zero values mean
	// unbounded).
	IntMin int
	IntMax int
}

// Specs is the registry of panel-editable keys (code defaults live in seed).
var Specs = map[string]KeySpec{
	"site_name":                  {Type: "string"},
	"default_lang":               {Type: "string"},
	"upload.max_size_bytes":      {Type: "int", IntMin: 1, IntMax: 1 << 40},
	"upload.allowed_extensions":  {Type: "strings"},
	"transcode.concurrency":      {Type: "int", IntMin: 0, IntMax: 64},
	"transcode.segment_seconds":  {Type: "int", IntMin: 1, IntMax: 60},
	"transcode.gop_seconds":      {Type: "int", IntMin: 1, IntMax: 10},
	"transcode.preset":           {Type: "string"},
	"cache.enabled":              {Type: "bool"},
	"cache.max_bytes":            {Type: "int", IntMin: 1},
	"analytics.enabled":          {Type: "bool"},
	"analytics.retention_days":   {Type: "int", IntMin: 1, IntMax: 3650},
	"analytics.flush_interval_s": {Type: "int", IntMin: 1, IntMax: 3600},
}

// Validate checks a value against its spec and returns a canonical JSON form.
func Validate(key string, value any) (json.RawMessage, error) {
	spec, ok := Specs[key]
	if !ok {
		return nil, fmt.Errorf("unknown setting %q", key)
	}
	switch spec.Type {
	case "string":
		s, ok := value.(string)
		if !ok {
			return nil, fmt.Errorf("%s must be a string", key)
		}
		return json.Marshal(s)
	case "int":
		f, ok := value.(float64)
		if !ok {
			return nil, fmt.Errorf("%s must be a number", key)
		}
		n := int64(f)
		if float64(n) != f {
			return nil, fmt.Errorf("%s must be a whole number", key)
		}
		if spec.IntMin != 0 && n < int64(spec.IntMin) {
			return nil, fmt.Errorf("%s must be >= %d", key, spec.IntMin)
		}
		if spec.IntMax != 0 && n > int64(spec.IntMax) {
			return nil, fmt.Errorf("%s must be <= %d", key, spec.IntMax)
		}
		return json.Marshal(n)
	case "bool":
		b, ok := value.(bool)
		if !ok {
			return nil, fmt.Errorf("%s must be a boolean", key)
		}
		return json.Marshal(b)
	case "strings":
		raw, ok := value.([]any)
		if !ok {
			return nil, fmt.Errorf("%s must be a list of strings", key)
		}
		out := make([]string, 0, len(raw))
		for _, item := range raw {
			s, ok := item.(string)
			if !ok {
				return nil, fmt.Errorf("%s must be a list of strings", key)
			}
			out = append(out, s)
		}
		return json.Marshal(out)
	case "enum":
		s, ok := value.(string)
		if !ok {
			return nil, fmt.Errorf("%s must be one of %v", key, spec.Enums)
		}
		for _, e := range spec.Enums {
			if s == e {
				return json.Marshal(s)
			}
		}
		return nil, fmt.Errorf("%s must be one of %v", key, spec.Enums)
	}
	return nil, fmt.Errorf("unsupported spec for %q", key)
}
