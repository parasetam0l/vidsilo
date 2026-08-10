#!/bin/sh
# VOD install script — Ubuntu LTS only (24.04 / 26.04, amd64/arm64).
# Idempotent. Roles:
#   ./install.sh                app node (server: API + UI + media)
#   ./install.sh --role worker  transcode node
#   ./install.sh --role db      postgres node
# Options: --env-file /path/to/env   --no-start
set -eu

ROLE="app"
ENV_FILE=""
NO_START=0
VOD_USER=vod
DATA_DIR=/var/lib/vod-app/data
CERT_DIR=/var/lib/vod-app/certs
ENV_DIR=/etc/vod-app
BIN=/usr/local/bin/vod-app

for arg in "$@"; do
    case "$arg" in
        --role=*) ROLE="${arg#*=}" ;;
        --env-file=*) ENV_FILE="${arg#*=}" ;;
        --db-password=*) DB_PASSWORD="${arg#*=}" ;;
        --no-start) NO_START=1 ;;
        --help|-h)
            echo "usage: $0 [--role=app|worker|db] [--env-file=FILE] [--db-password=PW] [--no-start]"
            echo "  --db-password sets a scram password on the vod role (remote app/worker nodes need it)"
            exit 0 ;;
        *) echo "unknown option: $arg"; exit 2 ;;
    esac
done

case "$ROLE" in
    app|worker|db) ;;
    *) echo "invalid role: $ROLE (app|worker|db)"; exit 2 ;;
esac

# --- OS detection -------------------------------------------------------------
. /etc/os-release 2>/dev/null || { echo "cannot detect OS"; exit 1; }
case "$ID" in
    ubuntu) ;;
    *) echo "only Ubuntu LTS is supported (found $ID)"; exit 1 ;;
esac
case "$VERSION_ID" in
    24.04|26.04) ;;
    *) echo "Ubuntu LTS >= 24.04 required (found $VERSION_ID)"; exit 1 ;;
esac

if [ "$(id -u)" -ne 0 ]; then
    echo "run as root (sudo sh $0 ...)"; exit 1
fi

# --- system packages ----------------------------------------------------------
apt-get update -qq
apt-get install -y -qq ca-certificates

if [ "$ROLE" = "db" ] || [ "$ROLE" = "app" ] || [ "$ROLE" = "worker" ]; then
    if ! command -v psql >/dev/null 2>&1; then
        apt-get install -y -qq postgresql
    fi
    if ! command -v ffmpeg >/dev/null 2>&1; then
        apt-get install -y -qq ffmpeg
    fi
    if ! ffmpeg -encoders 2>/dev/null | grep -q libx264 || ! ffmpeg -encoders 2>/dev/null | grep -q libx265; then
        echo "WARNING: ffmpeg lacks libx264/libx265 encoders; transcoding will fail"
    fi
fi

# --- user + directories -------------------------------------------------------
if ! id "$VOD_USER" >/dev/null 2>&1; then
    useradd --system --create-home "$VOD_USER"
fi
mkdir -p "$DATA_DIR" "$CERT_DIR" "$ENV_DIR" /var/log/vod-app
chown -R "$VOD_USER":"$VOD_USER" "$DATA_DIR" "$CERT_DIR" /var/log/vod-app

# --- database (db role creates the role+db; others assume it exists) ---------
# Auth model: same-host app/worker nodes use the unix socket with peer auth
# (no password needed — systemd runs as the vod user, pg_hba defaults to
# 'local all all peer'). Remote nodes must set a scram password on the role
# (--db-password) and use a TCP DATABASE_URL; pg_hba.conf must allow it.
DB_ENV="$ENV_DIR/env"
DB_PASSWORD="${DB_PASSWORD:-}"
if [ "$ROLE" = "db" ]; then
    if ! command -v pg_ctlcluster >/dev/null 2>&1; then
        apt-get install -y -qq postgresql
    fi
    systemctl enable --now postgresql 2>/dev/null || true
    if ! su -s /bin/sh postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='vod'\"" | grep -q 1; then
        if [ -n "$DB_PASSWORD" ]; then
            su -s /bin/sh postgres -c "psql -c \"CREATE ROLE vod LOGIN PASSWORD '$DB_PASSWORD'\""
            echo "created postgres role 'vod' with the password from --db-password"
        else
            su -s /bin/sh postgres -c "psql -c \"CREATE ROLE vod LOGIN\""
            echo "created postgres role 'vod' (peer auth only — remote nodes need --db-password)"
        fi
    fi
    su -s /bin/sh postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='vod'\"" | grep -q 1 ||
        su -s /bin/sh postgres -c "createdb -O vod vod"
fi

# --- env file -----------------------------------------------------------------
if [ "$ROLE" = "app" ] || [ "$ROLE" = "worker" ]; then
    if [ -n "$ENV_FILE" ]; then
        cp "$ENV_FILE" "$DB_ENV"
    elif [ ! -f "$DB_ENV" ]; then
        echo "creating $DB_ENV — edit DATABASE_URL/STORAGE_DRIVER as needed"
        if [ -n "$DB_PASSWORD" ]; then
            cat > "$DB_ENV" <<EOF
DATABASE_URL=postgres://vod:$DB_PASSWORD@localhost:5432/vod
DATA_DIR=$DATA_DIR
STORAGE_DRIVER=local
EOF
        else
            # Peer auth via the unix socket (same-host installs).
            cat > "$DB_ENV" <<EOF
DATABASE_URL=postgres:///vod?host=/var/run/postgresql
DATA_DIR=$DATA_DIR
STORAGE_DRIVER=local
EOF
        fi
    fi
    chown "$VOD_USER":"$VOD_USER" "$DB_ENV"
    chmod 600 "$DB_ENV"
fi

# --- binary -------------------------------------------------------------------
if [ ! -x "$BIN" ]; then
    echo "place the vod-app binary at $BIN first (e.g. cp vod-app $BIN && chmod +x $BIN)"
    exit 1
fi

# --- systemd ------------------------------------------------------------------
if [ "$ROLE" = "app" ]; then
    install -m 644 -o root -g root /dev/stdin /etc/systemd/system/vod-app.service <<'UNIT'
[Unit]
Description=VOD app server
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
User=vod
Group=vod
EnvironmentFile=/etc/vod-app/env
ExecStart=/usr/local/bin/vod-app server
Restart=on-failure
RestartSec=2s
StateDirectory=vod-app
LogsDirectory=vod-app
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
UNIT
    systemctl daemon-reload
    [ "$NO_START" = "1" ] || systemctl enable --now vod-app
fi

if [ "$ROLE" = "worker" ]; then
    install -m 644 -o root -g root /dev/stdin /etc/systemd/system/vod-worker.service <<'UNIT'
[Unit]
Description=VOD worker
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
User=vod
Group=vod
EnvironmentFile=/etc/vod-app/env
ExecStart=/usr/local/bin/vod-app worker
Restart=on-failure
RestartSec=2s
Nice=10
IOSchedulingClass=idle

[Install]
WantedBy=multi-user.target
UNIT
    systemctl daemon-reload
    [ "$NO_START" = "1" ] || systemctl enable --now vod-worker
fi

echo "install complete (role=$ROLE)"
[ "$ROLE" = "app" ] && echo "first-run admin password: journalctl -u vod-app | grep 'First-run admin'"
