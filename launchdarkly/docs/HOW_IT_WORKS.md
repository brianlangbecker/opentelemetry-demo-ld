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

## LDProvider — The Root Provider

**File:** `src/frontend/pages/_app.tsx`

```tsx
<LDProvider clientSideID={ldClientID} context={ldContext}>
  <QueryClientProvider ...>
    <CurrencyProvider>
      <CartProvider>
        <Component {...pageProps} />
      </CartProvider>
    </CurrencyProvider>
  </QueryClientProvider>
</LDProvider>
```

`LDProvider` does two things when the app loads:

1. **Opens an SSE stream** to `clientstream.launchdarkly.com` using your `clientSideID` — this is the persistent connection that receives real-time flag updates.
2. **Evaluates all flags** for the given user context and stores the results in React Context.

It wraps the entire app so any component anywhere in the tree can access flag values via `useFlags()`.

The `context` prop is a React state variable (`ldContext`) that starts with static placeholder values on first render, then updates with real user data after hydration. See the appendix for why.

---

## User Context — Who Is This User?

**File:** `src/frontend/pages/_app.tsx`

The context is initialized with static values, then populated client-side in `useEffect`:

```tsx
const [ldContext, setLdContext] = useState({
  kind: 'user' as const,
  key: 'anonymous-user',   // static placeholder — safe for SSR
  anonymous: true,
  currencyCode: 'USD',     // static placeholder — safe for SSR
  browser: 'unknown',      // static placeholder — safe for SSR
  isMobile: false,         // static placeholder — safe for SSR
});

useEffect(() => {
  const session = SessionGateway.getSession();
  setLdContext({
    kind: 'user',
    key: session.userId,            // UUID from localStorage
    anonymous: true,
    currencyCode: session.currencyCode,  // 'USD', 'EUR', etc.
    browser: getBrowser(),          // 'chrome', 'firefox', 'safari', 'edge', 'other'
    isMobile: /Mobi|Android/i.test(navigator.userAgent),
  });
}, []);
```

This context is sent to LaunchDarkly so it can evaluate targeting rules per user. LaunchDarkly uses this to answer: "Given this user's attributes, what should this flag evaluate to?"

### Why `anonymous: true`?

This app has no real user accounts. `anonymous: true` tells LaunchDarkly not to store the user profile in its dashboard. The `key` (UUID from `SessionGateway`) persists in `localStorage`, so the same browser session gets consistent flag evaluations across page loads.

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

Parses `navigator.userAgent` to detect the browser. Used as a targeting attribute so you can roll out flags to specific browsers (e.g., Chrome first, then Firefox, then all). Called inside `useEffect` so it only runs in the browser — `navigator` doesn't exist server-side.

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

### Why the LDProvider context uses static initial values

Next.js renders pages on the server first, sends the HTML to the browser, then React "hydrates" — it attaches event listeners and takes over the static HTML. If the HTML React tries to render client-side doesn't exactly match what the server sent, React throws hydration error #418 and re-mounts from scratch. When `LDProvider` re-mounts, it starts a fresh client that hasn't received flags yet, so `useFlags()` returns `false` even though the flag is `true` in LD.

The fix is to ensure the initial `useState` value is fully static — identical on server and client — and defer all dynamic reads to `useEffect`.

### Why session.userId can't be used directly in initial state

`SessionGateway` calls `uuid.v4()` at **module load time**:

```ts
const defaultSession = {
  userId: v4(),  // runs when module is imported — once on server, once on client
  currencyCode: 'USD',
};
```

Next.js imports the module twice: once in the Node.js server process, once in the browser. Each call to `v4()` produces a different UUID. The server renders `key: "abc-123"` and the client hydrates with `key: "xyz-789"` — React sees the mismatch and throws.

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
