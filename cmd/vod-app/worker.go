package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"path/filepath"
	"os"
	"os/signal"
	"runtime"
	"syscall"
	"time"

	"github.com/parasetam0l/vod-app/internal/analytics"
	"github.com/parasetam0l/vod-app/internal/config"
	"github.com/parasetam0l/vod-app/internal/db"
	"github.com/parasetam0l/vod-app/internal/jobs"
	"github.com/parasetam0l/vod-app/internal/queue"
	"github.com/parasetam0l/vod-app/internal/settings"
)

// randHex returns n random bytes hex-encoded (worker id suffix).
func randHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "0000"
	}
	return hex.EncodeToString(b)
}

// cmdWorker drains the job queue: claims due jobs and runs them in a pool
// sized by transcode.concurrency (default GOMAXPROCS-1) so parallel ffmpeg
// processes never exceed the configured limit.
func cmdWorker(args []string) {
	log, closeLog := newSlog("vod-worker.log")
	defer closeLog()
	slog.SetDefault(log)

	cfg, err := config.Load()
	if err != nil {
		log.Error("invalid config", "err", err)
		os.Exit(1)
	}
	if err := cfg.CheckServer(); err != nil {
		log.Error("invalid config", "err", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := db.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Error("database", "err", err)
		os.Exit(1)
	}
	defer pool.Close()
	db.MustSeed(ctx, pool, log)

	svc, err := settings.New(ctx, pool)
	if err != nil {
		log.Error("settings", "err", err)
		os.Exit(1)
	}
	go svc.Run(ctx, 0)
	mediaStore, err := buildStore(cfg, svc)
	if err != nil {
		log.Error("storage", "err", err)
		os.Exit(1)
	}

	q := queue.New(pool)
	runner := &jobs.Runner{
		Pool:     pool,
		Store:    mediaStore,
		Queue:    q,
		Settings: svc,
		Log:      log,
		SpoolDir: os.TempDir(),
	}

	concurrency := svc.Int("transcode.concurrency", 0)
	if concurrency <= 0 {
		concurrency = runtime.GOMAXPROCS(0) - 1
	}
	if concurrency < 1 {
		concurrency = 1
	}

	// Worker identity: includes the OS PID so a running job's owner is
	// visible for diagnostics. Used as the job ownership key for heartbeats.
	workerID := fmt.Sprintf("w-%d-%s", os.Getpid(), randHex(4))

	w := &worker{
		log:         log,
		queue:       q,
		runner:      runner,
		concurrency: concurrency,
		spoolDir:    filepath.Join(cfg.DataDir, "uploads"),
		workerID:    workerID,
	}
	log.Info("worker started", "concurrency", concurrency, "worker_id", workerID)
	w.run(ctx)
}

type worker struct {
	log         *slog.Logger
	queue       *queue.Queue
	runner      *jobs.Runner
	concurrency int
	spoolDir    string
	workerID    string
}

func (w *worker) run(ctx context.Context) {
	// Reclaim stale running jobs frequently (crashed workers): abandoned
	// jobs must not sit as 'running' for long.
	staleTicker := time.NewTicker(5 * time.Minute)
	defer staleTicker.Stop()

	// Prune analytics rows hourly (totals survive retention).
	pruneTicker := time.NewTicker(time.Hour)
	defer pruneTicker.Stop()

	// Sweep abandoned uploads hourly (spool files, uploads rows, stuck
	// 'uploading' entries).
	cleanupTicker := time.NewTicker(time.Hour)
	defer cleanupTicker.Stop()

	// Reclaim jobs abandoned by a previous worker process (docker restart,
	// service restart, machine reboot) before the claim loop starts. The
	// heartbeat keeps multi-worker deployments safe — jobs that another live
	// worker is running keep a fresh heartbeat and are left alone. This also
	// reverts flavors stuck on 'transcoding' by the dead process.
	if n, err := w.queue.RequeueStale(ctx, 3*time.Minute); err != nil {
		w.log.Warn("startup stale requeue", "err", err)
	} else if n > 0 {
		w.log.Info("requeued stale jobs on startup", "count", n)
	}

	// Heartbeat: prove this worker is alive every 30s so its running jobs
	// are never reclaimed (3-minute stale threshold, 6 missed beats).
	heartbeatTicker := time.NewTicker(30 * time.Second)
	defer heartbeatTicker.Stop()

	// Claim loop: one claim round per poll interval; jobs run on the pool.
	pollTicker := time.NewTicker(time.Second)
	defer pollTicker.Stop()

	sem := make(chan struct{}, w.concurrency)

	for {
		select {
		case <-ctx.Done():
			// Let in-flight jobs finish (ffmpeg runs have their own ctx
			// derived from the job context, which we cancel after draining).
			w.log.Info("worker draining in-flight jobs")
			time.Sleep(500 * time.Millisecond)
			return
		case <-staleTicker.C:
			if n, err := w.queue.RequeueStale(ctx, 3*time.Minute); err == nil && n > 0 {
				w.log.Info("requeued stale jobs", "count", n)
			}
		case <-heartbeatTicker.C:
			if err := w.queue.Heartbeat(ctx, w.workerID); err != nil {
				w.log.Warn("heartbeat", "err", err)
			}
		case <-pruneTicker.C:
			if err := analytics.Prune(ctx, w.runner.Pool, w.runner.Settings.Int("analytics.retention_days", 30)); err != nil {
				w.log.Warn("analytics prune", "err", err)
			}
		case <-cleanupTicker.C:
			if err := cleanupStaleUploads(ctx, w.runner.Pool, w.spoolDir); err != nil {
				w.log.Warn("upload cleanup", "err", err)
			}
		case <-pollTicker.C:
			w.claimRound(ctx, sem)
		}
	}
}

func (w *worker) claimRound(ctx context.Context, sem chan struct{}) {
	// Serialization is enforced in SQL (Queue.Claim): download jobs are only
	// claimable when none of their kind is running; transcode flavors are
	// ordered per entry. Queued jobs honestly show as 'In Queue' instead of
	// sitting 'running' behind a semaphore.
	jobs, err := w.queue.Claim(ctx, w.workerID, w.concurrency)
	if err != nil {
		w.log.Error("claim", "err", err)
		return
	}
	for _, j := range jobs {
		sem <- struct{}{} // block if pool is full
		go func(jobID int64, jobType string) {
			defer func() { <-sem }()
			w.runJob(ctx, jobID, jobType)
		}(j.ID, j.Type)
	}
}

func (w *worker) runJob(parent context.Context, jobID int64, jobType string) {
	jobCtx, cancel := context.WithTimeout(parent, 4*time.Hour)
	defer cancel()

	log := w.log.With("job", jobID, "type", jobType)
	job, err := w.queue.Get(jobCtx, jobID)
	if err != nil {
		log.Error("load job", "err", err)
		return
	}
	// Abort watcher: if the jobs page requests a cancel, cancel this job's
	// context — ffmpeg (CommandContext) and URL downloads (request ctx) die
	// immediately, and the partial flavor dir is cleaned by the handler.
	go func() {
		t := time.NewTicker(2 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-jobCtx.Done():
				return
			case <-t.C:
				req, err := w.queue.CancelRequested(jobCtx, jobID)
				if err == nil && req {
					log.Info("abort requested, cancelling job")
					cancel()
					return
				}
			}
		}
	}()

	log.Info("job started")
	if err := w.runner.Handle(jobCtx, job); err != nil {
		// Distinguish a user abort from a real failure: check the flag after
		// the handler returned (the watcher may have just fired).
		if req, reqErr := w.queue.CancelRequested(parent, jobID); reqErr == nil && req {
			log.Info("job cancelled")
			_ = w.queue.Cancel(parent, jobID, "cancelled by user")
			return
		}
		log.Error("job failed", "err", err)
		_ = w.queue.Fail(jobCtx, jobID, err.Error())
		return
	}
	if err := w.queue.Done(jobCtx, jobID); err != nil {
		log.Error("mark done", "err", err)
	}
	log.Info("job finished")
}
