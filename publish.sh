#!/usr/bin/env bash
# Builds the image, pushes it to the registry, and assembles the operator folder in out/docker/.
# Usage: IMAGE=docker.io/you/offline-checkin:latest ./publish.sh [--no-push]
set -euo pipefail
cd "$(dirname "$0")"

IMAGE="${IMAGE:-docker.io/CHANGEME/offline-checkin:latest}"
OUT=out/docker

docker build -t "$IMAGE" .
[ "${1:-}" = "--no-push" ] || docker push "$IMAGE"

mkdir -p "$OUT"
sed "s#\${IMAGE:-[^}]*}#$IMAGE#" docker-compose.yml > "$OUT/docker-compose.yml"
cp docker/* "$OUT/"
echo "Operator folder: $OUT (image $IMAGE)"
ls "$OUT"
