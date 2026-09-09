#!/usr/bin/env bash
# Builds the image, tags it the QuantumBytes way (ENV-YYYY.MM.PATCH-SHA), pushes it,
# and assembles the operator folder in out/docker/.
# Usage: ./publish.sh [--no-push]        IMAGE_NAME=you/offline-checkin ./publish.sh
set -euo pipefail
cd "$(dirname "$0")"

IMAGE_NAME="${IMAGE_NAME:-nathanael71/offline-checkin}"
REGISTRY="${DOCKER_REGISTRY:-docker.io}"
# amd64 covers Windows (Docker Desktop runs Linux containers on WSL 2), Intel Macs
# and Linux; arm64 covers Apple Silicon and ARM Windows.
PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"
OUT=out/docker
PUSH=true
[ "${1:-}" = "--no-push" ] && PUSH=false

BRANCH=$(git rev-parse --abbrev-ref HEAD)
SHA=$(git rev-parse --short HEAD)

case "$BRANCH" in
  master | main | production) ENV=prod ;;
  stag) ENV=stag ;;
  *) ENV=dev ;;
esac

YEAR_MONTH=$(date +"%Y.%m")

# Patch counts releases within the month, read back from the tags already pushed.
git fetch --tags --force >/dev/null 2>&1 || echo "Tag fetch failed; numbering from local tags only."
LATEST=$(git tag -l "${ENV}-${YEAR_MONTH}.*" | sed "s/${ENV}-${YEAR_MONTH}\.\([0-9]*\)-.*/\1/" | sort -n | tail -1)
PATCH=$(( ${LATEST:-0} + 1 ))

VERSION_TAG="${ENV}-${YEAR_MONTH}.${PATCH}-${SHA}"
VERSIONED="${IMAGE_NAME}:${VERSION_TAG}"
ENV_LATEST="${IMAGE_NAME}:${ENV}-latest"
LATEST_TAG="${IMAGE_NAME}:latest"

if [ "$REGISTRY" != "docker.io" ]; then
  VERSIONED="${REGISTRY}/${VERSIONED}"
  ENV_LATEST="${REGISTRY}/${ENV_LATEST}"
  LATEST_TAG="${REGISTRY}/${LATEST_TAG}"
fi

echo "Branch:   $BRANCH"
echo "Env:      $ENV"
echo "Version:  $VERSION_TAG"
echo "Tags:     $VERSIONED, $ENV_LATEST, $LATEST_TAG"
echo

if [ "$PUSH" = true ]; then
  docker buildx build --platform "$PLATFORMS" \
    -t "$VERSIONED" -t "$ENV_LATEST" -t "$LATEST_TAG" --push .
  git tag "$VERSION_TAG" 2>/dev/null || echo "Tag $VERSION_TAG already exists locally."
  git push origin "$VERSION_TAG" 2>/dev/null || echo "Tag push failed or already on remote."
else
  # --load handles one platform, so a local build stays on this machine's.
  docker buildx build -t "$VERSIONED" -t "$ENV_LATEST" -t "$LATEST_TAG" --load .
fi

{
  echo "VERSION_TAG=$VERSION_TAG"
  echo "FULL_IMAGE_TAG=$VERSIONED"
  echo "LATEST_TAG=$ENV_LATEST"
  echo "REGISTRY_IMAGE=$VERSIONED"
  echo "REGISTRY_LATEST=$ENV_LATEST"
  echo "ENV=$ENV"
} > .docker-version

# The repo compose pins the release just published; the operator folder tracks
# ENV-latest so update.bat picks up the next one.
sed -i "s#\${IMAGE:-[^}]*}#\${IMAGE:-${VERSIONED}}#" docker-compose.yml
mkdir -p "$OUT"
sed "s#\${IMAGE:-[^}]*}#${ENV_LATEST}#" docker-compose.yml > "$OUT/docker-compose.yml"
cp docker/* scripts/linux-printer-access.sh .env.example "$OUT/"

echo
echo "Version:         $VERSION_TAG"
echo "Operator folder: $OUT (image $ENV_LATEST)"
ls "$OUT"
