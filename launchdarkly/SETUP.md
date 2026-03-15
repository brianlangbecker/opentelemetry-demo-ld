# Setup Guide — LaunchDarkly Integration

---

## Prerequisites

- LaunchDarkly trial account — [sign up here](https://launchdarkly.com/start-trial/)
- OTel demo running via Helm in Docker Desktop:
  ```bash
  helm repo add open-telemetry https://open-telemetry.github.io/opentelemetry-helm-charts
  helm install my-otel-demo open-telemetry/opentelemetry-demo
  ```
- Fix collector startup errors on Docker Desktop (symlink/hostmetrics issues):
  ```bash
  ./launchdarkly/scripts/fix-collector.sh
  ```

---

## Step 1: Sign Up and Get Your Keys

1. Sign up at https://launchdarkly.com/start-trial/ and log in

LaunchDarkly has three different keys — each serves a different purpose:

| Key | Where to Find It | Used For |
|-----|-----------------|----------|
| **Client-side ID** | Project → Environments → click environment | Frontend SDK — baked into the browser app at build time. Safe to expose publicly. |
| **SDK key** | Project → Environments → click environment | Server-side SDKs (Java, Go, etc.). Keep private — never put in frontend code. |
| **API access token** | Account settings → Authorization → Create token (Writer role) | REST API calls — turning flags on/off programmatically via curl or webhooks. Keep private. |

For this integration you need two:
- **Client-side ID** — for the deploy script (Step 2)
- **API access token** — for the remediate curl command (Step 5)

### Get the Client-side ID

Go to your project → **Environments** → click your environment → copy the **Client-side ID**.

---

## Step 2: Build and Deploy

The scripts bake `NEXT_PUBLIC_LD_CLIENT_ID` into the frontend image at build time, then swap the running frontend deployment to use it.

> **Note:** If you run `fix-collector.sh` after deploying the frontend, Helm will revert the frontend image back to upstream. Re-run the deploy script afterward.

### Docker

```bash
LD_CLIENT_ID="your-client-side-id" ./launchdarkly/scripts/deploy-docker.sh
```

### Kubernetes

```bash
LD_CLIENT_ID="your-client-side-id" ./launchdarkly/scripts/deploy-k8s.sh
```

The script builds the image, updates the frontend deployment, waits for rollout, then prompts to start port-forwarding at `http://localhost:8080`.

---

## Step 3: Create the Feature Flag

Once the frontend is running and connected, create the flag:

1. In the LaunchDarkly dashboard go to **Feature Flags** → **Create flag**
2. Configure:
   - Name/Key: `banner-v2-enabled`
   - Type: Boolean
   - Leave it **OFF** by default
3. Save — the connected frontend will receive it immediately

---

## Step 4: Toggle the Flag

The app maintains a live SSE (Server-Sent Events) connection to LaunchDarkly. Flag changes take effect instantly with no page reload or redeployment.

### Release

1. Find `banner-v2-enabled` in the dashboard and toggle it **ON**
2. Open `http://localhost:8080` — the banner switches immediately to the new purple gradient version

### Rollback

1. Toggle `banner-v2-enabled` **OFF**
2. The banner reverts instantly to the original gray version

This is the core of the demo — a feature change or rollback with zero deployment, zero downtime.

---

## Step 5: Remediate via curl

Use your **API access token** (not the client-side ID) to turn the flag off programmatically:

```bash
curl -X PATCH https://app.launchdarkly.com/api/v2/flags/default/banner-v2-enabled \
  -H "Authorization: api-YOUR-API-ACCESS-TOKEN" \
  -H "Content-Type: application/json; domain-model=launchdarkly.semanticpatch" \
  -d '{"instructions": [{"kind": "turnFlagOff"}]}'
```

If you haven't created an API access token yet: **Account settings → Authorization → Create token → Writer role**.

See [RELEASE-REMEDIATE.md](./docs/RELEASE-REMEDIATE.md) for the full demo sequence and talking points.

---

## Troubleshooting

**After running `fix-collector.sh`, LD stops connecting** — Helm reverted the frontend image. Re-run the deploy script with your client ID.

**Events posting to `your-client-side-id-here`** — the wrong image is running. Verify with:
```bash
kubectl get pod -l app.kubernetes.io/name=frontend -o jsonpath='{.items[0].status.containerStatuses[0].imageID}'
```
If it doesn't match your local build, re-run the deploy script.

**Banner not changing** — check browser console, verify the client-side ID in the Network tab requests matches your LD dashboard, confirm flag key is exactly `banner-v2-enabled`.

**SSE stream not connecting** — ensure outbound HTTPS to `clientstream.launchdarkly.com:443` is allowed.
