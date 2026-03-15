# SE Technical Exercise — Implementation Guide

This document maps the LaunchDarkly SE technical exercise requirements to the implementation in this repo.

---

## Exercise Requirements

### Part 1: Release and Remediate

> **Feature Flag**: Implement a flag around a specific new feature. Demonstrate releasing the feature by toggling the flag on, and rolling it back by toggling it off.

> **Instant releases/rollbacks**: Implement a "listener" such that when the flag is toggled, the application instantly switches to the new/old code (no page reload required).

> **Remediate**: Use a trigger to turn off a problematic feature (can be done manually via curl or via a browser).

### Part 2: Target

> Target a specific feature to different user segments using context attributes and targeting rules.

### Part 3 (Extra Credit): Experimentation

> Define a metric, create an experiment, connect it to a flag variation.

### Part 4 (Extra Credit): AI Configs

> Use LaunchDarkly JSON config flags to configure an LLM/AI feature.

---

## How Part 1 Is Implemented

### The Feature

The `banner-v2-enabled` boolean flag controls which homepage banner renders:

- **OFF**: Original banner — gray background, "The best telescopes in the universe"
- **ON**: New banner — purple gradient, "Experience the New Telescope Collection"

**Files changed:**
- `src/frontend/pages/_app.tsx` — `LDProvider` wraps the app
- `src/frontend/pages/index.tsx` — `useFlags()` evaluates the flag
- `src/frontend/components/Banner/BannerV2.tsx` — new banner component

### The Listener

`useFlags()` in `index.tsx` is the listener. It subscribes to flag changes via the WebSocket connection that `LDProvider` maintains to `sdk.launchdarkly.com`. When the flag changes, React re-renders automatically — no `addEventListener`, no polling, no page reload.

See [HOW_IT_WORKS.md](./HOW_IT_WORKS.md) for a full technical explanation.

### Remediate

Toggle via the LD dashboard (manual), or programmatically via curl:

```bash
curl -X PATCH https://app.launchdarkly.com/api/v2/flags/default/banner-v2-enabled \
  -H "Authorization: api-YOUR-API-KEY" \
  -H "Content-Type: application/json; domain-model=launchdarkly.semanticpatch" \
  -d '{"instructions": [{"kind": "turnFlagOff"}]}'
```

See [RELEASE-REMEDIATE.md](./RELEASE-REMEDIATE.md) for full details.

---

## How Part 2 Is Implemented

The user context in `_app.tsx` includes targeting attributes:

```tsx
context={{
  kind: 'user',
  key: session.userId,
  anonymous: true,
  currencyCode: session.currencyCode,   // 'USD', 'EUR', etc.
  browser: getBrowser(),                 // 'chrome', 'firefox', 'safari', 'edge'
  isMobile: /Mobi|Android/i.test(navigator.userAgent),
}}
```

**Targeting rule examples** (configured in LD dashboard):

| Rule | Effect |
|------|--------|
| `browser = "chrome"` → ON | Chrome users see new banner first |
| `isMobile = true` → ON | Mobile users get new banner |
| `currencyCode = "USD"` → ON | US region gets new banner first |
| Percentage rollout 10% | Gradual rollout to 10% of all users |

See [TARGETING.md](./TARGETING.md) for the full targeting guide.

---

## Part 3: Experimentation (Extra Credit)

Not yet implemented. To add:

1. Define a metric in LD (e.g., clicks on the "Explore Now" button in BannerV2)
2. Create an experiment: control = old banner, variant = new banner
3. Track events via the SDK:

```tsx
import { useLDClient } from 'launchdarkly-react-client-sdk';

const client = useLDClient();

// When user clicks the CTA
client.track('banner-cta-clicked');
```

4. Run experiment → collect data → use LD's stats engine to determine winner

---

## Part 4: AI Configs (Extra Credit)

Not yet implemented. The OTel demo has no LLM features, but AI Configs could be added by:

1. Creating a JSON config flag in LD:

```json
{
  "model": "claude-sonnet-4-6",
  "systemPrompt": "You are a helpful telescope shopping assistant...",
  "temperature": 0.7,
  "maxTokens": 500
}
```

2. Evaluating the config flag (returns the JSON object) and passing it to an LLM API call
3. Varying prompts, models, or parameters via the flag without code changes

---

## Options Not Taken — Why

### Backend service instrumentation (Java/Go)

The exercise could have been implemented in the Java AdService or Go services. Frontend was chosen because:
- Most immediately visible (UI changes are instant and obvious)
- Best demonstrates the "no page reload" listener requirement
- Easier to show targeting (browser, mobile are visually demonstrable)
- No need to rebuild/redeploy containers to see flag changes

### OpenFeature / flagd (original setup)

The demo originally used OpenFeature with flagd as a proxy layer. This was replaced with the LaunchDarkly SDK directly because:
- LaunchDarkly's React SDK handles WebSocket and real-time updates natively
- Fewer moving parts — no flagd container needed
- The `useFlags()` hook is the simplest possible implementation of the "listener" requirement

### `isPremium`, `accountAge`, `email` attributes

These were in an earlier draft of the context but removed because the session object doesn't provide them. Hardcoded fake attributes make targeting rules meaningless — every user would have identical values.

---

## Language/Service Summary

| Component | Language | SDK | Purpose |
|-----------|----------|-----|---------|
| Frontend | TypeScript/React | `launchdarkly-react-client-sdk` | Banner flag, targeting, instant updates |

---

## Why the OTel Demo

1. **Production-like architecture** — multi-service, polyglot setup mirrors real customer environments
2. **Built-in observability** — OTel instrumentation makes it easy to monitor flag changes and rollout impact
3. **Realistic scenarios** — product recommendations, payments, UI are real features worth flagging
4. **Multiple language options** — can demonstrate SDK usage across different tech stacks

---

## Running the Full Demo

1. Start the app: `npm run dev` in `src/frontend/` (or K8s deploy)
2. Open `http://localhost:3000` — original banner visible
3. In LD dashboard, toggle `banner-v2-enabled` ON — new banner appears instantly
4. Add targeting rule `browser = "chrome"` — demonstrate per-browser targeting
5. Toggle OFF in dashboard — reverts instantly (rollback)
6. Run the curl command — demonstrate programmatic remediation
