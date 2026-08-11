package main

import (
	"context"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/parasetam0l/vod-app/internal/config"
	"github.com/parasetam0l/vod-app/internal/store"
)

// cmdMigrate streams media from a source store into the currently configured
// store (env config), preserving keys. Source keys are removed with --prune.
func cmdMigrate(args []string) {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(log)

	fs := flag.NewFlagSet("migrate", flag.ExitOnError)
	sourceDriver := fs.String("source-driver", "", "source driver: local or s3")
	sourceDataDir := fs.String("source-data-dir", "", "source data dir (local driver)")
	sourceEndpoint := fs.String("source-endpoint", "", "source S3 endpoint")
	sourceBucket := fs.String("source-bucket", "", "source S3 bucket")
	sourceAccessKey := fs.String("source-access-key", "", "source S3 access key")
	sourceSecretKey := fs.String("source-secret-key", "", "source S3 secret key")
	sourceRegion := fs.String("source-region", "us-east-1", "source S3 region")
	prune := fs.Bool("prune", false, "delete source keys after verified copy")
	force := fs.Bool("force", false, "overwrite existing target keys")
	workers := fs.Int("workers", 4, "parallel copy workers")
	fs.Parse(args)

	if *sourceDriver != "local" && *sourceDriver != "s3" {
		log.Error("--source-driver must be 'local' or 's3'")
		os.Exit(2)
	}
	cfg, err := config.Load()
	if err != nil {
		log.Error("invalid target config", "err", err)
		os.Exit(1)
	}

	var src store.Store
	if *sourceDriver == "local" {
		if *sourceDataDir == "" {
			log.Error("--source-data-dir is required for the local driver")
			os.Exit(2)
		}
		src, err = store.NewLocal(*sourceDataDir)
	} else {
		if *sourceBucket == "" {
			log.Error("--source-bucket is required for the s3 driver")
			os.Exit(2)
		}
		src, err = store.NewS3(store.S3Params{
			Endpoint:  *sourceEndpoint,
			Bucket:    *sourceBucket,
			AccessKey: *sourceAccessKey,
			SecretKey: *sourceSecretKey,
			Region:    *sourceRegion,
		})
	}
	if err != nil {
		log.Error("source store", "err", err)
		os.Exit(1)
	}
	dst, err := buildStore(cfg, nil)
	if err != nil {
		log.Error("target store", "err", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	log.Info("migrating media", "driver", *sourceDriver, "workers", *workers, "prune", *prune)
	res, err := store.Migrate(ctx, src, dst, store.MigrateOptions{
		Workers: *workers,
		Force:   *force,
		Prune:   *prune,
	})
	if err != nil {
		log.Error("migrate failed", "err", err)
		os.Exit(1)
	}
	log.Info("migrate complete", "copied", res.Copied, "skipped", res.Skipped, "failed", res.Failed)
	if res.Failed > 0 {
		os.Exit(1)
	}
}
