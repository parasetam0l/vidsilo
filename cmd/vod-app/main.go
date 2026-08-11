// Command vod-app is the single binary: server | worker | migrate | version.
package main

import (
	"fmt"
	"os"
)

const version = "0.1.0"

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
		fmt.Println(version)
	default:
		usage()
		os.Exit(2)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, `vod-app - self-hosted VOD platform

Usage:
  vod-app server       run the HTTP server (API + UI + media)
  vod-app worker       run the transcode worker (probe + transcode jobs)
  vod-app migrate      migrate media between storage drivers
  vod-app reset-admin  rotate the admin password and print it once
  vod-app version      print the version

Environment:
  DATABASE_URL      postgres connection string (required)
  DATA_DIR          media storage root, default /data
  STORAGE_DRIVER    local (default) or s3
  S3_*              endpoint, bucket, credentials, region (s3 driver)
  PORT              http listen port, default 8080`)
}
