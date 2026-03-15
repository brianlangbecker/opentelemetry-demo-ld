# Targeting — Individual and Rule-Based

This document covers Part 2 of the SE technical exercise: using context attributes to target the `banner-v2-enabled` flag to specific users and segments, simulating a real-world progressive rollout to 40,000 daily visitors.

---

## The Scenario

> You are a developer at ABC Company. The landing page gets 40,000 visitors a day. You want to ship the new banner safely — test it yourself first, then expand to your team, then to a broader segment, then to everyone.

LaunchDarkly lets you do this entirely through targeting rules — no redeployment at any stage.

---

## User Context

**File:** `src/frontend/pages/_app.tsx`

The context is populated client-side after hydration:

```tsx
useEffect(() => {
  const session = SessionGateway.getSession();
  setLdContext({
    kind: 'user',
    key: session.userId,              // UUID from localStorage — unique per browser session
    anonymous: true,
    currencyCode: session.currencyCode,   // 'USD', 'EUR', etc.
    browser: getBrowser(),                // 'chrome', 'firefox', 'safari', 'edge', 'other'
    isMobile: /Mobi|Android/i.test(navigator.userAgent),
  });
}, []);
```

### Attribute Breakdown

| Attribute | Source | Values | Targeting Use |
|-----------|--------|--------|---------------|
| `key` | `localStorage` UUID | e.g. `"a1b2c3..."` | Individual targeting — uniquely identifies this browser session |
| `anonymous` | hardcoded | `true` | Tells LD not to store the user profile (no login required) |
| `currencyCode` | session | `"USD"`, `"EUR"`, etc. | Regional rollout — USD users before other regions |
| `browser` | `navigator.userAgent` | `"chrome"`, `"firefox"`, `"safari"`, `"edge"`, `"other"` | Team rollout — internal team uses Chrome |
| `isMobile` | `navigator.userAgent` | `true` / `false` | De-risk mobile — ship desktop first |

---

## Individual Targeting

Individual targeting serves a specific flag value to a specific user by their `key`. This is how you test the feature yourself before anyone else sees it.

### Find Your Session ID

Your `key` is the session UUID shown in the footer of every page:

```
session-id: a1b2c3d4-e5f6-...
```

Or run in the browser console:
```js
JSON.parse(localStorage.getItem('session')).userId
```

### Add an Individual Target in LD

1. Open the flag in the LD dashboard → **Targeting** tab
2. Under **Individual targets** → **Add user targets**
3. Paste your `key` (session UUID)
4. Set variation to **true**
5. Save — only your browser session sees the new banner

Everyone else still sees the old banner. This is your personal test environment with zero risk to other users.

---

## Rule-Based Targeting

Rules evaluate context attributes against conditions and serve a variation to all matching users. This is how you expand beyond yourself to groups.

### Setting Up a Rule in LD

Flag → **Targeting** tab → **Add rule** → set attribute, operator, value → set variation → Save.

---

## The Rollout Progression

Use this sequence to tell the full ABC Company story. Each step is a targeting change only — no code, no deployment.

### Stage 1: Developer Testing (Individual)

**Goal:** Verify the feature works before anyone else sees it.

In LD dashboard → **Individual targets** → add your session UUID → serve `true`.

Result: Only your browser sees the new banner. 39,999 other visitors unaffected.

---

### Stage 2: Internal Team (Rule — browser)

**Goal:** Expand to your team for broader testing. Your team uses Chrome internally.

Add rule:
```
IF browser = "chrome" THEN serve → true
```

Result: All Chrome users see the new banner. Safari, Firefox, Edge users still see the old one. Your internal team can validate across their machines without exposing the change to the full user base.

---

### Stage 3: Desktop Only (Rule — isMobile)

**Goal:** Expand to all desktop users, but hold mobile back while the mobile layout is reviewed.

Update the Chrome rule to cover all desktop users:
```
IF isMobile = false THEN serve → true
```

Result: All desktop visitors see the new banner regardless of browser. Mobile users still see the old banner.

---

### Stage 4: Percentage Rollout (Rule — gradual)

**Goal:** Gradually expose all users, catching any edge cases before full release.

Replace the desktop rule with a percentage rollout:
```
DEFAULT RULE → serve → 10% true, 90% false
```

Increase the percentage over time: 10% → 25% → 50% → 100%.

Result: A random but consistent slice of all 40,000 daily visitors sees the new banner. LD uses the user `key` to ensure the same user always gets the same variation — no flickering.

---

### Stage 5: Full Release

**Goal:** Ship to everyone.

Toggle the flag **ON** globally (serves `true` to all users regardless of rules), or set the default rule to 100% `true`.

---

### Stage 6: Rollback (if needed)

At any stage, toggle the flag **OFF** to instantly revert every user to the old banner. No deployment required.

---

## The Live Demo

This sequence works live in front of an audience:

1. Open the app in Chrome — old banner (flag OFF globally)
2. Add individual target for your session ID → ON — your browser shows new banner, open another browser to show it's still old
3. Add rule `browser = "chrome"` → ON — refresh shows new banner in Chrome
4. Open same URL in Safari — still old banner
5. Remove Chrome rule, add `isMobile = false` → ON — desktop universally gets new banner
6. Toggle flag OFF — everything reverts instantly across all browsers

---

## Why These Attributes?

**`browser`** — derivable from `navigator.userAgent` without any login. Immediately demonstrable by opening the app in different browsers side by side.

**`isMobile`** — same source. Compelling demo: show the same URL behaving differently on a phone vs desktop.

**`currencyCode`** — already in the session from the app's existing currency selector. Creates a believable regional rollout story (USD users before EUR, etc.).

**What was removed:** Earlier drafts included `email`, `isPremium`, and `accountAge` — none of these exist in the session object. Hardcoded fake attributes make targeting rules meaningless since every user would have identical values.

---

## Adding More Attributes

Any attribute added to the context in `_app.tsx` becomes available in the LD dashboard immediately:

```tsx
setLdContext({
  kind: 'user',
  key: session.userId,
  anonymous: true,
  currencyCode: session.currencyCode,
  browser: getBrowser(),
  isMobile: /Mobi|Android/i.test(navigator.userAgent),
  // examples of additional attributes:
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  language: navigator.language,
});
```

No SDK changes required — just add the field and it appears as a targetable attribute in the LD rule builder.
