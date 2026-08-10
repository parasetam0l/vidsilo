// Package ui embeds the statically exported web app. In production the
// Dockerfile copies web/out over the placeholder before go build.
package ui

import (
	"embed"
	"io/fs"
)

//go:embed web/out
//go:embed web/out/_next
var Files embed.FS

// FS returns the embedded static files rooted at the export directory.
func FS() (fs.FS, error) {
	return fs.Sub(Files, "web/out")
}
