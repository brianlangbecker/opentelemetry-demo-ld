# How It Works — Technical Deep Dive

This document explains exactly what the LaunchDarkly integration is doing under the hood and why it was built this way.

---

## Architecture Overview

```
LaunchDarkly Dashboard
        |
        | (flag toggle)
        |
  clientstream.launchdarkly.com
        |
        | SSE — Server-Sent Events (persistent stream)
        |
  withLDProvider (_app.tsx)
        |
        | React Context
        |
  ldClient.variation() (index.tsx)
        |
        | re-render
        |
  Banner or BannerV2
```

No polling. No manual event listeners. No page reload.

---

## withLDProvider — The Root Provider

**File:** `src/frontend/pages/_app.tsx`

```tsx
export default withLDProvider({
  clientSideID: ldClientID,
})(MyApp as any);
```

`withLDProvider` is a Higher Order Component (HOC) from `launchdarkly-react-client-sdk`. It wraps `MyApp` with the LD context provider and initializes the SDK at `componentDidMount` — client-side only, so there are no SSR conflicts.

It does two things when the app mounts:

1. **Opens an SSE stream** to `clientstream.launchdarkly.com` using your `clientSideID` — this is the persistent connection that receives real-time flag updates.
2. **Initializes with an anonymous context** until `identify()` is called with the real user.

Because `withLDProvider` wraps `MyApp`, every component in the tree — including `MyApp` itself — can call `useLDClient()` directly.

---

## User Context — Who Is This User?

**File:** `src/frontend/pages/_app.tsx`

`withLDProvider` initializes with an anonymous context. After the component mounts, `identify()` is called with the real session data:

```tsx
function MyApp({ Component, pageProps }: AppProps) {
  const ldClient = useLDClient();

  useEffect(() => {
    if (!ldClient) return;
    const session = SessionGateway.getSession();
    ldClient.identify({
      kind: 'user',
      key: session.userId,             // UUID from localStorage
      currencyCode: session.currencyCode,   // 'USD', 'EUR', etc.
      browser: getBrowser(),           // 'chrome', 'firefox', 'safari', 'edge', 'other'
      isMobile: /Mobi|Android/i.test(navigator.userAgent),
    });
  }, [ldClient]);
  ...
}
```

This context is sent to LaunchDarkly so it can evaluate targeting rules per user. LaunchDarkly uses this to answer: "Given this user's attributes, what should this flag evaluate to?"

### Why `identify()` instead of a `context` prop?

`withLDProvider` initializes client-side only, but `localStorage` and `navigator` are still not available at module load time. `identify()` is called inside `useEffect`, which only runs in the browser after mount — the correct place for any client-only data.

`identify()` is also the explicit SDK API for switching user identity at runtime. It re-evaluates all flags for the new context and updates React state so components re-render with the correct values.

### Why not `email`, `isPremium`, `accountAge`?

The session object only provides `userId` and `currencyCode`. Those other fields don't exist — adding fake data would make targeting rules meaningless.

### The `getBrowser()` function

```tsx
const getBrowser = () => {
  const ua = navigator.userAgent;
  if (ua.includes('Chrome')) return 'chrome';
  if (ua.includes('Firefox')) return 'firefox';
  if (ua.includes('Safari')) return 'safari';
  if (ua.includes('Edge')) return 'edge';
  return 'other';
};
```

Parses `navigator.userAgent` to detect the browser. Used as a targeting attribute so you can roll out flags to specific browsers. Called inside `useEffect` — `navigator` doesn't exist server-side.

---

## ldClient.variation() — The Listener

**File:** `src/frontend/pages/index.tsx`

```tsx
const ldClient = useLDClient();
const bannerV2Enabled = ldClient?.variation('banner-v2-enabled', false) ?? false;
```

`useLDClient()` returns the LD client instance from React Context. `variation()` evaluates the flag for the current user and returns the value. It also registers an **exposure event** — a record that this user was shown a particular flag variation. This is required for experiment tracking.

When the flag changes in LD, the SSE stream pushes the update, the SDK re-evaluates, and React re-renders the component — same as `useFlags()`, but with explicit exposure tracking.

### Why `variation()` instead of `useFlags()`

`useFlags()` calls `allFlags()` internally, which the LD documentation notes may not send exposure events in all SDKs and configurations. `variation()` is the canonical method that guarantees an exposure event is fired — required when the flag is connected to an experiment.

### The fallback (`false`)

```tsx
ldClient?.variation('banner-v2-enabled', false)
```

The second argument to `variation()` is the default value returned if the SDK hasn't initialized yet or the flag doesn't exist. `false` ensures the old banner shows until the SDK is ready.

---

## The Real-Time Update Sequence

When you toggle `banner-v2-enabled` in the LaunchDarkly dashboard:

1. LD servers receive the flag change
2. LD pushes the update over SSE to all connected clients (including your browser)
3. The LD SDK receives the update, re-evaluates flags for the current user context
4. `withLDProvider` updates its React Context value with the new flag state
5. React detects the Context change, re-renders `Home` component
6. `ldClient.variation()` returns the new flag value
7. `bannerV2Enabled` flips from `false` to `true` (or vice versa)
8. React renders `<BannerV2 />` instead of `<Banner />` (or vice versa)

**Total time from dashboard toggle to UI change: typically under 200ms.**

---

## Flag Evaluation in the UI

**File:** `src/frontend/pages/index.tsx`

```tsx
{bannerV2Enabled ? <BannerV2 /> : <Banner />}
```

Simple ternary. When the flag is ON, the new component renders. When OFF, the original renders. React handles the DOM diff and only updates what changed.

---

## What "No Page Reload" Actually Means

The SSE stream `withLDProvider` opens lives for the lifetime of the browser tab. It doesn't require HTTP polling or manual reconnection. When the flag changes in LD:

- The server **pushes** the update to the client (server-sent, not client-polled)
- React's reactivity system handles the UI update
- The user sees the change without any navigation, refresh, or visible loading state

In browser DevTools → Network tab, filter by `launchdarkly`. A healthy connection shows:
- `200` to `clientstream.launchdarkly.com` — the open SSE stream
- `202`/`204` to `events.launchdarkly.com` — analytics events

This is the core "instant release/rollback" capability.

---

## Part 2 — How Targeting Works

Once `identify()` sends the user context to LD, targeting rules in the dashboard evaluate that context to decide what flag value to serve. No code changes are needed to add or change rules — it all happens in the LD dashboard.

### The attributes in play

| Attribute | Value | Targeting use |
|-----------|-------|---------------|
| `key` | session UUID | Individual targeting — serves a specific user |
| `isMobile` | `true` / `false` | Desktop-only rollout while mobile layout is reviewed |
| `browser` | `chrome`, `firefox`, etc. | Browser-specific rollout |
| `currencyCode` | `USD`, `EUR`, etc. | Regional rollout |

### Rule evaluation order

LD evaluates rules top to bottom, first match wins:

```
Individual targets  →  checked first, overrides everything
Custom rules        →  checked in order (e.g. isMobile = false → true)
Default rule        →  fallback for everyone else
```

A user matched by an individual target never hits the custom rules. A desktop user not individually targeted hits the `isMobile = false` rule and gets `true`. A mobile user falls through to the default.

### How it flows

1. Page loads → `withLDProvider` initializes with anonymous context
2. `useEffect` fires → `ldClient.identify()` sends real user attributes to LD
3. LD re-evaluates all flags for this user against all targeting rules
4. SDK updates local cache, React re-renders with correct flag values
5. Dashboard rule change → SSE pushes update → SDK re-evaluates → instant UI update

---

## Part 3 — How Experimentation Works

The experiment measures whether the purple banner (`true` variation) drives more CTA clicks than the gray banner (`false` variation).

### Conversion tracking — `client.track()`

**File:** `src/frontend/components/Banner/BannerV2.tsx`

```tsx
const ldClient = useLDClient();
<button onClick={() => ldClient?.track('banner-cta-clicked')}>Explore Now</button>
```

When the button is clicked, `track()` fires a custom event to LD. LD records which flag variation that user was assigned to at the time — this is the conversion event the experiment measures.

### Exposure tracking — why `variation()` is required

For LD to count a user as an experiment exposure, the SDK must fire an `index` event when the flag is evaluated. `variation()` guarantees this. `useFlags()` (which calls `allFlags()` internally) may not send exposure events in all configurations.

```tsx
// This registers an exposure event — required for experiment tracking
const bannerV2Enabled = ldClient?.variation('banner-v2-enabled', false) ?? false;
```

### What LD needs to record a result

1. **Exposure** — `variation()` called → `index` event sent with `inExperiment: true`
2. **Conversion** — user clicks CTA → `track('banner-cta-clicked')` fires
3. **Association** — LD links the conversion to the variation the user was assigned

Without the exposure event, LD cannot associate the conversion to a variation — Results tab shows 0 regardless of how many clicks occur.

### Verifying the wiring

In browser DevTools → Network tab → `events.launchdarkly.com` POST payload should contain:

```json
"reason": { "kind": "FALLTHROUGH", "inExperiment": true }
```

In LD Live Events, you should see both `feature` events (exposures) and `custom` events (`banner-cta-clicked`) flowing.

---

> For details on Next.js SSR hydration issues encountered during development, see [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) and [DEBUGGING_JOURNAL.md](./DEBUGGING_JOURNAL.md).
