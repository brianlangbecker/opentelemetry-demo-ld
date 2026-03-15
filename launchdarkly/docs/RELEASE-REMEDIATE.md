# Release and Remediate

This document covers Part 1 of the SE technical exercise: releasing a feature via a flag toggle and remediating an incident by turning it off programmatically — with no deployment required either way.

---

## The Feature

The `banner-v2-enabled` boolean flag controls which homepage banner renders:

| Flag State | What You See |
|------------|-------------|
| OFF | Original banner — gray, "The best telescopes to see the world closer" |
| ON | New banner — purple gradient, "Experience the New Telescope Collection" |

Toggling the flag in the LaunchDarkly dashboard (or via the REST API) swaps the banner instantly with no page reload and no redeployment.

---

## Release — Toggle the Feature On

### Via the Dashboard

1. In the LaunchDarkly dashboard go to **Feature Flags** → `banner-v2-enabled`
2. Toggle it **ON**
3. Open `http://localhost:8080` — the banner swaps to the purple gradient immediately

### Via curl

```bash
curl -X PATCH https://app.launchdarkly.com/api/v2/flags/default/banner-v2-enabled \
  -H "Authorization: api-YOUR-API-KEY" \
  -H "Content-Type: application/json; domain-model=launchdarkly.semanticpatch" \
  -d '{"instructions": [{"kind": "turnFlagOn"}]}'
```

---

## Rollback — Toggle the Feature Off (Manual)

1. In the LaunchDarkly dashboard toggle `banner-v2-enabled` **OFF**
2. The banner reverts instantly to the original gray version

This is the core of the release story — a feature change or rollback with zero deployment, zero downtime.

---

## Remediate — Programmatic Trigger

"Remediate" means turning off a problematic feature via automation, not by manually clicking in the dashboard. Something goes wrong in production and the feature needs to be killed immediately — ideally before a human even opens their laptop.

The trigger can be:
- A `curl` command (simplest demo — shown below)
- An alert webhook from a monitoring tool (Grafana, Datadog, PagerDuty)
- A GitHub Actions step on a failed deployment check

### Get Your API Key

You need an **API key** with write permissions — this is different from the client-side ID used in the frontend.

1. In LD dashboard → **Account settings** → **Authorization**
2. Click **Create token**
3. Role: **Writer**
4. Copy the token — you only see it once

### Turn Off the Flag via curl

```bash
curl -X PATCH https://app.launchdarkly.com/api/v2/flags/default/banner-v2-enabled \
  -H "Authorization: api-YOUR-API-KEY" \
  -H "Content-Type: application/json; domain-model=launchdarkly.semanticpatch" \
  -d '{"instructions": [{"kind": "turnFlagOff"}]}'
```

Replace `api-YOUR-API-KEY` with your actual API token.

### What the Parts Mean

| Part | Meaning |
|------|---------|
| `PATCH /api/v2/flags/default/banner-v2-enabled` | Modify flag `banner-v2-enabled` in project `default` |
| `Authorization: api-YOUR-API-KEY` | Your write-access API token |
| `domain-model=launchdarkly.semanticpatch` | Use semantic patch format (human-readable instructions) |
| `"kind": "turnFlagOff"` | Turn the flag OFF in the default environment |

### Verify the Response

A successful update returns the full flag object. Look for `"on": false` in the environment block:

```json
{
  "name": "banner-v2-enabled",
  "kind": "boolean",
  "environments": {
    "production": {
      "on": false
    }
  }
}
```

If you get a `401`, the token format is wrong. It must be `api-YOUR-TOKEN`, not `Bearer YOUR-TOKEN`.

---

## Full Demo Sequence

Use this to walk through the complete release → incident → remediate story:

```bash
# Step 1 — Release: turn the feature ON
curl -X PATCH https://app.launchdarkly.com/api/v2/flags/default/banner-v2-enabled \
  -H "Authorization: api-YOUR-API-KEY" \
  -H "Content-Type: application/json; domain-model=launchdarkly.semanticpatch" \
  -d '{"instructions": [{"kind": "turnFlagOn"}]}'

# (Show the new purple banner in the browser — feature is live)

# Step 2 — Incident: something goes wrong, remediate immediately
curl -X PATCH https://app.launchdarkly.com/api/v2/flags/default/banner-v2-enabled \
  -H "Authorization: api-YOUR-API-KEY" \
  -H "Content-Type: application/json; domain-model=launchdarkly.semanticpatch" \
  -d '{"instructions": [{"kind": "turnFlagOff"}]}'

# (Show the original banner instantly restored — no deployment)
```

### The Talking Point

> "We detected elevated error rates on the new banner. Our monitoring fired an alert, which triggered this curl command via webhook. The feature was disabled in under a second, with zero deployment. Users were back on the stable version before the on-call engineer even opened their laptop."

---

## Using LD Triggers (Advanced)

LaunchDarkly has a native **Triggers** feature — LD generates a webhook URL and hitting it fires a pre-configured flag action. No custom API integration needed.

Useful for:
- Grafana alert webhooks
- PagerDuty runbooks
- GitHub Actions on failed deployment

Setup: LD dashboard → open the flag → **Settings** tab → **Triggers** → **Add trigger**.
