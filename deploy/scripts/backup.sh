#!/bin/sh
# Daily pg_dump of the profile database, kept for 14 days. Runs as postgres from byzantine-council-backup.service.
set -eu
umask 077
DB="${BC_DB:-bcouncil}"
DIR="${BC_BACKUP_DIR:-/var/backups/byzantine-council}"
KEEP_DAYS="${BC_BACKUP_KEEP_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TMP="$DIR/.$DB-$STAMP.dump.partial"
OUT="$DIR/$DB-$STAMP.dump"

mkdir -p "$DIR"
# Write to a temporary name first, so a failed dump never looks like a good backup.
pg_dump --format=custom --compress=6 --no-owner --file="$TMP" "$DB"
pg_restore --list "$TMP" > /dev/null
mv "$TMP" "$OUT"
find "$DIR" -maxdepth 1 -name "$DB-*.dump" -type f -mtime +"$KEEP_DAYS" -delete
find "$DIR" -maxdepth 1 -name ".$DB-*.partial" -type f -mmin +120 -delete
echo "backup ok: $OUT"
