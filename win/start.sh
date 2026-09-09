#!/usr/bin/env bash
# Ubuntu equivalent of start.bat. Serves ./dist on 127.0.0.1:8000 and opens a Chromium browser in app mode.
cd "$(dirname "$0")"
PORT=8000
URL="http://localhost:$PORT"

[ -e /etc/udev/rules.d/99-usb-printer-uaccess.rules ] ||
  echo "Printing over USB? Run ./linux-printer-access.sh once first."

if ! curl -s -o /dev/null "$URL"; then
  if [ -x ./caddy ]; then
    nohup ./caddy file-server --root dist --listen 127.0.0.1:$PORT >/dev/null 2>&1 &
  elif command -v caddy >/dev/null; then
    nohup caddy file-server --root dist --listen 127.0.0.1:$PORT >/dev/null 2>&1 &
  else
    nohup python3 -m http.server $PORT --bind 127.0.0.1 --directory dist >/dev/null 2>&1 &
  fi
  echo $! > .server.pid
  for _ in $(seq 20); do curl -s -o /dev/null "$URL" && break; sleep 0.25; done
fi

for b in microsoft-edge google-chrome chromium chromium-browser; do
  if command -v "$b" >/dev/null; then
    exec "$b" --app="$URL" --kiosk-printing
  fi
done
echo "No Chromium browser found. Open $URL in Chrome or Edge." >&2
exit 1
