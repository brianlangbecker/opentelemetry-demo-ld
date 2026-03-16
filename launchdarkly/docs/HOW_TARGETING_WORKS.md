# How Targeting Attributes Work

This document explains the mechanics of LaunchDarkly targeting — how user context attributes flow from your app to flag evaluation rules.

---

## The Big Picture

```
Your App (browser)
  └── sends user context to LaunchDarkly
        { kind: "user", key: "uuid", isMobile: false, browser: "chrome", currencyCode: "USD" }
              |
              v
  LaunchDarkly evaluates targeting (top to bottom, first match wins)
        Individual targets: key = "your-uuid" → true    ← checked first
        Custom rule:        isMobile = false  → true    ← checked next
        Default rule:                         → false   ← fallback
              |
              v
  Returns flag value for this specific user
        → true (because isMobile = false matched)
              |
              v
  useFlags() in your component gets { bannerV2Enabled: true }
  → BannerV2 renders
```

---

## What Are Targeting Attributes?

Attributes are key-value pairs sent to LaunchDarkly via `identify()` after the app mounts. They describe the current user's environment, preferences, or identity.

In this app:

```tsx
ldClient.identify({
  kind: 'user',
  key: session.userId,        // string — unique ID per browser session
  currencyCode: 'USD',        // string — from session
  browser: 'chrome',          // string — detected from userAgent
  isMobile: false,            // boolean — detected from userAgent
});
```

LaunchDarkly doesn't know what these mean — **you define the meaning** by writing rules in the dashboard. The SDK just sends whatever you put in the context object.

---

## Rule Evaluation Order

Rules are evaluated **top to bottom** and act as **OR conditions** — the first rule that matches wins, subsequent rules are not checked.

```
Individual targets: key = "your-uuid"  → serve true   ← checked first, overrides all rules
Custom rule:        isMobile = false   → serve true   ← checked next
Default rule:                          → serve false  ← fallback for everyone else
```

A user with the individual target UUID → gets `true` immediately, rules not checked.

A desktop user (`isMobile: false`) without the individual target → matches the custom rule → gets `true`.

A mobile user (`isMobile: true`) without the individual target → does not match the custom rule → hits the default → gets `false`.

**Order matters.** Individual targets are always evaluated first, then custom rules top to bottom, then the default rule.

> **Important:** Because rules are OR conditions, make sure the default rule is set to `false` when using custom rules to restrict access. If the default is `true`, mobile users will still see the new banner despite not matching any rule.

---

## Individual Targeting vs. Rule-Based Targeting

### Individual Targeting (by key)

You explicitly name a specific user's `key` and assign them a flag value:

```
key = "a1b2c3-uuid" → serve true
```

This overrides all rules. Useful for:
- Testing on your own browser before rolling out
- Giving a specific demo attendee the new experience
- Targeting a specific QA device

To find your key, run in the browser console:
```js
JSON.parse(localStorage.getItem('session')).userId
```

### Rule-Based Targeting (Custom Rules)

Rules apply to any user whose attributes match the conditions. Useful for:
- Targeting desktop users only (`isMobile = false`) while mobile layout is reviewed
- Rolling out to specific browsers
- Gradual percentage rollouts

Rules are evaluated after individual targets. If a user's `key` is individually targeted, the rules are skipped.

---

## Operators Available in Rules

In the LD dashboard, for each attribute you can use:

| Operator | Example | Meaning |
|----------|---------|---------|
| `is one of` | `browser is one of [chrome, edge]` | Exact match against a list |
| `is not one of` | `browser is not one of [safari]` | Exclusion list |
| `contains` | `currencyCode contains USD` | Substring match |
| `starts with` | `key starts with test-` | Prefix match |
| `ends with` | `key ends with -prod` | Suffix match |
| `matches regex` | — | Regex pattern |
| `=` / `>` / `<` | `accountAge > 30` | Numeric comparison (for number types) |
| `before` / `after` | — | Date comparison |

---

## Percentage Rollouts

Instead of returning a single value for a rule match, you can split the traffic:

```
IF browser = "chrome" → serve true to 50%, false to 50%
```

LD uses the user's `key` to consistently assign them to a bucket — the same user always gets the same result. As you increase the percentage, users who were in the 50% stay in it; new users are added from the remaining pool.

This enables **gradual rollouts**:
1. Start: 10% of Chrome users → true
2. Watch metrics for 24h
3. Bump to 25%, then 50%, then 100%
4. All without a code change or deployment

---

## What Happens When the SDK Initializes

When `withLDProvider` mounts in `_app.tsx`:

1. SDK initializes client-side with an anonymous context
2. `useEffect` fires → `ldClient.identify()` is called with the real session data
3. LD evaluates **all** flags for this user against all targeting rules
4. LD returns the evaluated values for every flag
5. These are cached locally in the SDK
6. `useFlags()` reads from this local cache — no network call per hook invocation

When you toggle a flag in the LD dashboard:
1. LD re-evaluates rules for all connected users
2. Pushes new values over the SSE stream
3. SDK updates local cache
4. React re-renders components using `useFlags()`

---

## Context vs. SDK Key vs. Client-Side ID

These three things are often confused:

| Thing | What It Is | Where It Goes |
|-------|-----------|---------------|
| **Client-side ID** | Identifies your LD project/environment. Public, safe to expose. | `clientSideID` in `withLDProvider` |
| **SDK key** | Server-side auth key. Private, never expose in browser. | Backend services only |
| **User context** | Describes the current user. Used for targeting. | Passed via `ldClient.identify()` after mount |

The client-side ID authenticates your app to LD. The user context tells LD who to evaluate rules for. They're independent.

---

## Anonymous Users

This app has no login system. Each user gets a randomly generated UUID stored in `localStorage` via `SessionGateway`. That UUID is used as the `key` in `identify()`.

We do not set `anonymous: true`. While LD supports anonymous contexts, setting `anonymous: true` interferes with individual targeting by key — LD may skip individual target matching for anonymous contexts. Since we need individual targeting to work for the demo, we treat the session UUID as a real (though non-authenticated) user identity.

The `key` persists in `localStorage` across page loads, so the same browser session always evaluates flags consistently — including consistent percentage rollout bucketing.

---

## Attributes Are Evaluated Client-Side or Server-Side?

Neither — the SDK sends the context to LD's servers, which evaluate the rules and send back the result. Your targeting rule logic lives in LD, not in your app code.

This means:
- You can change rules instantly without redeploying
- Targeting logic is not visible or reversible from the browser
- All users with active connections get updated rules pushed to them in real time
