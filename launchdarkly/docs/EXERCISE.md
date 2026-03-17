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

- **OFF**: Original banner — gray background, "The best telescopes to see the world closer"
- **ON**: New banner — purple gradient, "Experience the New Telescope Collection"

**Files changed:**

| File | Change |
|------|--------|
| `src/frontend/pages/_app.tsx` | `withLDProvider` HOC wraps the app; `useLDClient().identify()` sends real user context after mount |
| `src/frontend/pages/index.tsx` | `ldClient.variation('banner-v2-enabled', false)` evaluates the flag and conditionally renders the banner |
| `src/frontend/components/Banner/BannerV2.tsx` | New banner component shown when flag is ON |
| `src/frontend/components/PlatformFlag/PlatformFlag.tsx` | Fixed module-scope `window.ENV` read that caused React hydration error |
| `src/frontend/components/ProductCard/ProductCard.tsx` | Removed OpenFeature dependency, hardcoded `imageSlowLoad = 0` |
| `src/frontend/package.json` | Replaced `@openfeature/react-sdk` with `launchdarkly-react-client-sdk` |
| `src/frontend/Dockerfile` | Added `ARG`/`ENV` for `NEXT_PUBLIC_LD_CLIENT_ID`, switched to `npm install --legacy-peer-deps` |

### The Listener

`ldClient.variation()` in `index.tsx` is the listener. The SDK subscribes to flag changes via the SSE stream that `withLDProvider` maintains to `clientstream.launchdarkly.com`. When the flag changes, the SDK re-evaluates and React re-renders automatically — no `addEventListener`, no polling, no page reload.

```tsx
const ldClient = useLDClient();
const bannerV2Enabled = ldClient?.variation('banner-v2-enabled', false) ?? false;
```

See [HOW_IT_WORKS.md](./HOW_IT_WORKS.md) for a full technical explanation.

### Remediate

Toggle via the LD dashboard (manual), or programmatically via curl using an API access token (Writer role):

```bash
curl -X PATCH https://app.launchdarkly.com/api/v2/flags/default/banner-v2-enabled \
  -H "Authorization: api-YOUR-API-ACCESS-TOKEN" \
  -H "Content-Type: application/json; domain-model=launchdarkly.semanticpatch" \
  -d '{"instructions": [{"kind": "turnFlagOff"}], "environmentKey": "test"}'
```

See [RELEASE-REMEDIATE.md](./RELEASE-REMEDIATE.md) for the full demo sequence and talking points.

---

## How Part 2 Is Implemented

### The Scenario

> You are a developer at ABC Company. The landing page gets 40,000 visitors a day. The design team has built a new banner but the mobile layout is still under review. You need to ship to desktop users first while protecting mobile users from an unfinished experience.

LaunchDarkly lets you do this entirely through targeting rules — no code, no redeployment.

### Context Attributes

The user context in `_app.tsx` is populated client-side via `ldClient.identify()` after mount:

```tsx
ldClient.identify({
  kind: 'user',
  key: session.userId,              // UUID — unique per browser session, shown in footer
  currencyCode: session.currencyCode,   // 'USD', 'EUR', etc.
  browser: getBrowser(),                // 'chrome', 'firefox', 'safari', 'edge', 'other'
  isMobile: /Mobi|Android/i.test(navigator.userAgent),
});
```

These attributes become immediately available as targeting conditions in the LD dashboard — no additional SDK changes needed.

### Individual Targeting

Before anyone else sees the new banner, you test it yourself.

The session UUID is shown in the footer of every page:
```
session-id: a1b2c3d4-e5f6-...
```

Or run in the browser console:
```js
JSON.parse(localStorage.getItem('session')).userId
```

**LD dashboard steps:**
1. Flag → **Targeting** tab → enable targeting (ON)
2. Under **Individual targets** → **Add user targets** → context kind: `user`
3. Paste your session UUID → serve **true**
4. Default rule → serve **false**
5. Save changes

Result: Only your browser session sees the new banner. 39,999 other visitors unaffected. This is a zero-risk personal test environment.

### Rule-Based Targeting — Desktop Only

With personal testing done, the goal is to ship to desktop users while the mobile layout is reviewed by the design team.

**LD dashboard steps:**
1. Flag → **Targeting** tab
2. **Add rule**
3. Context kind: `user` | Attribute: `isMobile` | operator: `is one of` | value: `false`
4. Serve: **true**
5. Default rule → serve **false**
6. Save changes

> **Important:** Rules are evaluated in order and act as OR conditions — the first match wins. Mobile users (`isMobile: true`) do not match this rule, so they fall through to the default rule which serves `false`. Make sure the default rule is set to `false`, otherwise mobile users will still see the new banner.

Result: All 40,000 daily desktop visitors see the new banner. Mobile users see the original — unaffected while the design team reviews the mobile layout.

**Talking point:** "We shipped to desktop first. No code change. No deployment. If the design team flags a mobile issue, we haven't exposed it to a single mobile user."

### Simulating Mobile on Mac (No Device Required)

`isMobile` is detected entirely from `navigator.userAgent`:
```ts
isMobile: /Mobi|Android/i.test(navigator.userAgent)
```

Chrome DevTools can spoof a mobile user agent, making it the easiest way to demo both experiences side by side on the same machine:

1. Open `http://localhost:8080` in a **normal Chrome tab** — this is your desktop session (`isMobile: false`)
2. Open a **second Chrome tab** at the same URL
3. In the second tab, open DevTools (`Cmd+Option+I`)
4. Click the **Toggle device toolbar** icon (phone icon, top-left of DevTools panel)
5. Select any mobile device (e.g., iPhone 12) from the dropdown
6. **Hard reload** (`Cmd+Shift+R`) — required so `identify()` picks up the new user agent

The second tab now has `isMobile: true`. With the desktop-only rule active, the first tab shows the new banner and the second tab shows the original — two different experiences, same machine, same URL.

### The Full Progression

| Stage | What Changes | Who Sees New Banner |
|-------|-------------|---------------------|
| 1 | Individual target: your session UUID → `true` | Just you — developer validates |
| 2 | Rule: `isMobile = false` → `true` | All desktop users |
| 3 | Flag ON globally | All 40,000 daily visitors |
| 4 | Flag OFF (if needed) | No one — instant rollback |

Each stage is a dashboard change only — no code, no deployment.

See [TARGETING.md](./TARGETING.md) for full dashboard steps, the live demo sequence, and all attribute details.

---

## Part 3: Experimentation (Extra Credit)

### The Scenario

> You are a product manager at ABC Company. The new banner has shipped to desktop users. Now you need to know if it's actually working — does the new purple banner drive more CTA clicks than the old gray one? You need data, not intuition.

LaunchDarkly's experimentation engine lets you run a statistically rigorous A/B test using the same flag you already created, without any additional infrastructure.

### Step 1 — Instrument the CTA

Add `client.track()` to the "Explore Now" button in `BannerV2.tsx` so LD can record conversions:

```tsx
import { useLDClient } from 'launchdarkly-react-client-sdk';

const client = useLDClient();

<button onClick={() => client.track('banner-cta-clicked')}>
  Explore Now
</button>
```

This fires an event to LaunchDarkly every time the button is clicked. LD records which flag variation (old or new banner) that user was assigned to at the time.

### Step 2 — Create the Experiment and Metric

1. **Create** → **Experiment**
2. Enter a name (e.g. "Banner V2 CTA Test") and hypothesis (e.g. "The new purple banner will drive more CTA clicks than the gray banner")
3. Click **Create experiment**
4. **Randomization context**: `user`
5. **Metric source**: LaunchDarkly
6. **Add metric** → **Create metric** (inline from the experiment):
   - **Name**: Banner CTA Clicks
   - **Event key**: `banner-cta-clicked` ← must match exactly what you pass to `client.track()`
   - **Event kind**: Occurrence (Binary) — did the user click at least once? Yes or no. Count would inflate results if a user clicks multiple times; Value/Size is for numeric magnitude like latency or purchase amount.
   - **Success criteria**: Higher is better
7. **Flag**: `banner-v2-enabled`
8. **Control variation**: `false` (old gray banner)
9. **Audience**: define your targeting rule, or leave open to all users
10. **Sample size** and **variation split**: 50/50
11. **Statistical approach**: Bayesian (default) or Frequentist
12. Save the experiment design

> **Important — delete all targeting rules before starting the experiment.** If the `isMobile` rule (or any other targeting rule) is active, users are served a variation by that rule before they reach the experiment's traffic allocation. LD won't count them as experiment exposures — you'll see 0 user contexts in the Results tab even with live traffic flowing. Go to the flag's **Targeting** tab, delete all rules, and leave only the default rule feeding into the experiment allocation.

> **Note:** You don't need the flag ON to create the experiment, but you must toggle it ON before starting the iteration.

### Step 3 — Generate Traffic with the Load Generator

The HTTP-based Locust users (`WebsiteUser`) make direct API calls — no browser, no JavaScript, no LD SDK. They will not fire `client.track()`.

The Playwright users (`WebsiteBrowserUser`) run a real browser, which means the LD React SDK loads and `client.track()` fires on click. You need a Playwright task that:

1. Navigates to `/`
2. Waits for the banner to render
3. Clicks "Explore Now" if it's visible

Browser traffic is already enabled in the k8s deployment (`LOCUST_BROWSER_TRAFFIC_ENABLED=true`). Control user count and spawn rate through the **Locust UI**:

1. Open `http://localhost:8080/loadgen/` (no port-forward needed — the frontend proxy routes it)
2. The test is auto-started at **10 users, spawn rate 1** — leave it at the defaults.
3. If you need to adjust: click **Stop** → **Edit** → **Start**

> **Why 10 users, not more:** Each headless Chromium instance uses ~250MB. At 10 users Locust runs ~5 browser users concurrently (~1.25GB total), well within the 3000Mi memory limit set on the load-generator pod. Bumping to 20 users risks browser crashes — you'll see `Browser.new_context: Target page, context or browser has been closed` errors in Locust if you exceed memory.

The Playwright `click_banner_cta` task runs alongside the existing browser tasks. Each run clears localStorage so LD sees a fresh userId, distributing traffic across control and variant.

> **Mobile vs. desktop:** By default, headless Playwright uses a desktop Chromium user agent, so `isMobile` resolves to `false` for all simulated users. If you add a mobile-emulated Playwright class, those users will see the old banner regardless of the experiment split — they're effectively excluded. Keep it simple: use desktop Playwright users for the experiment.

### Step 4 — Measure and Decide

1. Start the experiment in the LD dashboard
2. Let it run — expect **30-60 minutes** to accumulate enough conversions for statistical significance. At ~0.9 RPS on the browser task with a 50/50 split, roughly half the runs land on the purple banner and fire a conversion event. LD needs hundreds of conversions per variation before it can declare a winner.
3. Watch the **Results** tab — it shows raw conversion counts per variation and confidence level building up. "Insufficient data" will clear once thresholds are met.
4. LD's stats engine declares a winner — ship the winning variation by toggling the flag fully ON, or roll back with a single toggle. No deployment required.

> **NOTE — Implementation Status**
>
> The experiment wiring is complete and verified correct end-to-end. The debug event payload from LD Live Events confirmed:
>
> ```json
> "context": { "kind": "user", "key": "7bf774e8-...", "browser": "chrome", "isMobile": false },
> "reason": { "kind": "FALLTHROUGH", "inExperiment": true }
> ```
>
> Real identified userId, correct variation, `inExperiment:true` — the SDK is doing everything right. Despite this, the Results tab showed 0 exposures across multiple iterations and 60+ minutes of load generator traffic. No code changes remain to try.

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
- LaunchDarkly's React SDK handles SSE and real-time updates natively via `withLDProvider`
- Fewer moving parts — no flagd container needed
- `ldClient.variation()` is used instead of `useFlags()` — required for experiment exposure tracking

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

1. Deploy: `LD_CLIENT_ID="your-id" ./launchdarkly/scripts/deploy-k8s.sh`
2. Open `http://localhost:8080` — original gray banner visible, flag OFF globally

**Part 1 — Release and Remediate:**

3. Toggle `banner-v2-enabled` ON in LD dashboard — new purple banner appears instantly, no page reload
4. Toggle OFF — reverts instantly (rollback)
5. Run the curl command — demonstrate programmatic remediation via API

**Part 2 — Targeting:**

6. Enable targeting (flag ON with targeting rules)
7. Add individual target: your session UUID → `true`, default rule → `false`
   - Your browser shows new banner; open a second browser to show it still sees original
8. Add rule: `isMobile = false` → `true`
   - All desktop visitors see new banner; open on a phone to show mobile still sees original
9. Toggle flag ON globally — all users get new banner
10. Toggle flag OFF — instant rollback across all browsers and devices
