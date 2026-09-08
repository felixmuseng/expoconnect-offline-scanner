#!/usr/bin/env bash
# Builds the app and assembles a self-contained Windows folder in out/offline-checkin-win/.
set -euo pipefail
cd "$(dirname "$0")"

CADDY_VERSION=2.10.0
OUT=out/offline-checkin-win
CACHE=.cache/caddy-$CADDY_VERSION-windows-amd64.zip

npm run build
mkdir -p "$OUT" .cache
rm -rf "$OUT/dist"
cp -r dist "$OUT/dist"
cp win/*.bat "$OUT/"

if [ ! -f "$CACHE" ]; then
  curl -fL -o "$CACHE" "https://github.com/caddyserver/caddy/releases/download/v$CADDY_VERSION/caddy_${CADDY_VERSION}_windows_amd64.zip"
fi
unzip -oq "$CACHE" caddy.exe -d "$OUT"

echo "Ready: $OUT"
ls -la "$OUT"
