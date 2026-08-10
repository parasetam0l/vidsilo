# VOD — self-hosted video platform

A Kaltura-CE-lite VOD platform: upload → probe → transcode → adaptive HLS delivery, with a premium web admin panel and a custom hls.js player. One Go binary embeds the UI and serves media; a companion worker process (same image) runs the transcode pipeline. Docker **and** bare metal (Ubuntu LTS + systemd) are fully supported.

See [DESIGN.md](DESIGN.md) for the full design.

## Quickstart (Docker)

```bash
docker compose up -d --build
```

- App: http://localhost:8080
- First-run admin credentials are logged once: `docker compose logs app | grep password`
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
| Entries | Search (ILIKE), status/category filters, pagination, bulk delete |
| Entry detail | Metadata, sprite poster picker, subtitle upload, flavor ticks, playback ACL + embed snippet, analytics (SVG charts) |
| Upload | Drag & drop, tus resumable, title/description/category/flavor ticks |
| Users / Categories / Flavors / Settings | Admin CRUD + grouped settings (transcoding, storage, analytics, embed policy, TLS) |

## Player

`/play/{uuid}` — full player: quality selector, sprite-sheet scrubber preview, subtitles, speed, volume, fullscreen.
`/embed/{uuid}` — chromeless iframe player, protected by the per-entry/global embed domain ACL.
Public URLs use non-enumerable per-entry UUIDs (never the sequential internal id); legacy numeric URLs keep working. Query params: `autoplay=1&muted=1&loop=1`.

## Configuration

Everything is admin-editable in the panel; only `DATABASE_URL` is required as env (plus `S3_*` when using the s3 driver). See DESIGN.md §4.

## Operations

- **Health**: `GET /healthz` (db + storage reachability), docker HEALTHCHECK built in.
- **Logging**: JSON logs go to stdout **and** a size-rotating file at `DATA_DIR/logs/vod-app.log` (10 MB × 5 files, in-process rotation — same behavior on Docker and bare metal). Docker compose additionally rotates the container stdout via `json-file` (10 MB × 5); bare-metal systemd journal captures stdout too and rotates natively.
- **Admin password recovery**: `vod-app reset-admin` (or `docker compose exec app vod-app reset-admin`) rotates the admin password and prints it once. It requires host access to the data dir, so it is safe as an operator-only escape hatch. First-run password is still logged once at seed.
- **Security**: short-lived access JWTs (15 min, HS256, constant-time verify) with opaque database-backed refresh tokens (7 days, sha256-hashed at rest, rotation + theft-revocation on reuse), HttpOnly + SameSite=Lax cookies (Secure when TLS on), argon2id password hashing (legacy bcrypt hashes upgrade transparently on next login), token-bucket rate limiting on all `/api/*` (tighter on login, generous on analytics beacons), CSRF defense in depth (SameSite + Origin-header check on state-changing requests), parameterized SQL everywhere, path-traversal-safe media keys, and hardening headers (nosniff, Referrer-Policy, CSP with sha256-hashed inline scripts — no unsafe-inline, X-Frame-Options on admin, HSTS when TLS enabled).
- **Download prevention**: original source files are never served to anonymous visitors — `/media/*/original.*` requires an authenticated editor+ session (403 otherwise), and `playinfo` hides `sourceUrl` from anonymous requests. HLS playlists/segments/poster/sprite remain subject to the embed domain ACL (hotlink prevention).
- **Backups**: `deploy/backup.sh` — `pg_dump` catalog + optional media tarball; cron example in the script header. `analytics_totals` survive retention; `secret.key` and S3 keys must be backed up (rotating logs everyone out).
- **Restore order**: DB dump → media → start app/worker (migrations run automatically at boot).
- **Storage migration**: `vod-app migrate --source-driver=local --source-data-dir=/old/data [--prune]` moves media between drivers/paths idempotently (see DESIGN.md §8a).
- **Upgrades**: Docker: `docker compose pull && up -d`. Bare metal: replace the binary, `systemctl restart vod-app vod-worker`.
- **TLS**: `tls.mode=auto` in the panel with `tls.acme_domains` (Let's Encrypt via autocert); requires public DNS + ports 80/443.
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

The UI is built with **shadcn/ui** (not pure Tailwind) on Tailwind v4 — shadcn/ui components, Radix/Base UI primitives, lucide icons — so we get a consistent premium look without hand-rolling components. The production UI is a static export (`web/out`) embedded into the binary via `go:embed`; the Dockerfile builds it in a `node:24` stage (`NEXT_OUTPUT=export`) and copies it into `internal/ui/web/out/` before `go build`. To embed a fresh UI locally:

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
