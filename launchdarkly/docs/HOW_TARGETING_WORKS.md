# How Targeting Attributes Work

This document explains the mechanics of LaunchDarkly targeting — how user context attributes flow from your app to flag evaluation rules.

---

## The Big Picture

```
Your App (browser)
  └── sends user context to LaunchDarkly
        { browser: "chrome", isMobile: false, currencyCode: "USD" }
              |
              v
  LaunchDarkly evaluates targeting rules (top to bottom)
        Rule 1: IF browser = "chrome" → true
        Rule 2: IF isMobile = true → true
        Default: → false
              |
              v
  Returns flag value for this specific user
        → true (because browser matched Rule 1)
              |
              v
  useFlags() in your component gets { 'banner-v2-enabled': true }
  → BannerV2 renders
```

---

## What Are Targeting Attributes?

Attributes are key-value pairs you attach to the user context when initializing `LDProvider`. They describe the current user's environment, preferences, or identity.

In this app:

```tsx
context={{
  kind: 'user',
  key: session.userId,        // string — unique ID per browser session
  anonymous: true,            // boolean — no real login
  currencyCode: 'USD',        // string — from session
  browser: 'chrome',          // string — detected from userAgent
  isMobile: false,            // boolean — detected from userAgent
}}
```

LaunchDarkly doesn't know what these mean — **you define the meaning** by writing rules in the dashboard. The SDK just sends whatever you put in the context object.

---

## Rule Evaluation Order

Rules are evaluated **top to bottom**. The first rule that matches wins — subsequent rules are not checked.

```
Rule 1: IF browser = "chrome" AND isMobile = false → serve true
Rule 2: IF currencyCode = "USD" → serve true
Rule 3: IF isMobile = true → serve true
Default rule: serve false
```

A Chrome desktop user matches Rule 1 and gets `true`. LD stops there, never checks Rules 2 or 3.

A Firefox USD user doesn't match Rule 1, skips to Rule 2, matches, gets `true`.

A Safari mobile non-USD user skips Rules 1 and 2, matches Rule 3, gets `true`.

A Firefox desktop non-USD user matches no rules, hits the default, gets `false`.

**Order matters.** Put your most specific rules first.

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

### Rule-Based Targeting

Rules apply to any user whose attributes match the conditions. Useful for:
- Rolling out to all Chrome users
- Targeting mobile devices
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

When `LDProvider` loads in `_app.tsx`:

1. It sends the user context to LaunchDarkly's servers
2. LD evaluates **all** flags for this user against all targeting rules
3. LD returns the evaluated values for every flag
4. These are cached locally in the SDK
5. `useFlags()` reads from this local cache — no network call per hook invocation

When you toggle a flag in the LD dashboard:
1. LD re-evaluates rules for all connected users
2. Pushes new values over the WebSocket
3. SDK updates local cache
4. React re-renders components using `useFlags()`

---

## Context vs. SDK Key vs. Client-Side ID

These three things are often confused:

| Thing | What It Is | Where It Goes |
|-------|-----------|---------------|
| **Client-side ID** | Identifies your LD project/environment. Public, safe to expose. | `clientSideID` prop on `LDProvider` |
| **SDK key** | Server-side auth key. Private, never expose in browser. | Backend services only |
| **User context** | Describes the current user. Used for targeting. | `context` prop on `LDProvider` |

The client-side ID authenticates your app to LD. The user context tells LD who to evaluate rules for. They're independent.

---

## Anonymous Users

When `anonymous: true` is set:

- LD does not store the user's profile in the dashboard
- Rules still evaluate normally based on other attributes (`browser`, `isMobile`, etc.)
- The `key` is still used for consistent percentage rollout bucketing
- Useful when there's no login system — attributes still work for targeting

In this app, every user is anonymous but still gets targeted based on browser type and device.

---

## Attributes Are Evaluated Client-Side or Server-Side?

Neither — the SDK sends the context to LD's servers, which evaluate the rules and send back the result. Your targeting rule logic lives in LD, not in your app code.

This means:
- You can change rules instantly without redeploying
- Targeting logic is not visible or reversible from the browser
- All users with active connections get updated rules pushed to them in real time
