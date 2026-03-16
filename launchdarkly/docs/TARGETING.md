# Targeting — Individual and Rule-Based

This document covers Part 2 of the SE technical exercise: using context attributes to target the `banner-v2-enabled` flag to specific users and segments, simulating a real-world progressive rollout to 40,000 daily visitors.

---

## The Scenario

> You are a developer at ABC Company. The landing page gets 40,000 visitors a day. The design team has built a new banner but the mobile layout is still under review. You need to ship to desktop users first while protecting mobile users from an unfinished experience.

LaunchDarkly lets you do this entirely through targeting rules — no redeployment at any stage.

---

## User Context

**File:** `src/frontend/pages/_app.tsx`

The context is sent to LD via `ldClient.identify()` after the app mounts:

```tsx
const ldClient = useLDClient();

useEffect(() => {
  if (!ldClient) return;
  const session = SessionGateway.getSession();
  ldClient.identify({
    kind: 'user',
    key: session.userId,              // UUID from localStorage — unique per browser session
    currencyCode: session.currencyCode,   // 'USD', 'EUR', etc.
    browser: getBrowser(),                // 'chrome', 'firefox', 'safari', 'edge', 'other'
    isMobile: /Mobi|Android/i.test(navigator.userAgent),
  });
}, [ldClient]);
```

### Attribute Breakdown

| Attribute | Source | Values | Targeting Use |
|-----------|--------|--------|---------------|
| `key` | `localStorage` UUID | e.g. `"a1b2c3..."` | Individual targeting — uniquely identifies this browser session |
| `currencyCode` | session | `"USD"`, `"EUR"`, etc. | Regional rollout — USD users before other regions |
| `browser` | `navigator.userAgent` | `"chrome"`, `"firefox"`, `"safari"`, `"edge"`, `"other"` | Browser-specific rollout |
| `isMobile` | `navigator.userAgent` | `true` / `false` | De-risk mobile — ship desktop first |

> Note: `anonymous: true` is intentionally omitted. Setting it interferes with individual targeting by key — LD may skip individual target matching for anonymous contexts.

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

1. Open the flag in the LD dashboard → **Targeting** tab → enable targeting (ON)
2. Under **Individual targets** → **Add user targets** → context kind: `user`
3. Paste your `key` (session UUID)
4. Set variation to **true**
5. Default rule → serve **false**
6. Save — only your browser session sees the new banner

Everyone else still sees the old banner. This is your personal test environment with zero risk to other users.

---

## Rule-Based Targeting (Custom Rules)

Custom rules evaluate context attributes against conditions and serve a variation to all matching users. Rules are evaluated in order — the first match wins (OR logic). This is how you expand beyond yourself to groups.

> **Important:** Rules act as OR conditions — the first matching rule wins and evaluation stops. Always set the default rule to `false` when using rules to restrict access, otherwise users who don't match any rule will fall through to `true`.

### Setting Up a Rule in LD

Flag → **Targeting** tab → **Add rule** → context kind: `user` → set attribute, operator, value → set variation → Save.

---

## The Rollout Progression

Use this sequence to tell the full ABC Company story. Each step is a targeting change only — no code, no deployment.

### Stage 1: Developer Testing (Individual Target)

**Goal:** Verify the feature works before anyone else sees it.

1. Flag → **Targeting** tab → enable targeting (ON)
2. **Individual targets** → **Add user targets** → context kind: `user` → paste your session UUID → serve `true`
3. Default rule → serve `false`
4. Save

Result: Only your browser sees the new banner. 39,999 other visitors unaffected.

---

### Stage 2: Desktop Only (Custom Rule — isMobile)

**Goal:** Expand to all desktop users, but hold mobile back while the mobile layout is reviewed.

1. Remove or keep the individual target
2. **Add rule** → context kind: `user` → attribute: `isMobile` → operator: `is one of` → value: `false` → serve `true`
3. Default rule → serve `false`
4. Save

Result: All desktop visitors see the new banner regardless of browser. Mobile users still see the old banner.

**Talking point:** "We shipped to desktop first. No code change. No deployment. Mobile users are completely unaffected while design reviews the mobile layout."

---

### Stage 3: Full Release

**Goal:** Ship to everyone.

Toggle the flag **ON** globally (serves `true` to all users regardless of rules).

---

### Stage 4: Rollback (if needed)

At any stage, toggle the flag **OFF** to instantly revert every user to the old banner. No deployment required.

---

## The Live Demo

This sequence works live in front of an audience:

1. Open the app in Chrome — old banner (flag OFF globally)
2. Add individual target for your session UUID → serve `true`, default rule → `false`
   - Your browser shows new banner; open a second browser to confirm it still shows original
3. Add custom rule: `isMobile = false` → `true`, default rule → `false`
   - All desktop visitors now see new banner
4. Simulate mobile: open a second Chrome tab, enable DevTools device toolbar (phone icon), select iPhone, hard reload (`Cmd+Shift+R`)
   - Mobile tab shows original banner; desktop tab shows new banner — side by side, same machine
5. Toggle flag OFF — everything reverts instantly across all browsers and devices

### Simulating Mobile on Mac (No Device Required)

`isMobile` is detected from `navigator.userAgent`:
```ts
isMobile: /Mobi|Android/i.test(navigator.userAgent)
```

Chrome DevTools spoofs the user agent, making it the easiest way to demo both experiences on the same machine:

1. Open `http://localhost:8080` in a normal Chrome tab — desktop (`isMobile: false`)
2. Open a second Chrome tab at the same URL
3. Open DevTools (`Cmd+Option+I`) in the second tab
4. Click the **Toggle device toolbar** icon (phone icon, top-left of DevTools)
5. Select any mobile device (e.g., iPhone 12)
6. Hard reload (`Cmd+Shift+R`) — required so `identify()` picks up the spoofed user agent

The second tab now has `isMobile: true` and sees the original banner. The first tab keeps `isMobile: false` and sees the new banner.

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
ldClient.identify({
  kind: 'user',
  key: session.userId,
  currencyCode: session.currencyCode,
  browser: getBrowser(),
  isMobile: /Mobi|Android/i.test(navigator.userAgent),
  // examples of additional attributes:
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  language: navigator.language,
});
```

No SDK changes required — just add the field and it appears as a targetable attribute in the LD rule builder.
