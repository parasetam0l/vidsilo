package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/parasetam0l/vod-app/internal/api"
	"github.com/parasetam0l/vod-app/internal/analytics"
	"github.com/parasetam0l/vod-app/internal/config"
	"github.com/parasetam0l/vod-app/internal/db"
	"github.com/parasetam0l/vod-app/internal/media"
	"github.com/parasetam0l/vod-app/internal/queue"
	"github.com/parasetam0l/vod-app/internal/secrets"
	"github.com/parasetam0l/vod-app/internal/settings"
	"github.com/parasetam0l/vod-app/internal/store"
	"github.com/parasetam0l/vod-app/internal/ui"
	"golang.org/x/crypto/acme/autocert"
	"github.com/parasetam0l/vod-app/internal/upload"
)

func cmdServer(args []string) {
	log, closeLog := newSlog("vod-app.log")
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
	go svc.Run(ctx, 0) // multi-node propagation: pick up panel changes from other app nodes

	secret, err := secrets.LoadOrCreate(filepath.Join(cfg.DataDir, "secret.key"))
	if err != nil {
		log.Error("secrets", "err", err)
		os.Exit(1)
	}

	mediaStore, err := buildStore(cfg, svc)
	if err != nil {
		log.Error("storage", "err", err)
		os.Exit(1)
	}
	_ = mediaStore

	uiFS, err := ui.FS()
	if err != nil {
		log.Error("embedded ui missing", "err", err)
		os.Exit(1)
	}

	q := queue.New(pool)
	ds := &upload.DataStore{
		Pool:     pool,
		Store:    mediaStore,
		Queue:    q,
		Settings: svc,
		Log:      log,
		SpoolDir: filepath.Join(cfg.DataDir, "uploads"),
	}
	if err := os.MkdirAll(ds.SpoolDir, 0o755); err != nil {
		log.Error("spool dir", "err", err)
		os.Exit(1)
	}
	mediaMgr := &media.Manager{Store: mediaStore}

	acc := analytics.New(pool,
		svc.Bool("analytics.enabled", true),
		time.Duration(svc.Int("analytics.flush_interval_s", 10))*time.Second,
		log)
	go acc.Run(ctx)

	srv := api.NewServer(log, uiFS, pool, secret, mediaStore, svc, q, mediaMgr, ds, acc)
	srv.SetHealth(func() []api.HealthCheck {
		checks := []api.HealthCheck{
			{Name: "db", OK: db.Health(ctx, pool) == nil, Err: errStr(db.Health(ctx, pool))},
		}
		// Storage reachability: a probe key that does not exist still proves
		// the driver answers (any error other than ErrNotFound means down).
		_, serr := mediaStore.Stat(ctx, "healthz.probe")
		storageOK := errors.Is(serr, store.ErrNotFound) || serr == nil
		storageErr := ""
		if !storageOK {
			storageErr = errStr(serr)
		}
		checks = append(checks, api.HealthCheck{
			Name: "storage",
			OK:   storageOK,
			Err:  storageErr,
		})
		return checks
	})

	appHandler := srv.Handler()

	// tls.mode=auto: Let's Encrypt via autocert (HTTP-01 on cfg.Port,
	// HTTPS on :443, HTTP->HTTPS redirect); off: plain HTTP.
	var servers []*http.Server
	if svc.String("tls.mode", "off") == "auto" {
		https, httpPlain, err := newAutoTLSServers(log, cfg, svc, appHandler)
		if err != nil {
			log.Error("tls", "err", err)
			os.Exit(1)
		}
		servers = append(servers, https, httpPlain)
	} else {
		servers = append(servers, &http.Server{
			Addr:              fmt.Sprintf(":%d", cfg.Port),
			Handler:           appHandler,
			ReadHeaderTimeout: 10 * time.Second,
			IdleTimeout:       120 * time.Second,
		})
	}

	for _, srv := range servers {
		srv := srv
		go func() {
			log.Info("listening", "addr", srv.Addr)
			if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
				log.Error("server failed", "err", err)
				stop()
			}
		}()
	}

	<-ctx.Done()
	log.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	for _, srv := range servers {
		if err := srv.Shutdown(shutdownCtx); err != nil {
			log.Error("graceful shutdown failed", "addr", srv.Addr, "err", err)
		}
	}
}

// newAutoTLSServers builds the autocert-managed HTTPS listener (:443) and the
// HTTP listener (cfg.Port) that answers ACME challenges and redirects to
// https. Certs cache in tls.cert_dir.
func newAutoTLSServers(log *slog.Logger, cfg *config.Config, svc *settings.Service, app http.Handler) (https, httpPlain *http.Server, err error) {
	domains := svc.StringSlice("tls.acme_domains", nil)
	if len(domains) == 0 {
		return nil, nil, errors.New("tls.mode=auto requires tls.acme_domains (public DNS + ports 80/443)")
	}
	certDir := svc.String("tls.cert_dir", filepath.Join(cfg.DataDir, "certs"))
	m := &autocert.Manager{
		Prompt:     autocert.AcceptTOS,
		Cache:      autocert.DirCache(certDir),
		HostPolicy: autocert.HostWhitelist(domains...),
	}

	https = &http.Server{
		Addr:              ":443",
		Handler:           app,
		TLSConfig:         m.TLSConfig(),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	// HTTP: ACME challenges are answered by the manager; everything else
	// redirects to https (except /healthz so orchestrators keep working).
	httpPlain = &http.Server{
		Addr:              fmt.Sprintf(":%d", cfg.Port),
		Handler:           m.HTTPHandler(http.HandlerFunc(redirectToHTTPS)),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	log.Info("tls auto mode", "domains", domains, "cert_dir", certDir)
	return https, httpPlain, nil
}

func redirectToHTTPS(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/healthz" {
		w.WriteHeader(http.StatusOK)
		return
	}
	http.Redirect(w, r, "https://"+r.Host+r.URL.RequestURI(), http.StatusMovedPermanently)
}

func errStr(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}
