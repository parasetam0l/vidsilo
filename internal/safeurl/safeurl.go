// Package safeurl validates outbound URLs for the URL-import feature,
// guarding against SSRF: only http(s) schemes are allowed and the resolved
// host must be a public address (loopback, private, link-local and
// unspecified ranges are rejected).
package safeurl

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/url"
	"strings"
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
