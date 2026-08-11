// Package safeurl validates outbound URLs for the URL-import feature,
// guarding against SSRF: only http(s) schemes are allowed and the resolved
// host must be a public address (loopback, private, link-local and
// unspecified ranges are rejected).
package safeurl

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"
)

var ErrUnsafe = errors.New("url is not allowed")

// Validate checks scheme and resolves the host to ensure it is public.
func Validate(ctx context.Context, raw string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return nil, fmt.Errorf("invalid url: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, fmt.Errorf("%w: only http/https urls are allowed", ErrUnsafe)
	}
	if u.Hostname() == "" {
		return nil, fmt.Errorf("%w: missing host", ErrUnsafe)
	}
	ips, err := net.DefaultResolver.LookupIPAddr(ctx, u.Hostname())
	if err != nil {
		return nil, fmt.Errorf("cannot resolve host: %w", err)
	}
	for _, ip := range ips {
		if !publicIP(ip.IP) {
			return nil, fmt.Errorf("%w: %s resolves to a non-public address", ErrUnsafe, u.Hostname())
		}
	}
	return u, nil
}

func publicIP(ip net.IP) bool {
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() || ip.IsUnspecified() || ip.IsMulticast() {
		return false
	}
	return true
}

// Client returns an http.Client that re-validates every redirect hop
// against the SSRF rules (a redirect to a private address is rejected).
func Client() *http.Client {
	return &http.Client{
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if _, err := Validate(context.Background(), req.URL.String()); err != nil {
				return err
			}
			if len(via) >= 5 {
				return errors.New("too many redirects")
			}
			return nil
		},
	}
}

var userAgent = "Mozilla/5.0 (compatible; vod-app/0.1)"

// contentTypeExt maps common video content types to file extensions.
var contentTypeExt = map[string]string{
	"video/mp4":        "mp4",
	"video/mp4v-es":    "mp4",
	"video/x-m4v":      "m4v",
	"video/quicktime":  "mov",
	"video/x-matroska": "mkv",
	"video/webm":       "webm",
	"video/x-msvideo":  "avi",
	"video/3gpp":       "3gp",
	"video/x-flv":      "flv",
}

// Resolve follows the URL (redirects included, each hop SSRF-checked) to
// discover the real file type. It returns the final URL and a suggested
// extension derived from the final path, the response Content-Type, or a
// magic-byte sniff of the content (octet-stream servers). Bounded by
// timeout. A ranged GET is used instead of HEAD — some video servers hang
// or reject HEAD requests.
func Resolve(ctx context.Context, client *http.Client, raw string, timeout time.Duration) (*url.URL, string, error) {
	u, err := Validate(ctx, raw)
	if err != nil {
		return nil, "", err
	}
	probeCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(probeCtx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Range", "bytes=0-4095")
	resp, err := client.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	head := make([]byte, 0, 4096)
	buf := make([]byte, 4096)
	if n, _ := io.ReadFull(resp.Body, buf); n > 0 {
		head = buf[:n]
	}
	return resolveFrom(resp.Request.URL, resp.Header.Get("Content-Type"), head)
}

// ResolveExt is Resolve returning only the discovered extension.
func ResolveExt(ctx context.Context, client *http.Client, raw string, timeout time.Duration) (string, error) {
	_, ext, err := Resolve(ctx, client, raw, timeout)
	return ext, err
}

func resolveFrom(final *url.URL, contentType string, head []byte) (*url.URL, string, error) {
	ext := strings.ToLower(strings.TrimPrefix(path.Ext(final.Path), "."))
	if ext != "" {
		return final, ext, nil
	}
	if contentType != "" {
		t := strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
		if e, ok := contentTypeExt[t]; ok {
			return final, e, nil
		}
	}
	if e := sniffExt(head); e != "" {
		return final, e, nil
	}
	return final, "", errors.New("cannot determine file type from url, content-type or content")
}

// sniffExt detects the container from magic bytes: MP4/MOV (ftyp box),
// Matroska/WebM (EBML), AVI (RIFF).
func sniffExt(b []byte) string {
	if len(b) >= 12 && string(b[4:8]) == "ftyp" {
		if len(b) >= 12 && string(b[8:12]) == "qt  " {
			return "mov"
		}
		return "mp4"
	}
	if len(b) >= 4 && b[0] == 0x1A && b[1] == 0x45 && b[2] == 0xDF && b[3] == 0xA3 {
		if bytes.Contains(b, []byte("webm")) {
			return "webm"
		}
		return "mkv"
	}
	if len(b) >= 12 && string(b[0:4]) == "RIFF" && string(b[8:12]) == "AVI " {
		return "avi"
	}
	return ""
}
