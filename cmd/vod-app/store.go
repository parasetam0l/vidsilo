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
// nil (migrate mode) to skip the wrap.
func buildStore(cfg *config.Config, svc *settings.Service) (store.Store, error) {
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
