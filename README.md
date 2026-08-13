# Vidsilo

Self-hosted video on demand. Upload, transcode and privately share videos
with your own branded player — no third-party platform.

- **Upload anything** — resumable tus uploads, URL import, configurable size/extension limits
- **Transcode in place** — HLS streaming with adaptive quality, poster + sprite thumbnails, subtitles (WebVTT)
- **Private by design** — per-entry embed ACLs (domain whitelist/blocklist), public/private visibility, viewer accounts for your library
- **Your brand** — site name, player designs (accent color, logo watermark, loader), language selector
- **Self-contained** — one Go binary with an embedded UI; runs on Docker, bare metal, or Kubernetes; Postgres + local disk or S3
- **No telemetry, no external services** — everything runs on your hardware (except Let's Encrypt if you opt in)

## Quickstart

The fastest path is the install wizard (Ubuntu LTS):

```bash
git clone https://github.com/parasetam0l/vidsilo.git
cd vidsilo
sudo sh deploy/install.sh
```

It asks how you want to install — **Single server** (bare metal or Docker) or
**High availability** (bare metal components or Kubernetes) — then sets
everything up. See [INSTALL.md](INSTALL.md) for the full flow.

Manual Docker:

```bash
cp .env.example .env          # or: ./deploy/gen-env.sh (generates secrets)
docker compose up -d --build
```

First-run admin password is logged once:

```bash
docker compose logs app | grep 'First-run admin'
```

## Features

| Area | What you get |
|---|---|
| Upload | Drag & drop, tus resumable (survives refreshes), URL download import, per-role uploaders |
| Pipeline | Probe → poster/sprite → parallel per-entry transcodes, pause/cancel/retry, job queue with heartbeat reclaim |
| Playback | Adaptive HLS, quality selector, sprite scrubber, subtitles, speed, PiP, keyboard/touch controls |
| Player designs | Accent color, logo watermark (position/size/opacity), loading spinner, control auto-hide; per-entry selection |
| Library | Public catalog with search/sort/categories, viewer sign-in, or fully disabled |
| Sharing | Direct links, embeddable iframe with per-domain ACLs, `?t=` start-time deep links |
| Admin | Dashboard, entries, jobs, users/viewers, categories, flavors, domain ACLs, players, storage, analytics with date ranges, audit trail |
| Security | argon2id passwords, short-lived JWTs + refresh rotation, login lockout, rate limiting (proxy-aware), audit log, noindex by default |

## Architecture

```
web/ (Next.js static export) ─┐
                              ├─ embedded into ─► vod-app (single Go binary)
internal/ (api, queue, store) ─┘
        │
        ├── Postgres: catalog, users, jobs, analytics
        └── Storage: local disk (DATA_DIR) or S3/MinIO (with LRU cache)

vod-app server  — API + UI + media streaming (HLS, range requests)
vod-app worker  — queue consumer: probe, transcode, downloads
```

Horizontal scale: add app/worker nodes against the same Postgres + shared
storage (S3 recommended; NFS works). See INSTALL.md → High availability.

## Configuration

Everything is environment-driven; the admin panel covers the rest.

| Env | Purpose | Default |
|---|---|---|
| `DATABASE_URL` | Postgres connection (required) | — |
| `DATA_DIR` | Local media root (also `secret.key`, certs) | `/data` |
| `STORAGE_DRIVER` | `local` or `s3` | `local` |
| `S3_ENDPOINT` / `S3_BUCKET` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` / `S3_REGION` | S3/MinIO | — |
| `FALLBACK_STORAGE_DRIVER` + `FALLBACK_*` | read-through legacy store for zero-downtime migration | — |
| `HTTP_PORT` / `HTTPS_PORT` / `HTTPS_PUBLIC_PORT` | listeners (bare metal 80/443, Docker 8080/8443) | — |
| `TLS_MODE` | `off` / `letsencrypt` / `selfsigned` / `files` | `off` |
| `TLS_DOMAINS` | Let's Encrypt domains | — |
| `TLS_CERT_FILE` / `TLS_KEY_FILE` / `TLS_CERT_DIR` | custom certs | — |
| `TRUSTED_PROXIES` | CIDRs allowed to set `X-Forwarded-For` (rate limiting) | empty (XFF ignored) |
| `PORT` | deprecated alias for `HTTP_PORT` | — |

Full env reference: [deploy/env.example](deploy/env.example).

## Operations

- **Backups**: `deploy/backup.sh` (catalog dump + optional media tarball); restore = dump → media → start. Docker users get an optional cron from the install wizard.
- **Admin password**: first-run is logged once; rotate anytime with `vod-app reset-admin`.
- **Upgrades**: Docker — `docker compose pull && docker compose up -d`; bare metal — replace the binary and `systemctl restart vod-app vod-worker`.
- **Storage migration**: `vod-app migrate --source-driver=local --source-data-dir=/old/data [--prune]`, or lazy zero-downtime promotion via `FALLBACK_STORAGE_DRIVER`.

## Security

Private platform posture: nothing is indexed (robots.txt + `noindex` + `X-Robots-Tag`),
argon2id hashing, opaque refresh tokens with rotation and theft-revocation,
login lockout, token-bucket rate limiting with trusted-proxy support, SSRF-guarded
media imports, parameterized SQL, path-traversal-safe keys, CSP/hardening headers,
and an audit trail for admin mutations.

## Development

```bash
docker compose up -d db          # Postgres 17 on :5432
cd web && npm run dev            # Next dev server (proxies /api to :8090)
go run ./cmd/vod-app server      # backend on :8090
```

Tests: `go test ./...` (needs `DATABASE_URL`, ffmpeg; S3 tests need `S3_*` +
MinIO — CI provides both), `cd web && npm test` and `npm run lint`.

## License

AGPL-3.0 — [LICENSE](LICENSE). Free to use, modify and host; network
deployment of modified versions must publish their source under the same
terms (server-side copyleft).

## CI & releases

Single manual workflow (Actions → Run workflow): pre-checks, security scans
(gosec, govulncheck, npm audit), multi-arch image build (amd64 + arm64 →
`ghcr.io/parasetam0l/vidsilo`), Trivy scan, and a GitHub Release with binaries
when a `release_tag` input is given.
