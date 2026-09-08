#!/usr/bin/env bash
cd "$(dirname "$0")"
[ -f .server.pid ] && kill "$(cat .server.pid)" 2>/dev/null && rm -f .server.pid
pkill -f "caddy file-server --root dist" 2>/dev/null
pkill -f "http.server 8000" 2>/dev/null
echo "Server stopped."
