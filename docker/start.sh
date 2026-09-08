#!/usr/bin/env bash
# Ubuntu equivalent of start.bat. First run pulls the image (needs internet once).
cd "$(dirname "$0")"
URL="http://localhost:8000"
docker info >/dev/null 2>&1 || { echo "Docker is not running." >&2; exit 1; }
docker compose up -d
for _ in $(seq 20); do curl -s -o /dev/null "$URL" && break; sleep 0.25; done
for b in microsoft-edge google-chrome chromium chromium-browser; do
  command -v "$b" >/dev/null && exec "$b" --app="$URL" --kiosk-printing
done
echo "No Chromium browser found. Open $URL in Chrome or Edge." >&2
exit 1
