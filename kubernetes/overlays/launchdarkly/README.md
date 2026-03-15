# LaunchDarkly Kustomize Overlay

This Kustomize overlay patches the base OpenTelemetry demo manifest to inject the LaunchDarkly client ID into the frontend deployment.

## What It Does

- **Patches** the frontend deployment to add `NEXT_PUBLIC_LD_CLIENT_ID` environment variable
- **Creates** a Kubernetes secret to store your LaunchDarkly client ID
- **Preserves** the original base manifest (no modifications needed)
- **Survives** manifest regeneration (overlay is independent)

## Quick Start

```bash
# Set your LaunchDarkly client ID
export LD_CLIENT_ID="your-client-id-here"

# Deploy the overlay
kubectl apply -k kubernetes/overlays/launchdarkly/

# Verify secret and env var
kubectl get secret launchdarkly-secret -n otel-demo
kubectl describe pod -l app.kubernetes.io/name=frontend -n otel-demo | grep NEXT_PUBLIC_LD_CLIENT_ID
```

## Files

- `kustomization.yaml` - Kustomize configuration (base + patches)
- `frontend-patch.yaml` - Patch that adds env var to frontend deployment
- `README.md` - This file

## How It Works

### 1. The Base Manifest

The overlay references the base manifest:
```yaml
# kustomization.yaml
bases:
  - ../../opentelemetry-demo.yaml
```

### 2. Strategic Merge Patch

The patch adds the LaunchDarkly env var to the frontend deployment:
```yaml
# frontend-patch.yaml
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

### 3. Secret Generation

The kustomization generates a secret from the env var:
```yaml
# kustomization.yaml
secretGenerator:
  - name: launchdarkly-secret
    literals:
      - client-id=${LD_CLIENT_ID}
```

## Why Kustomize Overlay?

| Approach | Base Modified | Survives Regen | Git-Friendly |
|----------|---------------|-----------------|--------------|
| Direct edit of base | ❌ Yes (bad) | ❌ No | ❌ No |
| **Kustomize overlay** | ✅ No | ✅ Yes | ✅ Yes |
| Manual kubectl edit | ❌ Yes | ❌ No | ❌ No |

- **Original manifest stays untouched**: When someone runs `make generate-kubernetes-manifests`, your overlay survives
- **Version controlled**: Overlay is committed to git, changes are tracked
- **Reusable**: Same overlay works across different manifest versions
- **Clean**: Separation of concerns (base vs. customizations)

## Deployment Methods

### Method 1: kubectl apply -k (Built-in)
```bash
export LD_CLIENT_ID="your-client-id"
kubectl apply -k kubernetes/overlays/launchdarkly/
```

### Method 2: kustomize build (Explicit)
```bash
export LD_CLIENT_ID="your-client-id"
kustomize build kubernetes/overlays/launchdarkly/ | kubectl apply -f -
```

### Method 3: kustomize build + save (For review)
```bash
export LD_CLIENT_ID="your-client-id"
kustomize build kubernetes/overlays/launchdarkly/ > launchdarkly-manifest.yaml
kubectl apply -f launchdarkly-manifest.yaml
```

## Verification

```bash
# Check secret
kubectl get secret launchdarkly-secret -n otel-demo -o yaml

# Check env var in pod
kubectl get pod -l app.kubernetes.io/name=frontend -n otel-demo -o yaml | grep -A 5 NEXT_PUBLIC_LD_CLIENT_ID

# View secret value (plaintext)
kubectl get secret launchdarkly-secret -n otel-demo -o jsonpath='{.data.client-id}' | base64 --decode

# Check pod environment at runtime
kubectl exec -it deploy/frontend -n otel-demo -- env | grep NEXT_PUBLIC_LD_CLIENT_ID
```

## Customization

### Change Namespace
Edit `kustomization.yaml`:
```yaml
namespace: my-namespace
```

### Add More Env Vars
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

### Patch Other Deployments
Create new patch files and reference in `kustomization.yaml`:
```yaml
patchesStrategicMerge:
  - frontend-patch.yaml
  - recommendation-patch.yaml
  - checkout-patch.yaml
```

## Troubleshooting

### "LD_CLIENT_ID: not found"

**Problem**: Env var not set
```bash
# Fix
export LD_CLIENT_ID="your-client-id"
kubectl apply -k kubernetes/overlays/launchdarkly/
```

### Secret not in pod

**Problem**: Pod created before secret
```bash
# Fix: Restart the pod
kubectl rollout restart deployment/frontend -n otel-demo
kubectl rollout status deployment/frontend -n otel-demo
```

### Can't find kustomize command

**Problem**: `kustomize` not installed, but you want to use it directly
```bash
# Use kubectl built-in kustomize instead
kubectl apply -k kubernetes/overlays/launchdarkly/

# Or install kustomize
brew install kustomize  # macOS
```

### Want to see what will be deployed?

```bash
# Preview the final manifest
kubectl apply -k kubernetes/overlays/launchdarkly/ --dry-run=client -o yaml
```

### Need to update the client ID later?

```bash
# Update the secret directly
kubectl patch secret launchdarkly-secret -n otel-demo \
  -p '{"data": {"client-id": "'$(echo -n "new-client-id" | base64)'"}}' 

# Restart the pod to pick up the change
kubectl rollout restart deployment/frontend -n otel-demo
```

## Next Steps

1. Deploy the overlay: `kubectl apply -k kubernetes/overlays/launchdarkly/`
2. Verify the env var: `kubectl describe pod -l app.kubernetes.io/name=frontend`
3. Port forward: `kubectl port-forward -n otel-demo svc/frontend 3000:8080`
4. Follow the main `LAUNCHDARKLY_SETUP.md` to test the feature flag

## References

- [Kustomize Documentation](https://kustomize.io/)
- [Strategic Merge Patch](https://kubernetes.io/docs/tasks/manage-kubernetes-objects/declarative-config/#strategic-merge-patch)
- [Kubernetes Secrets](https://kubernetes.io/docs/concepts/configuration/secret/)
- [kubectl apply -k](https://kubernetes.io/docs/tasks/kustomization/kustomize-tutorial/)
