# LaunchDarkly Integration — OpenTelemetry Demo

This directory contains all documentation and scripts for the LaunchDarkly feature flag integration built on top of the OpenTelemetry demo project.

---

## What Was Built

A feature flag integration that demonstrates **Release**, **Remediate**, and **Target** using a real frontend React (Next.js) app with no page reload required on flag changes.

**The Feature:** A homepage banner swap controlled by a LaunchDarkly boolean flag.

| Flag State | What You See |
|------------|-------------|
| OFF | Original banner — gray, "The best telescopes..." |
| ON | New banner — purple gradient, "Experience the New Telescope Collection" |

Toggling the flag in the LaunchDarkly dashboard instantly swaps the banner with no page reload. Toggling it back instantly reverts it.

---

## Documents

| File | What It Covers |
|------|---------------|
| [SETUP.md](./SETUP.md) | Step-by-step setup from zero to running |
| [docs/EXERCISE.md](./docs/EXERCISE.md) | Exercise requirements mapped to implementation |
| [docs/HOW_IT_WORKS.md](./docs/HOW_IT_WORKS.md) | Technical deep dive: LDProvider, useFlags, WebSocket listener, context |
| [docs/HOW_TARGETING_WORKS.md](./docs/HOW_TARGETING_WORKS.md) | How targeting attributes are evaluated: rules, operators, rollouts |
| [docs/TARGETING.md](./docs/TARGETING.md) | User context, custom attributes, browser/mobile targeting in this app |
| [docs/RELEASE-REMEDIATE.md](./docs/RELEASE-REMEDIATE.md) | Programmatic flag triggers via curl and the LD REST API |
| [docs/KUBERNETES.md](./docs/KUBERNETES.md) | Kubernetes deployment notes |
| [docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md) | Common errors and fixes |
| [docs/DEBUGGING_JOURNAL.md](./docs/DEBUGGING_JOURNAL.md) | Step-by-step record of diagnosing why the flag wasn't toggling the banner |

## Scripts

| Script | What It Does |
|--------|-------------|
| [scripts/deploy-docker.sh](./scripts/deploy-docker.sh) | Builds frontend image with LD client ID and deploys via Docker Compose |
| [scripts/deploy-k8s.sh](./scripts/deploy-k8s.sh) | Builds frontend image with LD client ID and deploys to Kubernetes |
| [scripts/fix-collector.sh](./scripts/fix-collector.sh) | Fixes OTel collector startup errors on Docker Desktop |

---

## Quick Reference

### Files Changed in This Repo

```
src/frontend/
  pages/_app.tsx                      # LDProvider wraps app with user context
  pages/index.tsx                     # useFlags() evaluates banner-v2-enabled
  components/Banner/BannerV2.tsx      # New banner component (flag = ON)
  components/ProductCard/ProductCard.tsx  # Removed OpenFeature dependency
  Dockerfile                          # Accepts NEXT_PUBLIC_LD_CLIENT_ID as build arg
  package.json                        # Replaced OpenFeature with launchdarkly-react-client-sdk
```

### Flag Name

```
banner-v2-enabled
```
Type: Boolean. OFF = old banner. ON = new banner.

### Client-side ID

Passed at build time via the deploy script:

```bash
LD_CLIENT_ID="your-client-side-id" ./launchdarkly/scripts/deploy-k8s.sh
```

The ID is baked into the frontend image during `docker build`. It is **not** set as a runtime environment variable.
