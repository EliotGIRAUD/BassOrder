#!/usr/bin/env bash
# Backup SQLite BassOrder (volume Docker) → /var/backups/bassorder/
# Conserve 14 jours. À lancer en root (cron).
set -euo pipefail

BACKUP_DIR=/var/backups/bassorder
KEEP_DAYS=14
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$BACKUP_DIR/bassorder-$STAMP.db"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

VOL=$(docker volume ls -q | grep -E 'bassorder.*data' | head -1 || true)
if [[ -z "${VOL:-}" ]]; then
  echo "Aucun volume bassorder_*data trouvé" >&2
  exit 1
fi

# Copie à froid du fichier (+ WAL/SHM s’ils existent) — suffisant pour ce volume mono-writer
docker run --rm \
  -v "$VOL":/data:ro \
  -v "$BACKUP_DIR":/backup \
  alpine:3.20 \
  sh -c "cp -a /data/bassorder.db /backup/bassorder-$STAMP.db; \
         cp -a /data/bassorder.db-wal /backup/bassorder-$STAMP.db-wal 2>/dev/null || true; \
         cp -a /data/bassorder.db-shm /backup/bassorder-$STAMP.db-shm 2>/dev/null || true"

chmod 600 "$OUT"
find "$BACKUP_DIR" -name 'bassorder-*' -mtime +"$KEEP_DAYS" -delete
echo "OK $OUT"
