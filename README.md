# VOD — self-hosted video platform

A Kaltura-CE-lite VOD platform: upload → probe → transcode → adaptive HLS delivery, with a premium web admin panel and a custom hls.js player. One Go binary embeds the UI and serves media; a companion worker process (same image) runs the transcode pipeline. Docker **and** bare metal (Ubuntu LTS + systemd) are fully supported.

See [DESIGN.md](DESIGN.md) for the full design.

## Quickstart (Docker)

```bash
docker compose up -d --build
```

- App: http://localhost:8080
- First-run admin credentials are logged once: `docker compose logs app | grep password` (sign in with the email, default `admin@localhost`)
- Worker runs probe/transcode jobs; watch it: `docker compose logs -f worker`

Optional S3/MinIO storage:

```bash
docker compose --profile s3 up -d --build
```

then set `STORAGE_DRIVER=s3 S3_ENDPOINT=http://minio:9000 S3_BUCKET=vod S3_ACCESS_KEY=vod S3_SECRET_KEY=vod-secret S3_REGION=us-east-1` on the `app` and `worker` services in `docker-compose.yml`.

## Bare metal (Ubuntu LTS 24.04+, amd64/arm64)

```bash
# build the binary (Linux) or download a release, then:
sudo sh install.sh                 # app role (server + api + media)
sudo sh install.sh --role worker   # on transcode nodes
sudo sh install.sh --role db       # on the postgres node
```

`install.sh` is idempotent: installs postgres/ffmpeg, creates the `vod` user + dirs + systemd units, and restarts services. First-run admin is in `journalctl -u vod-app`. Environment lives in `/etc/vod-app/env` (see `deploy/env.example`).

Horizontal scale: `DATABASE_URL` + shared storage (local: NFS — install warns; s3: no shared FS needed) in `/etc/vod-app/env` on each node. Workers/apps add horizontally with no code changes.

## Admin UI

| Page | What it does |
|---|---|
| Dashboard | KPI cards, entries by status, recent uploads |
| Entries | Search (pg_trgm ILIKE), status/category filters, pagination, bulk delete |
| Entry detail | Metadata, sprite poster picker, subtitle upload, flavor ticks, playback ACL + embed snippet, analytics (SVG charts) |
| Upload | Drag & drop, tus resumable, title/description/category — opens in a dialog from anywhere (sidebar, dashboard); uploads survive page changes and refreshes (resumable via IndexedDB + tus URLs) |
| Users / Categories / Flavors / Settings | Admin CRUD (email + name/surname) + grouped settings (transcoding, storage, analytics, embed policy) |

## Player

`/play/{uuid}` — full player: quality selector, sprite-sheet scrubber preview, subtitles, speed, volume, fullscreen.
`/embed/{uuid}` — chromeless iframe player, protected by the per-entry/global embed domain ACL.
Public URLs use non-enumerable per-entry UUIDs (never the sequential internal id); legacy numeric URLs keep working. Query params: `autoplay=1&muted=1&loop=1`.

## Configuration

Everything is admin-editable in the panel; only `DATABASE_URL` is required as env (plus `S3_*` when using the s3 driver). See DESIGN.md §4.

## Operations

- **Known advisories**: `govulncheck` reports GO-2026-5932 on the
  `golang.org/x/crypto/openpgp` package (unmaintained-by-design; no fixed
  version exists). It is a transitive dependency we never call — verified 0
  vulnerabilities in imported packages. If a patched x/crypto release
  appears, `go get golang.org/x/crypto@latest` clears it.
- **Health**: `GET /healthz` (db + storage reachability), docker HEALTHCHECK built in.
- **Logging**: JSON logs go to stdout **and** a size-rotating file at `DATA_DIR/logs/vod-app.log` (10 MB × 5 files, in-process rotation — same behavior on Docker and bare metal). Docker compose additionally rotates the container stdout via `json-file` (10 MB × 5); bare-metal systemd journal captures stdout too and rotates natively.
- **Admin password recovery**: `vod-app reset-admin` (or `docker compose exec app vod-app reset-admin`) rotates the admin password and prints it once. It requires host access to the data dir, so it is safe as an operator-only escape hatch. First-run password is still logged once at seed.
- **Security**: short-lived access JWTs (15 min, HS256, constant-time verify) with opaque database-backed refresh tokens (7 days, sha256-hashed at rest, rotation + theft-revocation on reuse), HttpOnly + SameSite=Lax cookies (Secure when TLS on), argon2id password hashing (legacy bcrypt hashes upgrade transparently on next login), token-bucket rate limiting on all `/api/*` (tighter on login, generous on analytics beacons), CSRF defense in depth (SameSite + Origin-header check on state-changing requests), parameterized SQL everywhere, path-traversal-safe media keys, and hardening headers (nosniff, Referrer-Policy, CSP — all resources restricted to `'self'` with `'unsafe-inline'` allowed for the statically exported inline scripts, which change on every web build; X-Frame-Options on admin, HSTS when TLS enabled).
- **Download prevention**: original source files are never served over HTTP at all — `/media/*/original.*` returns 403 for every role (the worker reads originals directly from storage), and `playinfo` exposes no source URL. HLS playlists/segments/poster/sprite remain subject to the embed domain ACL (hotlink prevention). Note: HLS segments are inherently fetchable by the player, so a determined client can always rip what it can play — no DRM is attempted.
- **Backups**: `deploy/backup.sh` — `pg_dump` catalog + optional media tarball; cron example in the script header. `analytics_totals` survive retention; `secret.key` and S3 keys must be backed up (rotating logs everyone out).
- **Bandwidth & concurrent viewers**: the dashboard "Bandwidth" card is **server-measured view traffic** — every byte served to viewers is counted in the media handler (zero extra requests) and batched into `analytics_totals`/`analytics_daily`. Plan your uplink: one 720p stream ≈ 1.5–2.5 Mbps ≈ 0.7–1.1 GB/hour, so 100 concurrent viewers ≈ 70–110 GB/hour. Serving is zero-copy (sendfile) with immutable segment caching, so repeat viewers are cheap, but outbound bandwidth — not CPU — is the binding constraint at scale; put a CDN in front of `/media/` (the immutable headers make it trivial) or add app nodes with the s3 driver.
- **Restore order**: DB dump → media → start app/worker (migrations run automatically at boot).
- **Storage migration**: `vod-app migrate --source-driver=local --source-data-dir=/old/data [--prune]` moves media between drivers/paths idempotently (see DESIGN.md §8a). For **zero-downtime lazy promotion**, point `STORAGE_DRIVER` at the new store and set `FALLBACK_STORAGE_DRIVER` (+ `FALLBACK_*`) to the old one: misses are served from the legacy store and copied into the new one on demand; drop the fallback env once `migrate --prune` has drained it.
- **Multi-node storage**: the local driver's transcode fast path writes directly into the store tree — in a multi-node deployment this requires `DATA_DIR` on a shared network mount (e.g. NFS). Without shared storage, use the s3 driver (or a single worker).
- **Upgrades**: Docker: `docker compose pull && up -d`. Bare metal: replace the binary, `systemctl restart vod-app vod-worker`.
- **TLS**: env-configured, one of four modes: `TLS_MODE=off` (plain HTTP), `letsencrypt` (autocert ACME on `HTTPS_PORT`, HTTP answers challenges + redirects; needs public DNS in `TLS_DOMAINS` and ports 80/443 open), `selfsigned` (locally generated ECDSA cert, cached in `TLS_CERT_DIR`), or `files` (your own `TLS_CERT_FILE`/`TLS_KEY_FILE`, falling back to self-signed if unreadable). Listeners on `HTTP_PORT` (default 80) and `HTTPS_PORT` (default 443); Docker publishes 80→8080 and 443→8443 by default — all overridable via env. `install.sh` asks interactively (or via `--domain` / `--selfsigned` / `--ssl-cert`+`--ssl-key`).
- **Theme**: dark by default; light mode toggle in the sidebar (and on the login screen), remembered in localStorage, falls back to OS preference.

## Development

```bash
docker compose up -d db                       # Postgres 17 on :5432
DATABASE_URL=postgres://vod:vod@localhost:5432/vod DATA_DIR=/tmp/voddata \
  go run ./cmd/vod-app server                 # backend on :8080 (pick a free port)
DATABASE_URL=... go run ./cmd/vod-app worker  # transcode worker (second terminal)
cd web && npm run dev                         # UI dev server on :3000 (proxies /api, /upload, /media, /play, /embed to :8090)
```

The dev proxy target defaults to `:8090` (port 8080 is often taken by Docker Desktop on macOS) — adjust `web/next.config.ts` if you run the backend elsewhere.

The UI is built with **shadcn/ui** (not pure Tailwind) on Tailwind v4 — shadcn/ui components, Base UI primitives, lucide icons — so we get a consistent premium look without hand-rolling components. Shared app-level hooks: `useDialog` (programmatic dialogs + confirm), `useToast` (sonner), and an upload store with localStorage/IndexedDB persistence. A language selector (English only for now) and theme toggle live in the admin header and on the login page. The production UI is a static export (`web/out`) embedded into the binary via `go:embed`; the Dockerfile builds it in a `node:24` stage (`NEXT_OUTPUT=export`) and copies it into `internal/ui/web/out/` before `go build`. To embed a fresh UI locally:

```bash
cd web && NEXT_OUTPUT=export npm run build && cd ..
rm -rf internal/ui/web/out && cp -r web/out internal/ui/web/out
go build ./cmd/vod-app
```

## Tests

```bash
docker compose up -d db
DATABASE_URL=postgres://vod:vod@localhost:5432/vod go test ./...
```

Integration tests (db, api, queue, jobs) run against the live database and skip when `DATABASE_URL` is unset; the jobs pipeline test needs ffmpeg and skips without it.

## Layout

```
cmd/vod-app/        single binary: server | worker | migrate | reset-admin | version
internal/           config, db (migrations/seed), store (local/s3/cache), media (ffmpeg),
                    analytics, jobs, queue (hand-rolled), api, settings, upload (tusd), ui (go:embed)
web/                Next.js static export (admin UI + player, shadcn/ui + Tailwind v4)
deploy/             install.sh, systemd units, env example, backup.sh
Dockerfile          multi-stage (node:24 → golang:1.26 → ubuntu:24.04 + ffmpeg)
docker-compose.yml  app, worker, db (postgres 17), minio (optional s3 profile)
```
