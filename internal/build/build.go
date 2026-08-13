// Package build holds the app version — the single source of truth.
// `vod-app version`, the admin sidebar, and the public headers all read it
// from here; bump it once per release.
package build

const Version = "0.1.0"
