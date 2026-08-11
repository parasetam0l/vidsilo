// Package config parses the minimal env surface. Everything else is
// panel-managed via the settings table; secrets stay env-only.
package config

import (
	"fmt"
	"os"
	"strconv"
)

type Config struct {
	DatabaseURL string
	DataDir     string

	StorageDriver string
	S3Endpoint    string
	S3Bucket      string
	S3AccessKey   string
	S3SecretKey   string
	S3Region      string

	// Fallback* configure a read-through legacy store: reads that miss the
	// primary are served from here and lazily copied into the primary
	// (zero-downtime storage migration). Empty FallbackDriver disables it.
	FallbackDriver     string
	FallbackDataDir    string
	FallbackS3Endpoint string
	FallbackS3Bucket   string
	FallbackS3Access   string
	FallbackS3Secret   string
	FallbackS3Region   string

	Port int
}

func Load() (*Config, error) {
	c := &Config{
		DatabaseURL:        os.Getenv("DATABASE_URL"),
		DataDir:            getenv("DATA_DIR", "/data"),
		StorageDriver:      getenv("STORAGE_DRIVER", "local"),
		S3Endpoint:         os.Getenv("S3_ENDPOINT"),
		S3Bucket:           os.Getenv("S3_BUCKET"),
		S3AccessKey:        os.Getenv("S3_ACCESS_KEY"),
		S3SecretKey:        os.Getenv("S3_SECRET_KEY"),
		S3Region:           getenv("S3_REGION", "us-east-1"),
		FallbackDriver:     os.Getenv("FALLBACK_STORAGE_DRIVER"),
		FallbackDataDir:    os.Getenv("FALLBACK_DATA_DIR"),
		FallbackS3Endpoint: os.Getenv("FALLBACK_S3_ENDPOINT"),
		FallbackS3Bucket:   os.Getenv("FALLBACK_S3_BUCKET"),
		FallbackS3Access:   os.Getenv("FALLBACK_S3_ACCESS_KEY"),
		FallbackS3Secret:   os.Getenv("FALLBACK_S3_SECRET_KEY"),
		FallbackS3Region:   getenv("FALLBACK_S3_REGION", "us-east-1"),
		Port:               getenvInt("PORT", 8080),
	}
	if c.StorageDriver != "local" && c.StorageDriver != "s3" {
		return nil, fmt.Errorf("STORAGE_DRIVER must be 'local' or 's3', got %q", c.StorageDriver)
	}
	if c.StorageDriver == "s3" {
		if c.S3Endpoint == "" || c.S3Bucket == "" || c.S3AccessKey == "" || c.S3SecretKey == "" {
			return nil, fmt.Errorf("S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY and S3_SECRET_KEY are required for the s3 driver")
		}
	}
	if c.FallbackDriver != "" {
		if c.FallbackDriver != "local" && c.FallbackDriver != "s3" {
			return nil, fmt.Errorf("FALLBACK_STORAGE_DRIVER must be 'local' or 's3', got %q", c.FallbackDriver)
		}
		if c.FallbackDriver == "s3" {
			if c.FallbackS3Endpoint == "" || c.FallbackS3Bucket == "" || c.FallbackS3Access == "" || c.FallbackS3Secret == "" {
				return nil, fmt.Errorf("FALLBACK_S3_ENDPOINT, FALLBACK_S3_BUCKET, FALLBACK_S3_ACCESS_KEY and FALLBACK_S3_SECRET_KEY are required for the s3 fallback driver")
			}
		}
	}
	return c, nil
}

// CheckServer validates that everything the server/worker modes need is set.
func (c *Config) CheckServer() error {
	if c.DatabaseURL == "" {
		return fmt.Errorf("DATABASE_URL is required")
	}
	return nil
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func getenvInt(key string, def int) int {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}
