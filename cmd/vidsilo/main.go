// Command vidsilo is the single binary: server | worker | migrate | version.
package main

import (
	"fmt"
	"os"

	"github.com/parasetam0l/vidsilo/internal/build"
)

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	switch os.Args[1] {
	case "server":
		cmdServer(os.Args[2:])
	case "worker":
		cmdWorker(os.Args[2:])
	case "migrate":
		cmdMigrate(os.Args[2:])
	case "reset-admin":
		cmdResetAdmin(os.Args[2:])
	case "version":
		fmt.Println(build.Version)
	default:
		usage()
		os.Exit(2)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, `vidsilo - self-hosted Vidsilo platform

Usage:
  vidsilo server       run the HTTP server (API + UI + media)
  vidsilo worker       run the transcode worker (probe + transcode jobs)
  vidsilo migrate      migrate media between storage drivers
  vidsilo reset-admin  rotate the admin password and print it once
  vidsilo version      print the version

Environment:
  DATABASE_URL      postgres connection string (required)
  DATA_DIR          media storage root, default /data
  STORAGE_DRIVER    local (default) or s3
  S3_*              endpoint, bucket, credentials, region (s3 driver)
  PORT              http listen port (alias for HTTP_PORT), default 80
  HTTP_PORT         plain-HTTP listener, default 80 (docker: 8080)
  HTTPS_PORT        TLS listener, default 443 (docker: 8443)
  HTTPS_PUBLIC_PORT port used in HTTP->HTTPS redirect targets, default 443
  TLS_MODE          off | letsencrypt | selfsigned | files`)
}
