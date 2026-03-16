#!/usr/bin/env bash
set -euo pipefail

if [ -z "${LD_CLIENT_ID:-}" ]; then
  echo "Error: LD_CLIENT_ID is not set"
  echo "Usage: LD_CLIENT_ID=your-client-side-id ./deploy-docker.sh"
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FRONTEND_IMAGE="ghcr.io/open-telemetry/demo:latest-frontend"
LOAD_GEN_IMAGE="ghcr.io/open-telemetry/demo:latest-load-generator"

echo "Building frontend image..."
DOCKER_BUILDKIT=1 docker build \
  --build-arg NEXT_PUBLIC_LD_CLIENT_ID="$LD_CLIENT_ID" \
  --cache-from "$FRONTEND_IMAGE" \
  -f "$REPO_ROOT/src/frontend/Dockerfile" \
  -t "$FRONTEND_IMAGE" \
  "$REPO_ROOT"

echo "Building load-generator image..."
# locustfile.py is the last COPY in the Dockerfile, so playwright install stays cached.
# --cache-from reuses layers from the previous build — only the locustfile layer rebuilds.
DOCKER_BUILDKIT=1 docker build \
  --cache-from "$LOAD_GEN_IMAGE" \
  -f "$REPO_ROOT/src/load-generator/Dockerfile" \
  -t "$LOAD_GEN_IMAGE" \
  "$REPO_ROOT"

echo "Restarting frontend and load-generator..."
docker compose -f "$REPO_ROOT/docker-compose.yml" up -d --no-deps frontend load-generator

echo "Done. Visit http://localhost:8080"
