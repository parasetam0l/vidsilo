// Package logging provides an in-process size-rotating file writer: JSON logs
// go to stdout AND to DATA_DIR/logs/vidsilo.log (10 MB × 5 files), with the
// same behavior on Docker and bare metal.
package logging

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

const (
	MaxBytes = 10 << 20 // 10 MiB per file
	Backups  = 5        // log, log.1 .. log.4
)

type RotatingFile struct {
	mu      sync.Mutex
	path    string
	max     int64
	backups int
	file    *os.File
	size    int64
}

// NewRotatingFile opens (creating if needed) the log file at path.
func NewRotatingFile(path string) (*RotatingFile, error) {
	r := &RotatingFile{path: path, max: MaxBytes, backups: Backups}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	if err := r.open(); err != nil {
		return nil, err
	}
	return r, nil
}

func (r *RotatingFile) open() error {
	f, err := os.OpenFile(r.path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	st, err := f.Stat()
	if err != nil {
		f.Close()
		return err
	}
	r.file = f
	r.size = st.Size()
	return nil
}

// Write implements io.Writer, rotating when the current file is full.
func (r *RotatingFile) Write(p []byte) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.size+int64(len(p)) > r.max {
		if err := r.rotate(); err != nil {
			return 0, err
		}
	}
	n, err := r.file.Write(p)
	r.size += int64(n)
	return n, err
}

func (r *RotatingFile) rotate() error {
	if r.file != nil {
		r.file.Close()
		r.file = nil
	}
	// Shift backups: log.3 -> log.4, log.2 -> log.3, ..., log -> log.1.
	for i := r.backups - 1; i >= 1; i-- {
		from := fmt.Sprintf("%s.%d", r.path, i)
		to := fmt.Sprintf("%s.%d", r.path, i+1)
		if _, err := os.Stat(from); err == nil {
			_ = os.Remove(to)
			_ = os.Rename(from, to)
		}
	}
	_ = os.Remove(r.path + ".1")
	_ = os.Rename(r.path, r.path+".1")
	return r.open()
}

func (r *RotatingFile) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.file != nil {
		err := r.file.Close()
		r.file = nil
		return err
	}
	return nil
}
