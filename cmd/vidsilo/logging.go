package main

import (
	"io"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/parasetam0l/vidsilo/internal/logging"
)

// newSlog builds the JSON logger: stdout always, plus the in-process
// size-rotating file at DATA_DIR/logs/<file> when the data dir is writable.
// The returned cleanup closes the file.
func newSlog(file string) (*slog.Logger, func()) {
	var writers []io.Writer
	writers = append(writers, os.Stdout)

	var rot *logging.RotatingFile
	dataDir := os.Getenv("DATA_DIR")
	if dataDir == "" {
		dataDir = "/data"
	}
	if f, err := logging.NewRotatingFile(filepath.Join(dataDir, "logs", file)); err == nil {
		rot = f
		writers = append(writers, f)
	}

	logger := slog.New(slog.NewJSONHandler(io.MultiWriter(writers...), nil))
	return logger, func() {
		if rot != nil {
			_ = rot.Close()
		}
	}
}
