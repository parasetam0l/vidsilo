package main

import (
	"fmt"
	"path/filepath"

	"github.com/parasetam0l/vod-app/internal/config"
	"github.com/parasetam0l/vod-app/internal/settings"
	"github.com/parasetam0l/vod-app/internal/store"
)

// buildStore constructs the configured storage driver. For the s3 driver the
// local disk LRU cache is wrapped when cache.enabled (settings); svc may be
// nil (migrate mode) to skip the wrap. When a fallback store is configured
// (migration source), the primary is wrapped read-through so misses are
// served from the legacy store and lazily promoted.
func buildStore(cfg *config.Config, svc *settings.Service) (store.Store, error) {
	primary, err := buildPrimaryStore(cfg, svc)
	if err != nil {
		return nil, err
	}
	if cfg.FallbackDriver == "" {
		return primary, nil
	}
	legacy, err := buildLegacyStore(cfg)
	if err != nil {
		return nil, fmt.Errorf("fallback store: %w", err)
	}
	return store.NewFallback(primary, legacy), nil
}

func buildPrimaryStore(cfg *config.Config, svc *settings.Service) (store.Store, error) {
	switch cfg.StorageDriver {
	case "local":
		return store.NewLocal(cfg.DataDir)
	case "s3":
		base, err := store.NewS3(store.S3Params{
			Endpoint:  cfg.S3Endpoint,
			Bucket:    cfg.S3Bucket,
			AccessKey: cfg.S3AccessKey,
			SecretKey: cfg.S3SecretKey,
			Region:    cfg.S3Region,
		})
		if err != nil {
			return nil, err
		}
		if svc != nil && svc.Bool("cache.enabled", false) {
			maxBytes := svc.Int64("cache.max_bytes", 1<<30)
			return store.NewCache(base, filepath.Join(cfg.DataDir, "cache"), maxBytes)
		}
		return base, nil
	default:
		return nil, fmt.Errorf("unknown storage driver %q", cfg.StorageDriver)
	}
}

// buildLegacyStore builds the fallback (migration source) store. It is never
// cached and never receives new writes.
func buildLegacyStore(cfg *config.Config) (store.Store, error) {
	switch cfg.FallbackDriver {
	case "local":
		if cfg.FallbackDataDir == "" {
			return nil, fmt.Errorf("FALLBACK_DATA_DIR is required for the local fallback driver")
		}
		return store.NewLocal(cfg.FallbackDataDir)
	case "s3":
		return store.NewS3(store.S3Params{
			Endpoint:  cfg.FallbackS3Endpoint,
			Bucket:    cfg.FallbackS3Bucket,
			AccessKey: cfg.FallbackS3Access,
			SecretKey: cfg.FallbackS3Secret,
			Region:    cfg.FallbackS3Region,
		})
	default:
		return nil, fmt.Errorf("unknown fallback storage driver %q", cfg.FallbackDriver)
	}
}
