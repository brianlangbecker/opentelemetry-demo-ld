#!/usr/bin/env bash
# Disables log/host/kubelet/cluster metric collection presets that fail on Docker Desktop
# due to /var/log/pods symlinks and missing host paths.
set -euo pipefail

echo "Upgrading my-otel-demo with collection presets disabled..."

helm upgrade my-otel-demo open-telemetry/opentelemetry-demo \
  --reuse-values \
  --force-conflicts \
  --set opentelemetry-collector.podLabels.environment=docker-desktop \
  --set opentelemetry-collector.podLabels.cluster=docker-desktop \
  --set opentelemetry-collector.presets.logsCollection.enabled=false \
  --set opentelemetry-collector.presets.hostMetrics.enabled=false \
  --set opentelemetry-collector.presets.kubeletMetrics.enabled=false \
  --set opentelemetry-collector.presets.clusterMetrics.enabled=false

echo "Done."
