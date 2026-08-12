// Package config parses the minimal env surface. Everything else is
// panel-managed via the settings table; secrets stay env-only.
package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// TLS modes: off = plain HTTP; letsencrypt = autocert ACME on :443;
// selfsigned = locally generated cert; files = TLS_CERT_FILE/TLS_KEY_FILE
// with a self-signed fallback when they are missing or unreadable.
var tlsModes = map[string]bool{"off": true, "letsencrypt": true, "selfsigned": true, "files": true}

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

	Port int // DEPRECATED: alias for HTTP_PORT

	// HTTPPort is the plain-HTTP listener: serves the app when TLS is off,
	// ACME challenges + the HTTP->HTTPS redirect in TLS modes.
	// Default 80 (bare metal). Docker maps host:80 -> container HTTP_PORT.
	HTTPPort int
	// HTTPSPort is the TLS listener (letsencrypt/selfsigned/files modes).
	// Default 443 (bare metal). Docker maps host:443 -> container HTTPS_PORT
	// (8443 by default).
	HTTPSPort int
	// HTTPSPublicPort is the port users type in the browser, used in
	// HTTP->HTTPS redirect targets. Default 443; set to HTTPS_PORT when
	// HTTPS is served on a non-standard public port.
	HTTPSPublicPort int

	TLSMode     string
	TLSDomains  []string
	TLSCertFile string
	TLSKeyFile  string
	TLSCertDir  string
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
		Port:               getenvInt("PORT", 80),
		HTTPPort:           getenvIntFirst("HTTP_PORT", "PORT", 80),
		HTTPSPort:          getenvInt("HTTPS_PORT", 443),
		HTTPSPublicPort:    getenvInt("HTTPS_PUBLIC_PORT", 443),
		TLSMode:            getenv("TLS_MODE", "off"),
		TLSDomains:         splitEnv("TLS_DOMAINS"),
		TLSCertFile:        os.Getenv("TLS_CERT_FILE"),
		TLSKeyFile:         os.Getenv("TLS_KEY_FILE"),
		TLSCertDir:         getenv("TLS_CERT_DIR", filepath.Join(getenv("DATA_DIR", "/data"), "certs")),
	}
	if !tlsModes[c.TLSMode] {
		return nil, fmt.Errorf("TLS_MODE must be one of off, letsencrypt, selfsigned, files; got %q", c.TLSMode)
	}
	if c.TLSMode == "letsencrypt" && len(c.TLSDomains) == 0 {
		return nil, fmt.Errorf("TLS_MODE=letsencrypt requires TLS_DOMAINS (public DNS + ports 80/443)")
	}
	if c.TLSMode == "files" && (c.TLSCertFile == "" || c.TLSKeyFile == "") {
		return nil, fmt.Errorf("TLS_MODE=files requires TLS_CERT_FILE and TLS_KEY_FILE")
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

// getenvIntFirst reads the first set variable, falling back to def.
func getenvIntFirst(primary, secondary string, def int) int {
	if v := os.Getenv(primary); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return getenvInt(secondary, def)
}

// splitEnv parses a comma/space-separated env list.
func splitEnv(key string) []string {
	var out []string
	for _, part := range strings.FieldsFunc(os.Getenv(key), func(r rune) bool {
		return r == ',' || r == ' ' || r == '\t'
	}) {
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}
