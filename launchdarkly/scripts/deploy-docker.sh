#!/usr/bin/env bash
set -euo pipefail

if [ -z "${LD_CLIENT_ID:-}" ]; then
  echo "Error: LD_CLIENT_ID is not set"
  echo "Usage: LD_CLIENT_ID=your-client-side-id ./deploy-docker.sh"
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IMAGE="ghcr.io/open-telemetry/demo:latest-frontend"

echo "Building frontend image..."
docker build \
  --build-arg NEXT_PUBLIC_LD_CLIENT_ID="$LD_CLIENT_ID" \
  -f "$REPO_ROOT/src/frontend/Dockerfile" \
  -t "$IMAGE" \
  "$REPO_ROOT"

echo "Restarting frontend..."
docker compose -f "$REPO_ROOT/docker-compose.yml" up -d --no-deps frontend

echo "Done. Visit http://localhost:8080"
