# Installing Vidsilo

`deploy/install.sh` is the single installation mechanism. It's interactive
by default and idempotent — run it on Ubuntu LTS (24.04/26.04, amd64 or
arm64) as root:

```bash
git clone https://github.com/parasetam0l/vidsilo.git
cd vidsilo
sudo sh deploy/install.sh
```

The wizard asks two questions and then does the rest:

1. **How do you want to install?** — Single server (default) or High availability
2. **Where?** — Bare metal or Docker (single); Bare metal or Kubernetes (HA)

You can also skip the prompts with flags — see the [reference](#reference) below.

---

## Single server — Docker

1. Run the wizard and pick **Single server → Docker** (or `--mode=single --target=docker`).
2. It checks Docker + the compose plugin (offers to install them), then asks whether to
   **pull the prebuilt image** from `ghcr.io/parasetam0l/vidsilo` (recommended) or **build locally**.
3. It generates `.env` with secrets, asks the TLS question, and starts the stack.

Manual equivalent:

```bash
./deploy/gen-env.sh
docker compose up -d --pull always   # or: docker compose up -d --build
docker compose logs app | grep 'First-run admin'
```

## Single server — Bare metal

Pick **Single server → Bare metal**. The wizard:

1. **Gets the binary** — asks how: download the latest release, or build from source
   (auto-installs Go ≥1.26 + Node ≥20 via snap/nodesource).
2. Installs Postgres + the app + the worker as systemd services (all-in-one).
3. Generates a Postgres password, asks the TLS question, and starts everything.

Services: `vidsilo` (API/UI/media), `vidsilo-worker` (transcode queue), `postgresql`.
Env file: `/etc/vidsilo/env`. First-run admin: `journalctl -u vidsilo | grep 'First-run admin'`.

## High availability — Bare metal

Pick **High availability → Bare metal**, then choose this node's component:

- **Database** — installs Postgres, generates a scram password and prints it once;
  use it on the app/worker nodes.
- **Application** — asks for the DB host + password, the site domain, the load-balancer IP
  (sets `TRUSTED_PROXIES` so rate limiting sees real client IPs), and media storage.
- **Worker** — asks for the DB host + password and the same storage choice.
- **Load balancer** — installs nginx as a pass-through proxy (ports 80/443 forward to the
  app nodes; TLS stays on the app nodes via autocert). Asks for the app node addresses.

**Storage for HA**: pick S3/MinIO (recommended — works across nodes with no shared
filesystem) or NFS (the DB node exports the media path via `nfs-kernel-server`; app/worker
nodes mount it). On app/worker installs you're asked once; `--env-file` with a prepared env
skips the prompts entirely.

Horizontal scale: add app/worker nodes with `--mode=ha --target=baremetal --component=app|worker`.

## High availability — Kubernetes

Pick **High availability → Kubernetes**. The wizard:

1. Checks `kubectl` and cluster connectivity.
2. Asks for the site domain, media storage (in-cluster PVC or S3), and whether
   cert-manager is available for automatic Ingress TLS.
3. Creates the secrets and applies `deploy/k8s/`:

   - Postgres StatefulSet + PVC (in-cluster database)
   - `vidsilo` Deployment (2 replicas) + Service
   - `vidsilo-worker` Deployment
   - Ingress (nginx, cert-manager ready)
   - ConfigMap + Secret (DB credentials, storage/TLS settings)

```bash
kubectl rollout status deployment/vidsilo deployment/vidsilo-worker
kubectl logs deployment/vidsilo -c app | grep 'First-run admin'
```

Swap to an external database by changing the `database-url` secret value.

## TLS

Asked during every install. Three options:

1. **Let's Encrypt (auto)** — needs a public domain and ports 80/443 reachable;
   certs renew automatically (autocert).
2. **Self-signed** — generated locally, no DNS needed; browsers show a warning.
3. **Bring your own** — provide cert + key paths.

Equivalent flags: `--domain=d1,d2`, `--selfsigned`, `--ssl-cert=F --ssl-key=F`.

## Reference

```
usage: install.sh [options]
  --mode=single|ha                  install topology (interactive by default)
  --target=docker|baremetal|kubernetes
  --component=app|worker|db|lb      HA bare-metal node role
  --yes                             assume defaults, never prompt
  --env-file=FILE                   copy a pre-made env file
  --db-password=PW                  postgres scram password
  --domain=d1,d2 / --selfsigned / --ssl-cert=F --ssl-key=F   TLS
  --no-start                        install without starting services
```

Non-interactive defaults: `single` / `baremetal` / `app`.

## After install

- **Admin login**: first-run password is printed once (journal/container logs); rotate
  anytime with `vidsilo reset-admin` (or `docker compose exec app vidsilo reset-admin`).
- **Backups**: `deploy/backup.sh DIR [--with-media]` — the wizard can install a daily cron
  (Docker path). Restore order: DB dump → media → start.
- **Upgrades**: pull the new release binary or image, restart the services.
