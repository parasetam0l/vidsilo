#!/bin/sh
# Vidsilo install wizard — the only install mechanism.
#
# Paths:
#   Single Server + Docker       (PATH A)
#   Single Server + Bare metal   (PATH B: postgres + app + worker all-in-one)
#   High Availability + Bare metal  (PATH C: component wizard)
#   High Availability + Kubernetes (PATH D)
#
# Interactive by default; non-interactive via flags:
#   --mode=single|ha --target=docker|baremetal|kubernetes
#   --component=app|worker|db|lb   --yes (assume defaults)
# Legacy flags kept: --role=app|worker|db, --env-file, --db-password,
# TLS flags, --no-start.
set -eu

# --- defaults & flag parsing --------------------------------------------------
MODE=""
TARGET=""
COMPONENT=""
YES=0
ROLE=""
ENV_FILE=""
NO_START=0
Vidsilo_USER=vidsilo
DATA_DIR=/var/lib/vidsilo/data
CERT_DIR=/var/lib/vidsilo/certs
ENV_DIR=/etc/vidsilo
BIN=/usr/local/bin/vidsilo
DB_ENV="$ENV_DIR/env"
GENERATED_DB_PASSWORD=0
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ARCH="$(uname -m)"
case "$ARCH" in
    x86_64) BIN_ARCH=amd64 ;;
    aarch64|arm64) BIN_ARCH=arm64 ;;
    *) echo "unsupported architecture: $ARCH"; exit 1 ;;
esac

for arg in "$@"; do
    case "$arg" in
        --mode=*) MODE="${arg#*=}" ;;
        --target=*) TARGET="${arg#*=}" ;;
        --component=*) COMPONENT="${arg#*=}" ;;
        --role=*) ROLE="${arg#*=}" ;;
        --yes) YES=1 ;;
        --env-file=*) ENV_FILE="${arg#*=}" ;;
        --db-password=*) DB_PASSWORD="${arg#*=}" ;;
        --domain=*) TLS_MODE=letsencrypt; TLS_DOMAINS="${arg#*=}" ;;
        --selfsigned) TLS_MODE=selfsigned ;;
        --ssl-cert=*) TLS_MODE=files; TLS_CERT_FILE="${arg#*=}" ;;
        --ssl-key=*) TLS_MODE=files; TLS_KEY_FILE="${arg#*=}" ;;
        --no-start) NO_START=1 ;;
        --help|-h)
            echo "usage: $0 [options]"
            echo "  --mode=single|ha          install topology (interactive by default)"
            echo "  --target=docker|baremetal|kubernetes"
            echo "  --component=app|worker|db|lb   HA bare-metal node role"
            echo "  --yes                     assume defaults, never prompt"
            echo "  --env-file=FILE           copy a pre-made env file"
            echo "  --db-password=PW          postgres scram password"
            echo "  --domain=d1,d2 / --selfsigned / --ssl-cert=F --ssl-key=F   TLS"
            echo "  --no-start                install without starting services"
            exit 0 ;;
        *) echo "unknown option: $arg"; exit 2 ;;
    esac
done

# Legacy --role maps to single-server bare metal.
if [ -n "$ROLE" ]; then
    MODE=single; TARGET=baremetal; COMPONENT="$ROLE"
fi

# --- interactive wizard -------------------------------------------------------
ask() { # ask PROMPT DEFAULT
    printf "%s [%s]: " "$1" "$2"
    read -r REPLY
    REPLY="${REPLY:-$2}"
}

# interactive is true only on a real TTY without --yes.
interactive() { [ -t 0 ] && [ "$YES" = "0" ]; }

if [ -t 0 ] && [ "$YES" = "0" ]; then
    if [ -z "$MODE" ]; then
        echo "How do you want to install Vidsilo?"
        echo "  1) Single server"
        echo "  2) High availability"
        ask "Choice" 1
        [ "$REPLY" = "2" ] && MODE=ha || MODE=single
    fi
    if [ "$MODE" = "single" ] && [ -z "$TARGET" ]; then
        echo "Where will it run?"
        echo "  1) Bare metal"
        echo "  2) Docker"
        ask "Choice" 1
        [ "$REPLY" = "2" ] && TARGET=docker || TARGET=baremetal
    elif [ "$MODE" = "ha" ] && [ -z "$TARGET" ]; then
        echo "Where will it run?"
        echo "  1) Bare metal"
        echo "  2) Kubernetes"
        ask "Choice" 1
        [ "$REPLY" = "2" ] && TARGET=kubernetes || TARGET=baremetal
    fi
    if [ "$MODE" = "ha" ] && [ "$TARGET" = "baremetal" ] && [ -z "$COMPONENT" ]; then
        echo "Which component is this node?"
        echo "  1) Load balancer"
        echo "  2) Application (API + UI + media)"
        echo "  3) Worker (transcoding)"
        echo "  4) Database"
        ask "Choice" 2
        case "$REPLY" in
            1) COMPONENT=lb ;; 2) COMPONENT=app ;;
            3) COMPONENT=worker ;; 4) COMPONENT=db ;;
            *) echo "invalid choice"; exit 2 ;;
        esac
    fi
fi

MODE="${MODE:-single}"
TARGET="${TARGET:-baremetal}"
COMPONENT="${COMPONENT:-app}"

case "$MODE:$TARGET" in
    single:docker|single:baremetal|ha:baremetal|ha:kubernetes) ;;
    *) echo "invalid combination: mode=$MODE target=$TARGET"; exit 2 ;;
esac
if [ "$MODE" = "ha" ] && [ "$TARGET" = "baremetal" ]; then
    case "$COMPONENT" in
        app|worker|db|lb) ;;
        *) echo "invalid component: $COMPONENT"; exit 2 ;;
    esac
fi

# --- preflight ----------------------------------------------------------------
. /etc/os-release 2>/dev/null || { echo "cannot detect OS"; exit 1; }
[ "$ID" = "ubuntu" ] || { echo "only Ubuntu LTS is supported (found $ID)"; exit 1; }
case "$VERSION_ID" in 24.04|26.04) ;; *) echo "Ubuntu LTS >= 24.04 required (found $VERSION_ID)"; exit 1 ;; esac
[ "$(id -u)" -eq 0 ] || { echo "run as root (sudo sh $0 ...)"; exit 1; }
apt-get update -qq
apt-get install -y -qq ca-certificates openssl curl

# --- PATH A: single server, docker --------------------------------------------
install_docker_single() {
    if ! command -v docker >/dev/null 2>&1; then
        echo "Docker is not installed."
        if [ -t 0 ] && [ "$YES" = "0" ]; then
            ask "Install Docker Engine + compose plugin?" y
            if [ "$REPLY" = "y" ] || [ "$REPLY" = "Y" ]; then
                apt-get install -y -qq docker.io docker-compose-plugin
                systemctl enable --now docker
            else
                echo "aborted — install Docker and re-run"; exit 1
            fi
        else
            echo "aborted — install Docker and re-run (apt install docker.io docker-compose-plugin)"; exit 1
        fi
    fi
    docker compose version >/dev/null 2>&1 || { echo "docker compose plugin missing"; exit 1; }

    cd "$REPO_ROOT"
    BUILD_MODE=1
    if interactive; then
        echo "What should the docker image be?"
        echo "  1) Pull from ghcr.io/parasetam0l/vidsilo (recommended)"
        echo "  2) Build locally"
        ask "Choice" 1
        BUILD_MODE="$REPLY"
    fi

    # .env with generated secrets + TLS.
    sh deploy/gen-env.sh
    ENV_FILE_PATH="$REPO_ROOT/.env"
    tls_prompt  # sets TLS_* vars
    if [ -n "${TLS_MODE:-}" ]; then
        {
            echo "TLS_MODE=$TLS_MODE"
            [ -z "${TLS_DOMAINS:-}" ] || echo "TLS_DOMAINS=$TLS_DOMAINS"
            [ -z "${TLS_CERT_FILE:-}" ] || echo "TLS_CERT_FILE=$TLS_CERT_FILE"
            [ -z "${TLS_KEY_FILE:-}" ] || echo "TLS_KEY_FILE=$TLS_KEY_FILE"
        } >> "$ENV_FILE_PATH"
    fi

    if [ "$BUILD_MODE" = "2" ]; then
        docker compose up -d --build
    else
        docker compose pull
        docker compose up -d
    fi

    echo "install complete (single server, docker)"
    echo "first-run admin password: docker compose -f $REPO_ROOT/docker-compose.yml logs app | grep 'First-run admin'"
    if [ -t 0 ] && [ "$YES" = "0" ]; then
        ask "Install a daily backup cron (pg_dump + media)?" y
        if [ "$REPLY" = "y" ] || [ "$REPLY" = "Y" ]; then
            mkdir -p /var/backups/vidsilo
            ( crontab -l 2>/dev/null | grep -v vidsilo-backup; \
              echo "0 3 * * * cd $REPO_ROOT && docker compose exec -T db pg_dump -U vidsilo vidsilo | gzip > /var/backups/vidsilo/vidsilo-\$(date +\\%Y\\%m\\%d).sql.gz" ) | crontab -
            echo "backup cron installed (daily 03:00 → /var/backups/vidsilo)"
        fi
    fi
}

# --- binary acquisition -------------------------------------------------------
version_ge() { # version_ge CURRENT REQUIRED (semver-ish major.minor)
    printf '%s\n%s\n' "$2" "$1" | sort -V -C
}

build_from_source() {
    echo "Building vidsilo from source..."
    MISSING=""
    if ! command -v go >/dev/null 2>&1 || ! version_ge "$(go version 2>/dev/null | sed -E 's/.*go([0-9]+(\.[0-9]+)?).*/\1/')" 1.26; then
        MISSING="$MISSING go>=1.26"
    fi
    if ! command -v node >/dev/null 2>&1 || [ "$(node -v 2>/dev/null | tr -d v | cut -d. -f1)" -lt 20 ]; then
        MISSING="$MISSING node>=20"
    fi
    if [ -n "$MISSING" ]; then
        echo "missing toolchain:$MISSING"
        if interactive; then
            ask "Install them? (snap go --classic, nodesource node 24)" y
            [ "$REPLY" = "y" ] || [ "$REPLY" = "Y" ] || { echo "aborted"; exit 1; }
        else
            echo "aborted — install go>=1.26 and node>=20, then re-run"; exit 1
        fi
        command -v go >/dev/null 2>&1 || snap install go --classic
        command -v node >/dev/null 2>&1 || { curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && apt-get install -y -qq nodejs; }
        export PATH="/snap/bin:$PATH"
    fi
    cd "$REPO_ROOT/web"
    NEXT_OUTPUT=export npm ci >/dev/null 2>&1 || true
    NEXT_OUTPUT=export npm run build
    cd "$REPO_ROOT"
    mkdir -p internal/ui/web/out
    cp -r web/out/. internal/ui/web/out/
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o "$BIN" ./cmd/vidsilo
    chmod +x "$BIN"
    echo "built $BIN from source"
}

install_binary() {
    if [ -x "$BIN" ]; then return; fi
    echo "vidsilo binary not found at $BIN."
    SRC=release
    if interactive; then
        echo "How should we get the vidsilo binary?"
        echo "  1) Download the prebuilt release (recommended)"
        echo "  2) Build from source"
        ask "Choice" 1
        case "$REPLY" in
            1) SRC=release ;;
            2) SRC=source ;;
            *) echo "invalid choice"; exit 2 ;;
        esac
    fi
    case "$SRC" in
        release)
            echo "downloading latest release binary (linux-$BIN_ARCH)..."
            curl -fL -o "$BIN" "https://github.com/parasetam0l/vidsilo/releases/latest/download/vidsilo-linux-$BIN_ARCH"
            ;;
        source)
            build_from_source
            ;;
    esac
    [ -x "$BIN" ] || { echo "binary acquisition failed"; exit 1; }
    chmod +x "$BIN"
    echo "binary installed: $BIN"
}

# --- TLS prompt ---------------------------------------------------------------
tls_prompt() {
    if [ -n "${TLS_MODE:-}" ]; then return; fi
    [ -t 0 ] && [ "$YES" = "0" ] || return
    printf "Serve over HTTPS? [y/N] "
    read -r HTTPS_ANSWER
    case "$HTTPS_ANSWER" in
        y|Y|yes|Yes)
            echo "Where should the SSL certificate come from?"
            echo "  1) Auto SSL (Let's Encrypt, automatic renewal)"
            echo "  2) Self-signed (generated locally, no DNS needed)"
            echo "  3) Bring your own certificate files"
            printf "Choice [1]: "
            read -r SSL_CHOICE
            case "${SSL_CHOICE:-1}" in
                1) printf "Domain(s), comma-separated: "; read -r TLS_DOMAINS; TLS_MODE=letsencrypt ;;
                2) TLS_MODE=selfsigned ;;
                3) printf "Certificate file path: "; read -r TLS_CERT_FILE
                   printf "Private key file path: "; read -r TLS_KEY_FILE
                   TLS_MODE=files ;;
                *) echo "invalid choice: $SSL_CHOICE"; exit 2 ;;
            esac ;;
    esac
}

# --- DB role (bare metal) -----------------------------------------------------
setup_db() { # DB_HOST (empty = same host)
    if ! command -v pg_ctlcluster >/dev/null 2>&1; then
        apt-get install -y -qq postgresql
    fi
    systemctl enable --now postgresql 2>/dev/null || true
    if ! su -s /bin/sh postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='vidsilo'\"" | grep -q 1; then
        su -s /bin/sh postgres -c "psql -c \"CREATE ROLE vidsilo LOGIN PASSWORD '$DB_PASSWORD'\""
        echo "created postgres role 'vidsilo' with a scram password"
    fi
    su -s /bin/sh postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='vidsilo'\"" | grep -q 1 ||
        su -s /bin/sh postgres -c "createdb -O vidsilo vidsilo"
}

# --- env file (bare metal) ----------------------------------------------------
write_env() { # DB_HOST, STORAGE vars pre-set in the environment
    if [ -n "$ENV_FILE" ]; then
        cp "$ENV_FILE" "$DB_ENV"
    elif [ ! -f "$DB_ENV" ]; then
        echo "creating $DB_ENV"
        if [ -n "${DB_HOST:-}" ]; then
            cat > "$DB_ENV" <<EOF
DATABASE_URL=postgres://vidsilo:$DB_PASSWORD@$DB_HOST:5432/vidsilo
DATA_DIR=$DATA_DIR
STORAGE_DRIVER=${STORAGE_DRIVER:-local}
EOF
        else
            cat > "$DB_ENV" <<EOF
DATABASE_URL=postgres:///vidsilo?host=/var/run/postgresql
DATA_DIR=$DATA_DIR
STORAGE_DRIVER=${STORAGE_DRIVER:-local}
EOF
        fi
        [ -z "${TRUSTED_PROXIES:-}" ] || echo "TRUSTED_PROXIES=$TRUSTED_PROXIES" >> "$DB_ENV"
        [ -z "${S3_ENDPOINT:-}" ] || echo "S3_ENDPOINT=$S3_ENDPOINT" >> "$DB_ENV"
        [ -z "${S3_BUCKET:-}" ] || echo "S3_BUCKET=$S3_BUCKET" >> "$DB_ENV"
        [ -z "${S3_ACCESS_KEY:-}" ] || echo "S3_ACCESS_KEY=$S3_ACCESS_KEY" >> "$DB_ENV"
        [ -z "${S3_SECRET_KEY:-}" ] || echo "S3_SECRET_KEY=$S3_SECRET_KEY" >> "$DB_ENV"
        [ -z "${S3_REGION:-}" ] || echo "S3_REGION=$S3_REGION" >> "$DB_ENV"
    fi
    chown "$Vidsilo_USER":"$Vidsilo_USER" "$DB_ENV"
    chmod 600 "$DB_ENV"
    if [ -n "${TLS_MODE:-}" ] && ! grep -q '^TLS_MODE=' "$DB_ENV" 2>/dev/null; then
        {
            echo "TLS_MODE=$TLS_MODE"
            [ -z "${TLS_DOMAINS:-}" ] || echo "TLS_DOMAINS=$TLS_DOMAINS"
            [ -z "${TLS_CERT_FILE:-}" ] || echo "TLS_CERT_FILE=$TLS_CERT_FILE"
            [ -z "${TLS_KEY_FILE:-}" ] || echo "TLS_KEY_FILE=$TLS_KEY_FILE"
            echo "TLS_CERT_DIR=$CERT_DIR"
        } >> "$DB_ENV"
        chown "$Vidsilo_USER":"$Vidsilo_USER" "$DB_ENV"
    fi
}

# --- systemd units (bare metal) ------------------------------------------------
install_unit_app() {
    install -m 644 -o root -g root /dev/stdin /etc/systemd/system/vidsilo.service <<'UNIT'
[Unit]
Description=Vidsilo app server
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
User=vidsilo
Group=vidsilo
EnvironmentFile=/etc/vidsilo/env
ExecStart=/usr/local/bin/vidsilo server
Restart=on-failure
RestartSec=2s
StateDirectory=vidsilo
LogsDirectory=vidsilo
AmbientCapabilities=CAP_NET_BIND_SERVICE
MemoryHigh=384M
MemoryMax=512M
OOMScoreAdjust=100

[Install]
WantedBy=multi-user.target
UNIT
    systemctl daemon-reload
    [ "$NO_START" = "1" ] || systemctl enable --now vidsilo
}

install_unit_worker() {
    install -m 644 -o root -g root /dev/stdin /etc/systemd/system/vidsilo-worker.service <<'UNIT'
[Unit]
Description=Vidsilo worker
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
User=vidsilo
Group=vidsilo
EnvironmentFile=/etc/vidsilo/env
ExecStart=/usr/local/bin/vidsilo worker
Restart=on-failure
RestartSec=2s
Nice=10
IOSchedulingClass=idle
MemoryHigh=3G
MemoryMax=4G
OOMScoreAdjust=500

[Install]
WantedBy=multi-user.target
UNIT
    systemctl daemon-reload
    [ "$NO_START" = "1" ] || systemctl enable --now vidsilo-worker
}

# --- shared dirs ---------------------------------------------------------------
setup_dirs() {
    if ! id "$Vidsilo_USER" >/dev/null 2>&1; then
        useradd --system --create-home "$Vidsilo_USER"
    fi
    mkdir -p "$DATA_DIR" "$CERT_DIR" "$ENV_DIR" /var/log/vidsilo
    chown -R "$Vidsilo_USER":"$Vidsilo_USER" "$DATA_DIR" "$CERT_DIR" /var/log/vidsilo
    if ! command -v ffmpeg >/dev/null 2>&1; then
        apt-get install -y -qq ffmpeg
    fi
    if ! ffmpeg -encoders 2>/dev/null | grep -q libx264 || ! ffmpeg -encoders 2>/dev/null | grep -q libx265; then
        echo "WARNING: ffmpeg lacks libx264/libx265 encoders; transcoding will fail"
    fi
}

# --- storage question (HA app/worker) ------------------------------------------
ask_storage() {
    echo "How should media be shared across nodes?"
    echo "  1) S3 / MinIO (recommended for HA)"
    echo "  2) NFS shared mount"
    ask "Choice" 1
    if [ "$REPLY" = "2" ]; then
        printf "NFS export (server:/path, e.g. 10.0.0.5:/srv/vidsilo): "
        read -r NFS_EXPORT
        apt-get install -y -qq nfs-common
        mkdir -p "$DATA_DIR"
        grep -q "$NFS_EXPORT" /etc/fstab || echo "$NFS_EXPORT $DATA_DIR nfs defaults,noatime 0 0" >> /etc/fstab
        mount -a
        chown -R "$Vidsilo_USER":"$Vidsilo_USER" "$DATA_DIR"
        STORAGE_DRIVER=local
    else
        printf "S3 endpoint (e.g. https://s3.amazonaws.com or http://minio:9000): "
        read -r S3_ENDPOINT
        printf "S3 bucket: "; read -r S3_BUCKET
        printf "S3 access key: "; read -r S3_ACCESS_KEY
        printf "S3 secret key: "; read -r S3_SECRET_KEY
        S3_REGION="${S3_REGION:-us-east-1}"
        STORAGE_DRIVER=s3
    fi
}

# --- PATH B: single server, bare metal -----------------------------------------
install_baremetal_single() {
    install_binary
    setup_dirs
    if [ -z "${DB_PASSWORD:-}" ]; then
        DB_PASSWORD="$(openssl rand -hex 24)"
        GENERATED_DB_PASSWORD=1
    fi
    setup_db
    tls_prompt
    write_env
    install_unit_app
    install_unit_worker
    echo "install complete (single server, bare metal)"
    [ "$GENERATED_DB_PASSWORD" = "1" ] && {
        echo "postgres password for the vidsilo role (save this — it is not stored on disk):"
        echo "    $DB_PASSWORD"
    }
    echo "first-run admin password: journalctl -u vidsilo | grep 'First-run admin'"
}

# --- PATH C: HA bare metal -----------------------------------------------------
install_ha_baremetal() {
    case "$COMPONENT" in
        db)
            install_binary || true
            DB_PASSWORD="${DB_PASSWORD:-$(openssl rand -hex 24)}"
            GENERATED_DB_PASSWORD=1
            setup_db
            echo "install complete (ha, db node)"
            echo "postgres password for the vidsilo role (save this — it is not stored on disk):"
            echo "    $DB_PASSWORD"
            echo "app/worker nodes: install with --db-password=$DB_PASSWORD" ;;
        app)
            install_binary
            setup_dirs
            if interactive; then
                printf "Database host (IP or hostname): "; read -r DB_HOST
                printf "Postgres password for the vidsilo role: "; read -r DB_PASSWORD
                ask_storage
                printf "Load balancer IP (for TRUSTED_PROXIES; empty to skip): "; read -r LB_IP
                [ -z "$LB_IP" ] || TRUSTED_PROXIES="$LB_IP"
            elif [ -z "$ENV_FILE" ]; then
                echo "app installs need interactivity or --env-file"; exit 1
            fi
            tls_prompt
            write_env
            install_unit_app
            echo "install complete (ha, app node)"
            echo "first-run admin password: journalctl -u vidsilo | grep 'First-run admin'" ;;
        worker)
            install_binary
            setup_dirs
            if interactive; then
                printf "Database host (IP or hostname): "; read -r DB_HOST
                printf "Postgres password for the vidsilo role: "; read -r DB_PASSWORD
                ask_storage
            elif [ -z "$ENV_FILE" ]; then
                echo "worker installs need interactivity or --env-file"; exit 1
            fi
            write_env
            install_unit_worker
            echo "install complete (ha, worker node)" ;;
        lb)
            interactive || { echo "the load balancer install is interactive-only"; exit 1; }
            apt-get install -y -qq nginx
            echo "App node addresses (IPs or hostnames, one per line; blank line to finish):"
            > /tmp/vidsilo_upstreams
            while :; do
                printf "  app node: "; read -r NODE
                [ -z "$NODE" ] && break
                echo "    server $NODE:80 max_fails=3 fail_timeout=30s;" >> /tmp/vidsilo_upstreams
            done
            if [ ! -s /tmp/vidsilo_upstreams ]; then
                echo "no app nodes given — aborting"; exit 1
            fi
            {
                echo "upstream vidsilo_apps {"
                cat /tmp/vidsilo_upstreams
                echo "}"
                sed -n '/^server {/,$p' "$REPO_ROOT/deploy/lb/vidsilo.conf" | sed '/upstream vidsilo_apps {/,/^}/d'
            } > /etc/nginx/sites-available/vidsilo.conf
            rm -f /tmp/vidsilo_upstreams
            ln -sf /etc/nginx/sites-available/vidsilo.conf /etc/nginx/sites-enabled/vidsilo.conf
            rm -f /etc/nginx/sites-enabled/default
            nginx -t
            systemctl enable --now nginx
            systemctl reload nginx
            MYIP="$(hostname -I 2>/dev/null | awk '{print $1}')"
            echo "install complete (ha, load balancer)"
            echo "set TRUSTED_PROXIES=$MYIP on every app node (install with --env or edit /etc/vidsilo/env)" ;;
    esac
}

# --- PATH D: HA kubernetes -----------------------------------------------------
install_kubernetes() {
    interactive || { echo "the kubernetes install is interactive-only"; exit 1; }
    command -v kubectl >/dev/null 2>&1 || { echo "kubectl is not installed — install it (e.g. apt install kubectl) and re-run"; exit 1; }
    kubectl cluster-info >/dev/null 2>&1 || { echo "cannot reach the cluster — is kubeconfig set?"; exit 1; }
    tls_prompt
    ask "Media storage — 1) in-cluster PVC  2) S3" 1
    if [ "$REPLY" = "2" ]; then
        printf "S3 endpoint: "; read -r S3_ENDPOINT
        printf "S3 bucket: "; read -r S3_BUCKET
        printf "S3 access key: "; read -r S3_ACCESS_KEY
        printf "S3 secret key: "; read -r S3_SECRET_KEY
    fi
    printf "Site domain (for the ingress; empty to skip): "; read -r DOMAIN
    if kubectl get clusterissuer >/dev/null 2>&1; then
        ask "cert-manager cluster issuer available — use it for TLS?" y
        [ "$REPLY" = "y" ] || [ "$REPLY" = "Y" ] && CERT_MANAGER=1 || CERT_MANAGER=0
    else
        CERT_MANAGER=0
    fi

    DB_PASSWORD="${DB_PASSWORD:-$(openssl rand -hex 24)}"
    K8S_DIR="$REPO_ROOT/deploy/k8s"
    kubectl create secret generic vidsilo-secrets --dry-run=client -o yaml \
        --from-literal=db-password="$DB_PASSWORD" \
        --from-literal=database-url="postgres://vidsilo:$DB_PASSWORD@vidsilo-postgres:5432/vidsilo" \
        ${S3_ACCESS_KEY:+--from-literal=S3_ACCESS_KEY=$S3_ACCESS_KEY} \
        ${S3_SECRET_KEY:+--from-literal=S3_SECRET_KEY=$S3_SECRET_KEY} \
        | kubectl apply -f -
    if [ "$REPLY" = "2" ]; then
        kubectl patch configmap vidsilo-config --type merge -p "{\"data\":{\"STORAGE_DRIVER\":\"s3\",\"S3_ENDPOINT\":\"$S3_ENDPOINT\",\"S3_BUCKET\":\"$S3_BUCKET\"}}"
    fi
    kubectl apply -f "$K8S_DIR"
    if [ -n "${DOMAIN:-}" ]; then
        kubectl patch ingress vidsilo --type json \
            -p '[{"op":"replace","path":"/spec/rules/0/host","value":"'$DOMAIN'"}]'
        [ "$CERT_MANAGER" = "1" ] && kubectl patch ingress vidsilo --type json \
            -p '[{"op":"add","path":"/spec/tls","value":[{"hosts":["'$DOMAIN'"],"secretName":"vidsilo-tls"}]}]'
    fi
    echo "install complete (ha, kubernetes)"
    echo "watch rollout: kubectl rollout status deployment/vidsilo deployment/vidsilo-worker"
    echo "first-run admin password: kubectl logs deployment/vidsilo -c app | grep 'First-run admin'"
}

# --- dispatch ------------------------------------------------------------------
case "$MODE:$TARGET" in
    single:docker) install_docker_single ;;
    single:baremetal) install_baremetal_single ;;
    ha:baremetal) install_ha_baremetal ;;
    ha:kubernetes) install_kubernetes ;;
esac
