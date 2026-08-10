// Package analytics implements batched per-video analytics: plays, watch
// seconds, unique viewers, and server-measured bandwidth. Deltas accumulate
// in memory and flush to Postgres in one batched transaction per interval,
// keeping the DB write rate ~0 regardless of beacon volume.
package analytics

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type dailyKey struct {
	EntryID int64
	Day     string // YYYY-MM-DD
}

type dailyDelta struct {
	plays  int64
	watch  int64
	bytes  int64
}

type viewerKey struct {
	EntryID  int64
	Day      string
	ViewerID string
}

type Accumulator struct {
	pool     *pgxpool.Pool
	enabled  bool
	interval time.Duration
	log      *slog.Logger

	mu      sync.Mutex
	days    map[dailyKey]*dailyDelta
	viewers map[viewerKey]struct{}
}

// New creates an accumulator. enabled=false short-circuits all tracking.
func New(pool *pgxpool.Pool, enabled bool, interval time.Duration, log *slog.Logger) *Accumulator {
	if interval <= 0 {
		interval = 10 * time.Second
	}
	return &Accumulator{
		pool:     pool,
		enabled:  enabled,
		interval: interval,
		log:      log,
		days:     map[dailyKey]*dailyDelta{},
		viewers:  map[viewerKey]struct{}{},
	}
}

func dayOf(t time.Time) string { return t.UTC().Format("2006-01-02") }

func (a *Accumulator) AddPlay(entryID int64, viewerID string) {
	if !a.enabled {
		return
	}
	now := time.Now().UTC()
	day := dayOf(now)
	a.mu.Lock()
	defer a.mu.Unlock()
	k := dailyKey{entryID, day}
	d, ok := a.days[k]
	if !ok {
		d = &dailyDelta{}
		a.days[k] = d
	}
	d.plays++
	if viewerID != "" {
		a.viewers[viewerKey{entryID, day, viewerID}] = struct{}{}
	}
}

func (a *Accumulator) AddWatch(entryID int64, seconds int64) {
	if !a.enabled || seconds <= 0 {
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	k := dailyKey{entryID, dayOf(time.Now().UTC())}
	d, ok := a.days[k]
	if !ok {
		d = &dailyDelta{}
		a.days[k] = d
	}
	d.watch += seconds
}

func (a *Accumulator) AddBytes(entryID int64, n int64) {
	if !a.enabled || n <= 0 {
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	k := dailyKey{entryID, dayOf(time.Now().UTC())}
	d, ok := a.days[k]
	if !ok {
		d = &dailyDelta{}
		a.days[k] = d
	}
	d.bytes += n
}

// Flush writes all pending deltas in one batched transaction.
func (a *Accumulator) Flush(ctx context.Context) error {
	if !a.enabled {
		return nil
	}
	a.mu.Lock()
	days := a.days
	viewers := a.viewers
	a.days = map[dailyKey]*dailyDelta{}
	a.viewers = map[viewerKey]struct{}{}
	a.mu.Unlock()
	if len(days) == 0 && len(viewers) == 0 {
		return nil
	}

	tx, err := a.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	for k, d := range days {
		if _, err := tx.Exec(ctx, `
			INSERT INTO analytics_daily (entry_id, day, plays, watch_seconds, bytes)
			VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (entry_id, day) DO UPDATE SET
				plays = analytics_daily.plays + EXCLUDED.plays,
				watch_seconds = analytics_daily.watch_seconds + EXCLUDED.watch_seconds,
				bytes = analytics_daily.bytes + EXCLUDED.bytes`,
			k.EntryID, k.Day, d.plays, d.watch, d.bytes); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO analytics_totals (entry_id, plays, watch_seconds, bytes)
			VALUES ($1, $2, $3, $4)
			ON CONFLICT (entry_id) DO UPDATE SET
				plays = analytics_totals.plays + EXCLUDED.plays,
				watch_seconds = analytics_totals.watch_seconds + EXCLUDED.watch_seconds,
				bytes = analytics_totals.bytes + EXCLUDED.bytes`,
			k.EntryID, d.plays, d.watch, d.bytes); err != nil {
			return err
		}
	}
	for v := range viewers {
		if _, err := tx.Exec(ctx, `
			INSERT INTO analytics_viewers (entry_id, day, viewer_id)
			VALUES ($1, $2, $3)
			ON CONFLICT (entry_id, day, viewer_id) DO NOTHING`,
			v.EntryID, v.Day, v.ViewerID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// Run flushes on an interval and once more on context cancellation.
func (a *Accumulator) Run(ctx context.Context) {
	if !a.enabled {
		<-ctx.Done()
		return
	}
	t := time.NewTicker(a.interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			flushCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			if err := a.Flush(flushCtx); err != nil && a.log != nil {
				a.log.Warn("final analytics flush", "err", err)
			}
			return
		case <-t.C:
			flushCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			if err := a.Flush(flushCtx); err != nil && a.log != nil {
				a.log.Warn("analytics flush", "err", err)
			}
			cancel()
		}
	}
}

// Prune removes daily/viewer rows older than retention days (totals survive).
func Prune(ctx context.Context, pool *pgxpool.Pool, retentionDays int) error {
	if retentionDays <= 0 {
		return nil
	}
	cutoff := time.Now().UTC().AddDate(0, 0, -retentionDays).Format("2006-01-02")
	for _, table := range []string{"analytics_daily", "analytics_viewers"} {
		if _, err := pool.Exec(ctx,
			`DELETE FROM `+table+` WHERE day < $1`, cutoff); err != nil {
			return err
		}
	}
	return nil
}
