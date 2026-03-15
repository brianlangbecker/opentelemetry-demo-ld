# Kubernetes Deployment — Kustomize Overlay

This document covers deploying the LaunchDarkly integration to Kubernetes using the Kustomize overlay at `kubernetes/overlays/launchdarkly/`.

---

## Why a Kustomize Overlay?

The base manifest (`kubernetes/opentelemetry-demo.yaml`) is generated — editing it directly would be lost on the next regeneration. The Kustomize overlay sits alongside the base manifest and patches it without modifying it.

| Approach | Modifies Base | Survives Regeneration | Git-Friendly |
|----------|---------------|-----------------------|--------------|
| Direct edit of base | Yes (bad) | No | No |
| **Kustomize overlay** | No | Yes | Yes |
| Manual kubectl edit | Yes | No | No |

---

## Files

```
kubernetes/overlays/launchdarkly/
  kustomization.yaml      # Kustomize config: references base + patches
  frontend-patch.yaml     # Strategic merge patch: adds env var to frontend deployment
  README.md               # Quick reference
```

### `kustomization.yaml`

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

bases:
  - ../../opentelemetry-demo.yaml

patchesStrategicMerge:
  - frontend-patch.yaml

secretGenerator:
  - name: launchdarkly-secret
    literals:
      - client-id=${LD_CLIENT_ID}
    behavior: merge

namespace: otel-demo
```

### `frontend-patch.yaml`

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend
spec:
  template:
    spec:
      containers:
      - name: frontend
        env:
        - name: NEXT_PUBLIC_LD_CLIENT_ID
          valueFrom:
            secretKeyRef:
              name: launchdarkly-secret
              key: client-id
```

---

## Quick Start

```bash
# Set your LaunchDarkly client-side ID (not the SDK key)
export LD_CLIENT_ID="your-client-id-from-ld-dashboard"

# Apply the overlay
kubectl apply -k kubernetes/overlays/launchdarkly/

# Wait for frontend to be ready
kubectl rollout status deployment/frontend -n otel-demo

# Port forward to access locally
kubectl port-forward -n otel-demo svc/frontend 3000:8080
```

Visit `http://localhost:3000` — original banner shows (flag is OFF by default).

---

## How It Works

### 1. Secret Generation

Kustomize generates a Kubernetes Secret from the `LD_CLIENT_ID` env var:

```yaml
secretGenerator:
  - name: launchdarkly-secret
    literals:
      - client-id=${LD_CLIENT_ID}
```

The `${LD_CLIENT_ID}` is substituted from your shell environment at apply time.

### 2. Strategic Merge Patch

The patch adds the env var to the frontend container by merging with the existing deployment spec. Kubernetes identifies the correct container by the `name: frontend` field.

The env var is sourced from the secret, so the client ID is never stored in plaintext in the manifest.

### 3. Namespace

The overlay sets `namespace: otel-demo` — this ensures all resources (including the generated secret) land in the right namespace.

---

## Deployment Methods

### Method 1: kubectl apply -k (recommended)

```bash
export LD_CLIENT_ID="your-client-id"
kubectl apply -k kubernetes/overlays/launchdarkly/
```

### Method 2: Preview before applying

```bash
export LD_CLIENT_ID="your-client-id"
kubectl apply -k kubernetes/overlays/launchdarkly/ --dry-run=client -o yaml
```

### Method 3: Build and save manifest

```bash
export LD_CLIENT_ID="your-client-id"
kustomize build kubernetes/overlays/launchdarkly/ > launchdarkly-manifest.yaml
kubectl apply -f launchdarkly-manifest.yaml
```

---

## Verification

```bash
# Check the secret was created
kubectl get secret launchdarkly-secret -n otel-demo

# Decode and view the secret value
kubectl get secret launchdarkly-secret -n otel-demo \
  -o jsonpath='{.data.client-id}' | base64 --decode

# Check the frontend pod has the env var
kubectl describe pod -l app.kubernetes.io/name=frontend -n otel-demo \
  | grep NEXT_PUBLIC_LD_CLIENT_ID

# Check at runtime inside the pod
kubectl exec -it deploy/frontend -n otel-demo -- env | grep NEXT_PUBLIC_LD_CLIENT_ID
```

---

## Troubleshooting

### "LD_CLIENT_ID: not found" during apply

The shell env var is not set:

```bash
export LD_CLIENT_ID="your-client-id"
kubectl apply -k kubernetes/overlays/launchdarkly/
```

### Env var not appearing in pod

The pod may have been created before the secret existed. Restart it:

```bash
kubectl rollout restart deployment/frontend -n otel-demo
kubectl rollout status deployment/frontend -n otel-demo
```

### `kustomize` command not found

Use the built-in kubectl kustomize instead:

```bash
kubectl apply -k kubernetes/overlays/launchdarkly/
# This works without a separate kustomize install
```

Or install kustomize:

```bash
brew install kustomize  # macOS
```

### Updating the client ID later

```bash
# Update the secret directly
kubectl patch secret launchdarkly-secret -n otel-demo \
  -p '{"data": {"client-id": "'$(echo -n "new-client-id" | base64)'"}}'

# Restart the pod to pick up the change
kubectl rollout restart deployment/frontend -n otel-demo
```

---

## Extending the Overlay

### Add more env vars to frontend

Edit `frontend-patch.yaml`:

```yaml
env:
- name: NEXT_PUBLIC_LD_CLIENT_ID
  valueFrom:
    secretKeyRef:
      name: launchdarkly-secret
      key: client-id
- name: MY_OTHER_VAR
  value: "some-value"
```

### Patch other deployments

Create a new patch file and reference it in `kustomization.yaml`:

```yaml
patchesStrategicMerge:
  - frontend-patch.yaml
  - recommendation-patch.yaml
```

### Change the namespace

Edit `kustomization.yaml`:

```yaml
namespace: my-namespace
```
