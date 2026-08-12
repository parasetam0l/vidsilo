package api

import (
	"encoding/json"
	"testing"
)

func TestProxiedPlayerConfig(t *testing.T) {
	cfg := json.RawMessage(`{
		"accentColor": "#ff5500",
		"logoUrl": "https://example.com/logo.png?v=1.0",
		"logoSize": 64
	}`)
	out := proxiedPlayerConfig(cfg)
	var m map[string]any
	if err := json.Unmarshal(out, &m); err != nil {
		t.Fatal(err)
	}
	want := "/media/branding/logo?url=https%3A%2F%2Fexample.com%2Flogo.png%3Fv%3D1.0"
	if m["logoUrl"] != want {
		t.Fatalf("logoUrl = %q, want %q", m["logoUrl"], want)
	}
	if m["accentColor"] != "#ff5500" || m["logoSize"] != float64(64) {
		t.Fatalf("other keys clobbered: %v", m)
	}

	// No logo: unchanged.
	plain := json.RawMessage(`{"accentColor":"#fff"}`)
	if got := proxiedPlayerConfig(plain); string(got) != string(plain) {
		t.Fatalf("config without logo changed: %s", got)
	}

	// Non-https logo: left untouched (proxy rejects it at serve time).
	httpLogo := json.RawMessage(`{"logoUrl":"http://example.com/x.png"}`)
	if got := proxiedPlayerConfig(httpLogo); string(got) != string(httpLogo) {
		t.Fatalf("http logo was rewritten: %s", got)
	}
}
