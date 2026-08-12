#!/bin/sh
# Creates .env from .env.example with a generated Postgres password.
# Idempotent: an existing .env is never touched or overwritten.
set -eu
cd "$(dirname "$0")/.."

if [ -f .env ]; then
    echo ".env already exists — leaving untouched (edit it to change secrets)"
    exit 0
fi
[ -f .env.example ] || { echo "missing .env.example"; exit 1; }
command -v openssl >/dev/null 2>&1 || { echo "openssl is required (apt install openssl)"; exit 1; }

POSTGRES_PASSWORD="$(openssl rand -hex 24)"
MINIO_ROOT_PASSWORD="$(openssl rand -hex 24)"

sed \
    -e "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$POSTGRES_PASSWORD/" \
    -e "s/^# MINIO_ROOT_PASSWORD=.*/MINIO_ROOT_PASSWORD=$MINIO_ROOT_PASSWORD/" \
    .env.example > .env

echo "created .env with generated secrets (POSTGRES_PASSWORD, MINIO_ROOT_PASSWORD)"
echo "safe to commit? no — .env is gitignored; use: docker compose up -d"
