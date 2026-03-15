#!/usr/bin/env bash
set -euo pipefail

if [ -z "${LD_CLIENT_ID:-}" ]; then
  echo "Error: LD_CLIENT_ID is not set"
  echo "Usage: LD_CLIENT_ID=your-client-side-id ./deploy-k8s.sh"
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IMAGE="ghcr.io/open-telemetry/demo:latest-frontend"

echo "Building frontend image..."
docker build \
  --no-cache \
  --build-arg NEXT_PUBLIC_LD_CLIENT_ID="$LD_CLIENT_ID" \
  -f "$REPO_ROOT/src/frontend/Dockerfile" \
  -t "$IMAGE" \
  "$REPO_ROOT"

echo "Updating frontend deployment to use local image..."
kubectl set image deployment/frontend frontend="$IMAGE"
kubectl rollout restart deployment/frontend

echo "Waiting for frontend rollout..."
kubectl rollout status deployment/frontend

echo "Done."
echo ""
read -p "Press Enter to start port forwarding (Ctrl+C to skip)..."
kubectl port-forward svc/frontend-proxy 8080:8080
