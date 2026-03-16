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
  LDProvider (_app.tsx)
        |
        | React Context
        |
  useFlags() (index.tsx)
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

Because `withLDProvider` wraps `MyApp`, every component in the tree — including `MyApp` itself — can call `useLDClient()` and `useFlags()` directly.

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

`identify()` is also the explicit SDK API for switching user identity at runtime. It re-evaluates all flags for the new context and updates React state, so `useFlags()` re-renders with the correct values.

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

## useFlags() — The Listener

**File:** `src/frontend/pages/index.tsx`

```tsx
const flags = useFlags();
const bannerV2Enabled = flags['banner-v2-enabled'] ?? false;
```

`useFlags()` is a React hook from `launchdarkly-react-client-sdk`. It:

1. **Reads from the React Context** that `LDProvider` manages — no network call happens here.
2. **Subscribes to flag changes** — when `LDProvider` receives a flag update over SSE, it updates Context, which triggers a re-render in any component using `useFlags()`.

This is the "listener." It's not an explicit `addEventListener` — it's implicit in the hook's subscription to React Context.

### The fallback (`?? false`)

```tsx
const bannerV2Enabled = flags['banner-v2-enabled'] ?? false;
```

On first render, the SDK may not have finished loading flags yet. `?? false` ensures the old banner shows by default until the SDK is ready. This prevents a flash of the wrong state.

### Alternative: `useFlag` (singular)

If you only need one flag, there's a cleaner single-flag hook:

```tsx
import { useFlag } from 'launchdarkly-react-client-sdk';
const bannerV2Enabled = useFlag('banner-v2-enabled');
```

`useFlags()` (plural) is better when checking multiple flags in the same component.

---

## The Real-Time Update Sequence

When you toggle `banner-v2-enabled` in the LaunchDarkly dashboard:

1. LD servers receive the flag change
2. LD pushes the update over SSE to all connected clients (including your browser)
3. The LD SDK receives the update, re-evaluates flags for the current user context
4. `LDProvider` updates its React Context value with the new flag state
5. React detects the Context change, re-renders `Home` component
6. `useFlags()` returns the new flag value
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

The SSE stream `LDProvider` opens lives for the lifetime of the browser tab. It doesn't require HTTP polling or manual reconnection. When the flag changes in LD:

- The server **pushes** the update to the client (server-sent, not client-polled)
- React's reactivity system handles the UI update
- The user sees the change without any navigation, refresh, or visible loading state

In browser DevTools → Network tab, filter by `launchdarkly`. A healthy connection shows:
- `200` to `clientstream.launchdarkly.com` — the open SSE stream
- `202`/`204` to `events.launchdarkly.com` — analytics events

This is the core "instant release/rollback" capability.

---

## Appendix: Next.js SSR and Hydration-Safe State

### Why `withLDProvider` avoids the hydration problem

`withLDProvider` initializes the SDK at `componentDidMount` — client-side only. It never renders anything during SSR, so there is no server/client HTML mismatch from the LD layer.

Earlier iterations of this integration used `<LDProvider context={ldContext}>` as a JSX wrapper with a `useState` placeholder. This caused React hydration error #418 because values like `session.userId` differed between server and client renders. `withLDProvider` sidesteps this entirely by not involving the server at all.

### Why session.userId can't be read at module scope

`SessionGateway` calls `uuid.v4()` at **module load time**:

```ts
const defaultSession = {
  userId: v4(),  // runs when module is imported — once on server, once on client
  currencyCode: 'USD',
};
```

Next.js imports the module twice: once in the Node.js server process, once in the browser. Each call to `v4()` produces a different UUID. Any component that reads this value at render time will get different output on server vs client — causing React error #418.

This is why `identify()` is called inside `useEffect`, not at render time.

### The general rule

Any value that differs between server and client must start as a static placeholder:

| Value | Problem | Solution |
|-------|---------|----------|
| `localStorage` reads | doesn't exist on server | read in `useEffect` |
| `navigator.userAgent` | doesn't exist on server | read in `useEffect` |
| `uuid.v4()` at module scope | different UUID each import | static placeholder, update in `useEffect` |
| `Date.now()` | millisecond difference | static placeholder, update in `useEffect` |
| `window.innerWidth` | doesn't exist on server | static placeholder, update in `useEffect` |

The `useEffect` always runs after hydration completes and only in the browser, making it the safe place for any client-only reads.
