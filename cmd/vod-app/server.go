package main

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
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

	// TLS_MODE: off = plain HTTP; letsencrypt = Let's Encrypt via autocert
	// (HTTP-01 on HTTP_PORT, HTTPS on HTTPS_PORT); selfsigned = locally
	// generated cert; files = TLS_CERT_FILE/TLS_KEY_FILE with a self-signed
	// fallback when they are missing or unreadable. Every TLS mode serves an
	// HTTP listener on HTTP_PORT that redirects to https (except /healthz)
	// and doubles as the ACME challenge endpoint.
	var servers []*http.Server
	switch cfg.TLSMode {
	case "letsencrypt":
		https, httpPlain := newAutoTLSServers(log, cfg, appHandler)
		servers = append(servers, https, httpPlain)
	case "selfsigned", "files":
		cert, err := serverTLSCertificate(cfg, log)
		if err != nil {
			log.Error("tls", "err", err)
			os.Exit(1)
		}
		https := &http.Server{
			Addr:              fmt.Sprintf(":%d", cfg.HTTPSPort),
			Handler:           appHandler,
			TLSConfig:         &tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS12},
			ReadHeaderTimeout: 10 * time.Second,
			IdleTimeout:       120 * time.Second,
		}
		servers = append(servers, https, plainServer(cfg.HTTPPort, newHTTPSRedirect(cfg)))
	default: // "off"
		servers = append(servers, plainServer(cfg.HTTPPort, appHandler))
	}

	for _, srv := range servers {
		srv := srv
		go func() {
			log.Info("listening", "addr", srv.Addr)
			var err error
			if srv.TLSConfig != nil {
				// Uses srv.TLSConfig (autocert manager or static certs).
				err = srv.ListenAndServeTLS("", "")
			} else {
				err = srv.ListenAndServe()
			}
			if err != nil && !errors.Is(err, http.ErrServerClosed) {
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

// newAutoTLSServers builds the autocert-managed HTTPS listener (HTTPS_PORT)
// and the HTTP listener (HTTP_PORT) that answers ACME challenges and
// redirects to https. Certs cache in TLS_CERT_DIR (default DATA_DIR/certs).
func newAutoTLSServers(log *slog.Logger, cfg *config.Config, app http.Handler) (https, httpPlain *http.Server) {
	domains := cfg.TLSDomains
	certDir := cfg.TLSCertDir
	m := &autocert.Manager{
		Prompt:     autocert.AcceptTOS,
		Cache:      autocert.DirCache(certDir),
		HostPolicy: autocert.HostWhitelist(domains...),
	}

	https = &http.Server{
		Addr:              fmt.Sprintf(":%d", cfg.HTTPSPort),
		Handler:           app,
		TLSConfig:         m.TLSConfig(),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	// HTTP: ACME challenges are answered by the manager; everything else
	// redirects to https (except /healthz so orchestrators keep working).
	httpPlain = plainServer(cfg.HTTPPort, m.HTTPHandler(newHTTPSRedirect(cfg)))
	log.Info("tls letsencrypt mode", "domains", domains, "cert_dir", certDir)
	return https, httpPlain
}

// serverTLSCertificate resolves the HTTPS serving certificate. In files mode
// the operator's TLS_CERT_FILE/TLS_KEY_FILE are used; when they are missing
// or unreadable the server logs a warning and falls back to a self-signed
// certificate so the service never refuses to start. Self-signed certs are
// generated once and cached in TLS_CERT_DIR for stable restarts.
func serverTLSCertificate(cfg *config.Config, log *slog.Logger) (tls.Certificate, error) {
	if cfg.TLSMode == "files" {
		cert, err := tls.LoadX509KeyPair(cfg.TLSCertFile, cfg.TLSKeyFile)
		if err == nil {
			log.Info("tls files mode", "cert_file", cfg.TLSCertFile)
			return cert, nil
		}
		log.Warn("tls files cert unreadable — falling back to self-signed", "err", err)
	}
	return loadOrCreateSelfSigned(log, cfg)
}

// loadOrCreateSelfSigned returns the cached self-signed certificate, or
// generates, persists and returns a fresh one (ECDSA P-256, 10-year validity,
// SANs covering localhost plus TLS_DOMAINS when set).
func loadOrCreateSelfSigned(log *slog.Logger, cfg *config.Config) (tls.Certificate, error) {
	if err := os.MkdirAll(cfg.TLSCertDir, 0o755); err != nil {
		return tls.Certificate{}, err
	}
	certPath := filepath.Join(cfg.TLSCertDir, "selfsigned.pem")
	keyPath := filepath.Join(cfg.TLSCertDir, "selfsigned-key.pem")
	if cert, err := tls.LoadX509KeyPair(certPath, keyPath); err == nil {
		log.Info("tls self-signed mode", "cert", certPath, "cached", true)
		return cert, nil
	}

	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return tls.Certificate{}, err
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return tls.Certificate{}, err
	}
	tmpl := x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: "vod-app self-signed"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().AddDate(10, 0, 0),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment | x509.KeyUsageCertSign,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		DNSNames:              append([]string{"localhost"}, cfg.TLSDomains...),
		IPAddresses:           []net.IP{net.ParseIP("127.0.0.1"), net.ParseIP("::1")},
	}
	der, err := x509.CreateCertificate(rand.Reader, &tmpl, &tmpl, &key.PublicKey, key)
	if err != nil {
		return tls.Certificate{}, err
	}
	keyDER, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		return tls.Certificate{}, err
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER})
	if err := os.WriteFile(certPath, certPEM, 0o644); err != nil {
		return tls.Certificate{}, err
	}
	if err := os.WriteFile(keyPath, keyPEM, 0o600); err != nil {
		return tls.Certificate{}, err
	}
	cert, err := tls.X509KeyPair(certPEM, keyPEM)
	if err != nil {
		return tls.Certificate{}, err
	}
	log.Info("tls self-signed mode", "cert", certPath, "cached", false)
	return cert, nil
}

// plainServer is an HTTP listener with sane timeouts.
func plainServer(port int, h http.Handler) *http.Server {
	return &http.Server{
		Addr:              fmt.Sprintf(":%d", port),
		Handler:           h,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
}

// newHTTPSRedirect redirects plain-HTTP requests to https, keeping the host.
// A port is stripped when it is the HTTP port (or 80 — the Docker host-port
// mapping), and HTTPS_PUBLIC_PORT is appended when it is not 443. /healthz
// is answered directly so orchestrators keep working.
func newHTTPSRedirect(cfg *config.Config) http.HandlerFunc {
	httpPort := strconv.Itoa(cfg.HTTPPort)
	return func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/healthz" {
			w.WriteHeader(http.StatusOK)
			return
		}
		host := r.Host
		if h, p, err := net.SplitHostPort(host); err == nil && (p == httpPort || p == "80") {
			host = h
		}
		if cfg.HTTPSPublicPort != 443 {
			host = net.JoinHostPort(host, strconv.Itoa(cfg.HTTPSPublicPort))
		}
		http.Redirect(w, r, "https://"+host+r.URL.RequestURI(), http.StatusMovedPermanently)
	}
}

func errStr(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}
