#!/bin/sh
# Renders the nginx frame-ancestors map from FRAME_ANCESTORS. Usage (root): frame-ancestors.sh [env-file] [snippet]; then reload nginx.
set -euf
umask 022
ENV_FILE="${1:-/etc/byzantine-council/server.env}"
OUT="${2:-/etc/nginx/snippets/bc-frame-ancestors.conf}"
# The same rule as apps/server/src/frameAncestors.ts: https origins, an optional leading "*." label, an optional port.
SOURCE='^https://(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(:[0-9]{1,5})?$'

# Read the value without sourcing the file, so nothing in it is ever executed.
RAW="$(grep -E '^FRAME_ANCESTORS=' "$ENV_FILE" | tail -n 1 | cut -d= -f2- | tr -d " \t\r\"'")"
LIST=""
COUNT=0
OLD_IFS="$IFS"
IFS=','
for item in $RAW; do
    [ -z "$item" ] && continue
    if ! printf '%s\n' "$item" | grep -Eq "$SOURCE"; then
        echo "frame-ancestors: entry $((COUNT + 1)) is not an https origin like https://discord.com" >&2
        exit 1
    fi
    COUNT=$((COUNT + 1))
    LIST="${LIST:+$LIST }$item"
done
IFS="$OLD_IFS"
if [ "$COUNT" -gt 16 ]; then
    echo "frame-ancestors: at most 16 entries" >&2
    exit 1
fi
if [ -z "$LIST" ]; then VALUE="'none'"; else VALUE="$LIST"; fi

TMP="$OUT.partial"
{
    echo "# Rendered by deploy/scripts/frame-ancestors.sh from $ENV_FILE. Do not edit by hand."
    echo 'map $host $bc_frame_ancestors {'
    echo "    default \"$VALUE\";"
    echo '}'
} > "$TMP"
[ -f "$OUT" ] && cp -p "$OUT" "$OUT.previous"
mv "$TMP" "$OUT"
# A config nginx rejects is rolled back, so the running policy never changes by accident.
if ! nginx -t; then
    if [ -f "$OUT.previous" ]; then mv "$OUT.previous" "$OUT"; fi
    echo "frame-ancestors: nginx -t failed, previous snippet restored" >&2
    exit 1
fi
rm -f "$OUT.previous"
echo "frame-ancestors: $VALUE"
