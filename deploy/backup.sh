#!/bin/sh
# Vidsilo backup — catalog + optional media.
# Cron example (daily 03:00):  0 3 * * * /usr/local/bin/vidsilo-backup.sh /var/backups/vidsilo --with-media
# Restore order: DB dump -> media -> start app/worker (migrations run at boot).
# NOTE: /var/lib/vidsilo/data/secret.key (and S3 keys in /etc/vidsilo/env) must
# be backed up separately — rotating the secret logs everyone out.
set -eu

BACKUP_DIR="${1:-/var/backups/vidsilo}"
WITH_MEDIA=0
for arg in "$@"; do
    case "$arg" in
        --with-media) WITH_MEDIA=1 ;;
        --help|-h) echo "usage: $0 DIR [--with-media]"; exit 0 ;;
    esac
done

DB_URL="${DATABASE_URL:-postgres://vidsilo:vidsilo@localhost:5432/vidsilo}"
DATA_DIR="${DATA_DIR:-/var/lib/vidsilo/data}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

echo "dumping catalog -> $BACKUP_DIR/vidsilo-$STAMP.sql.gz"
pg_dump "$DB_URL" | gzip > "$BACKUP_DIR/vidsilo-$STAMP.sql.gz"

if [ "$WITH_MEDIA" = "1" ]; then
    echo "tarballing media -> $BACKUP_DIR/media-$STAMP.tar.gz"
    tar -C "$(dirname "$DATA_DIR")" -czf "$BACKUP_DIR/media-$STAMP.tar.gz" \
        --exclude=uploads --exclude=certs "$(basename "$DATA_DIR")"
fi

# Keep the last 14 catalog dumps, 7 media tarballs.
ls -1t "$BACKUP_DIR"/vidsilo-*.sql.gz 2>/dev/null | tail -n +15 | xargs -r rm -f
ls -1t "$BACKUP_DIR"/media-*.tar.gz 2>/dev/null | tail -n +8 | xargs -r rm -f

echo "backup complete"
