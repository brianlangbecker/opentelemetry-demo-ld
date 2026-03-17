# Setup Guide — LaunchDarkly Integration

> **Note:** This integration was built and tested on Kubernetes (Docker Desktop). The Docker Compose path has not been fully validated.

---

## Prerequisites

- Docker Desktop with Kubernetes enabled
- `helm` and `kubectl` installed

---

## Step 1: Install the OTel Demo

```bash
helm repo add open-telemetry https://open-telemetry.github.io/opentelemetry-helm-charts
helm install my-otel-demo open-telemetry/opentelemetry-demo
```

Then fix collector startup errors (symlink/hostmetrics issues on Docker Desktop):

```bash
./launchdarkly/scripts/fix-collector.sh
```

---

## Step 2: Sign Up and Get Your Keys

1. Sign up at https://launchdarkly.com/start-trial/ and log in

LaunchDarkly has three different keys — each serves a different purpose:

| Key | Where to Find It | Used For |
|-----|-----------------|----------|
| **Client-side ID** | Project → Environments → click environment | Frontend SDK — baked into the browser app at build time. Safe to expose publicly. |
| **SDK key** | Project → Environments → click environment | Server-side SDKs (Java, Go, etc.). Keep private — never put in frontend code. |
| **API access token** | Account settings → Authorization → Create token (Writer role) | REST API calls — turning flags on/off programmatically via curl or webhooks. Keep private. |

For this integration you need two:
- **Client-side ID** — for the deploy script (Step 2)
- **API access token** — for the remediate curl command (Step 6)

### Get the Client-side ID

Go to your project → **Environments** → click your environment → copy the **Client-side ID**.

---

## Step 3: Build and Deploy

With your client-side ID in hand, run the deploy script. It builds the frontend image with the LD client ID baked in and redeploys it:

```bash
LD_CLIENT_ID="your-client-side-id" ./launchdarkly/scripts/deploy-k8s.sh
```

The script builds the image, updates the frontend deployment, waits for rollout, then prompts to start port-forwarding at `http://localhost:8080`.

> **Note:** The first build can take 10-20 minutes — it downloads the base Node image and installs all npm dependencies. Subsequent builds are much faster thanks to Docker layer caching.

---

## Step 4: Create the Feature Flag

Once the frontend is running and connected, create the flag:

1. In the LaunchDarkly dashboard go to **Feature Flags** → **Create flag**
2. Configure:
   - Name/Key: `banner-v2-enabled`
   - Type: Boolean
   - Leave it **OFF** by default
3. Save — the connected frontend will receive it immediately

---

## Step 5: Toggle the Flag

The app maintains a live SSE (Server-Sent Events) connection to LaunchDarkly. Flag changes take effect instantly with no page reload or redeployment.

### Release

1. Find `banner-v2-enabled` in the dashboard and toggle it **ON**
2. Open `http://localhost:8080` — the banner switches immediately to the new purple gradient version

### Rollback

1. Toggle `banner-v2-enabled` **OFF**
2. The banner reverts instantly to the original gray version

This is the core of the demo — a feature change or rollback with zero deployment, zero downtime.

---

## Step 6: Individual Targeting — Test It Yourself First

Before releasing to anyone else, target only your own browser session to verify the flag works. This is individual targeting.

### Find Your Session ID

Open `http://localhost:8080` and scroll to the bottom of the page. The footer shows:

```
session-id: a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

Copy that value — it is your user `key` in LaunchDarkly.

### Add an Individual Target

1. In the LD dashboard → **Feature Flags** → `banner-v2-enabled` → **Targeting** tab
2. Make sure the flag targeting is **On** (the targeting toggle at the top — separate from the flag default)
3. Under **Individual targets** → **Add user targets**
4. Paste your session UUID
5. Set variation to **true**
6. Click **Review and save**

The new banner now appears only in your browser. Open the same URL in a different browser or incognito window — it still shows the old banner. Nobody else is affected.

### Expand to Rule-Based Targeting

Once you've verified it works, move to rule-based targeting to expand the rollout:

| Stage | Rule in LD | Who Sees It |
|-------|-----------|-------------|
| 1 | Individual: your session UUID | Just you |
| 2 | `browser = "chrome"` → true | Internal team (Chrome users) |
| 3 | `isMobile = false` → true | All desktop users |
| 4 | Default rule: 10% → true | Gradual rollout — increase over time |
| 5 | Flag ON globally | Everyone |

See [docs/TARGETING.md](./docs/TARGETING.md) for full dashboard steps for each stage.

---

## Step 7: Remediate via curl

Use your **API access token** (not the client-side ID) to turn the flag off programmatically:

```bash
curl -X PATCH https://app.launchdarkly.com/api/v2/flags/default/banner-v2-enabled \
  -H "Authorization: api-YOUR-API-ACCESS-TOKEN" \
  -H "Content-Type: application/json; domain-model=launchdarkly.semanticpatch" \
  -d '{"instructions": [{"kind": "turnFlagOff"}], "environmentKey": "test"}'
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
