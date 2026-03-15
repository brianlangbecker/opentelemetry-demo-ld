# Targeting — User Context & Custom Attributes

This document explains the user context passed to LaunchDarkly and how to use custom attributes for targeted flag rollouts.

---

## What Is Targeting?

Targeting lets you control which users see a feature based on their attributes — rather than turning a flag on for everyone at once. Examples:

- "Roll out the new banner to Chrome users first"
- "Only show the feature to mobile users"
- "Enable for USD currency users before other regions"

LaunchDarkly evaluates the user context on every flag request to decide what value to return for that specific user.

---

## Current User Context

**File:** `src/frontend/pages/_app.tsx`

```tsx
context={{
  kind: 'user',
  key: session.userId,
  anonymous: true,
  currencyCode: session.currencyCode,
  browser: isClient ? getBrowser() : 'unknown',
  isMobile: isClient ? /Mobi|Android/i.test(navigator.userAgent) : false,
}}
```

### Attribute Breakdown

| Attribute | Source | Values | Use Case |
|-----------|--------|--------|----------|
| `key` | `localStorage` UUID | e.g. `"a1b2c3..."` | Uniquely identifies the browser session |
| `anonymous` | hardcoded | `true` | Tells LD not to store user profile (no login) |
| `currencyCode` | session | `"USD"`, `"EUR"`, etc. | Target by region/currency |
| `browser` | `navigator.userAgent` | `"chrome"`, `"firefox"`, `"safari"`, `"edge"`, `"other"` | Target by browser |
| `isMobile` | `navigator.userAgent` | `true` / `false` | Target mobile vs desktop |

---

## Why These Attributes?

### What Was Removed and Why

The original context had `email`, `isPremium`, and `accountAge` — none of these exist in the app:

```tsx
// WRONG — these don't exist on the session object
email: session.email || undefined,  // session has no email field
isPremium: false,                   // hardcoded fake data
accountAge: 0,                      // hardcoded fake data
```

Fake hardcoded attributes make targeting rules meaningless — every user would have identical values, so rules could never differentiate between users.

### What Was Added and Why

**`currencyCode`** — already in the session, reflects user preference, creates a believable regional rollout story.

**`browser`** — derivable from `navigator.userAgent` without any login, immediately demonstrable by opening the app in different browsers.

**`isMobile`** — same source, creates a compelling demo (walk over to a phone and show it works differently).

---

## No Real Users? No Problem

Since this app has no authentication, `anonymous: true` is the correct approach.

LaunchDarkly generates and persists a random key in `localStorage` for anonymous users, ensuring the same browser session gets consistent flag evaluations. The `session.userId` UUID already serves this purpose here.

### How Anonymous Targeting Works

Even with `anonymous: true`, targeting rules still work based on other attributes:

```
IF browser = "chrome" THEN → ON
IF isMobile = true THEN → ON
IF currencyCode = "USD" THEN → ON
ELSE → OFF (default)
```

The user doesn't need to be logged in — the attributes are what matter.

---

## Setting Up Targeting Rules in LaunchDarkly

### Individual Targeting (by key)

In the LD dashboard → flag → **Targeting** tab:
1. Under **Individual targets**, add a specific `key` (userId)
2. Set to ON or OFF
3. Good for testing — target your own browser session specifically

To find your `key`, run this in the browser console:
```js
JSON.parse(localStorage.getItem('session')).userId
```

### Rule-Based Targeting

In the LD dashboard → flag → **Targeting** tab → **Add rule**:

**Example: Chrome users only**
```
IF browser = "chrome" THEN serve → true
```

**Example: Mobile users first**
```
IF isMobile = true THEN serve → true
```

**Example: USD rollout**
```
IF currencyCode = "USD" THEN serve → true
```

**Example: Percentage rollout**
```
IF browser = "chrome" THEN serve → 50% true, 50% false
```

### Default Rule

At the bottom of targeting rules, set the **default rule** — what users get if no targeting rules match. Keep this as `false` (off) so untargeted users see the old experience.

---

## The Demo Story

With browser + mobile targeting, you can tell this story live:

1. Open the app in Chrome on desktop — show the old banner (flag OFF globally)
2. In LD dashboard, add rule: `IF browser = "chrome" THEN → ON`
3. Chrome desktop instantly shows the new banner
4. Open the same URL in Safari — still shows the old banner
5. Open on a mobile device — add `isMobile = true` rule to also include mobile
6. Roll back: remove rules or turn flag OFF — everything reverts instantly

This is a targeted release followed by a targeted rollback.

---

## Adding More Attributes

To add more targeting attributes, update the context in `_app.tsx`:

```tsx
context={{
  kind: 'user',
  key: session.userId,
  anonymous: true,
  currencyCode: session.currencyCode,
  browser: isClient ? getBrowser() : 'unknown',
  isMobile: isClient ? /Mobi|Android/i.test(navigator.userAgent) : false,
  // Add more here:
  timezone: isClient ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'unknown',
  language: isClient ? navigator.language : 'unknown',
}}
```

Any attribute you add here becomes available for targeting rules in the LD dashboard immediately — no SDK changes required.
