# Debugging Journal — Banner Flag Not Toggling

This document records the investigation into why the `banner-v2-enabled` flag was confirmed `true` in LaunchDarkly but the banner was not updating in the UI. Written as a chronological record of what we checked, what we found, and why we fixed it the way we did.

---

## The Symptom

After deploying the frontend with the LaunchDarkly SDK baked in, the expected behavior was:

1. Toggle `banner-v2-enabled` ON in the LD dashboard
2. Banner instantly swaps from gray to purple — no page reload

What actually happened: the banner stayed gray. Toggling the flag in the dashboard had no visible effect.

---

## Step 1: Verify the SDK Is Actually Connected

Before assuming a code bug, confirm the SDK is running and talking to LaunchDarkly.

**What we checked (browser DevTools → Network tab, filter by `launchdarkly`):**

| Request | Status | Meaning |
|---------|--------|---------|
| `clientstream.launchdarkly.com` | 200 | SSE stream is open — SDK is connected |
| `events.launchdarkly.com` | 202/204 | Analytics events are being sent |

SDK is connected. The `clientstream` connection is the live SSE stream that pushes flag changes. It was open and receiving data.

**What we also verified:**

- The LD dashboard showed the SDK as connected
- The client-side ID in the network requests matched the one in the LD dashboard
- The running pod image digest matched our locally built image (not the upstream image)

At this point we knew: the problem is not connectivity. The SDK is in the right image, connected to the right project.

---

## Step 2: Verify the Flag Value Is Actually True

The SDK is connected — but is it receiving the right flag value?

**What we checked:** Browser DevTools → Network tab → click the `clientstream` request → EventStream tab

Found this in the stream:
```
data: {"banner-v2-enabled":{"value":true,...}}
```

The SDK is receiving `banner-v2-enabled: true`. The flag is evaluating `true` in LaunchDarkly and being pushed to the client correctly.

So the problem is not in LaunchDarkly or the network. The SDK receives the right value. Something in the React layer is preventing that value from reaching the component.

---

## Step 3: Verify the Banner Element Itself

Maybe `useFlags()` is working but the banner component is the problem.

**What we checked (browser DevTools → Elements tab):**

```js
// Find the banner
document.querySelector('[class*="Banner"]')

// Check if inline style is being applied (would indicate flag is true)
document.querySelector('[class*="Banner"]').getAttribute('style')
// → null

// Check which banner is rendering
document.querySelector('[class*="Banner"]').textContent
// → "The best telescopes in the universe..."
```

No inline style, original banner text — confirming the flag is evaluating `false` inside React despite the SDK receiving `true`. The problem is somewhere between the SDK and `useFlags()`.

---

## Step 4: Find the Console Error

Checking the browser console revealed:

```
Uncaught Error: Minified React error #418
```

And a more detailed message:
```
Hydration failed because the server rendered HTML didn't match the client.
As a result this tree will be regenerated on the client.
```

This is the root cause. React error #418 is a **hydration mismatch** — the HTML sent from the server doesn't match what React renders on the client. When this happens, React discards the server HTML and re-renders the entire tree from scratch. That re-render causes `LDProvider` to unmount and remount, which resets the LD client. By the time the client reinitializes, `useFlags()` returns the default value (`false`) — the flag hasn't been received yet.

The flag IS `true` in LD. The SDK IS receiving it. But `LDProvider` keeps getting reset before the flag value can reach `useFlags()`.

---

## Step 5: Understand React Hydration

Next.js renders pages on the server (Node.js process) and sends the HTML to the browser. React then "hydrates" — it attaches to the existing DOM and makes it interactive. Hydration requires the client-side render to produce **exactly the same HTML** as the server.

If anything differs — even a single text node — React throws error #418 and re-renders the whole tree from scratch (client-only). This is the "tree will be regenerated on the client" message.

The key insight: any value that changes between server and client will cause this. Common causes:
- `Math.random()` in render (different value each call)
- `Date.now()` (millisecond difference)
- `localStorage` reads (doesn't exist on server)
- `navigator.userAgent` (doesn't exist on server)
- `uuid.v4()` at module scope (runs separately in server process and browser process — different UUID each time)

---

## Step 6: First Fix Attempt — `_app.tsx` Context

The `LDProvider` in `_app.tsx` was receiving a `context` prop built from `SessionGateway.getSession()`:

```tsx
// Original code
const session = SessionGateway.getSession();

const [ldContext, setLdContext] = useState({
  kind: 'user' as const,
  key: session.userId,              // ← problem
  currencyCode: session.currencyCode,
  browser: getBrowser(),            // ← also a problem
  isMobile: /Mobi|Android/i.test(navigator.userAgent),  // ← also a problem
});
```

`getBrowser()` and `navigator.userAgent` don't exist on the server — we already knew these needed to be in `useEffect`. But the deeper issue was `session.userId`.

**`SessionGateway` calls `uuid.v4()` at module load time:**

```ts
// Session.gateway.ts
const defaultSession = {
  userId: v4(),  // ← runs when module is imported
  currencyCode: 'USD',
};
```

Next.js imports this module twice: once in the Node.js server process, once in the browser. Each import calls `v4()` and gets a different UUID. Server renders `key: "abc-123"`, client hydrates with `key: "xyz-789"` — React sees the mismatch.

**Fix:** Make the initial `useState` value fully static — no session reads, no navigator reads — so server and client produce identical output on first render:

```tsx
const [ldContext, setLdContext] = useState({
  kind: 'user' as const,
  key: 'anonymous-user',  // static — same on server and client
  anonymous: true,
  currencyCode: 'USD',    // static — same on server and client
  browser: 'unknown',     // static — same on server and client
  isMobile: false,        // static — same on server and client
});

useEffect(() => {
  const session = SessionGateway.getSession();
  setLdContext({
    kind: 'user',
    key: session.userId,
    anonymous: true,
    currencyCode: session.currencyCode,
    browser: getBrowser(),
    isMobile: /Mobi|Android/i.test(navigator.userAgent),
  });
}, []);
```

After this fix the context is correct — but the hydration error persisted.

---

## Step 7: Second Root Cause — `PlatformFlag.tsx`

The error was still happening, meaning something else in the render tree was still mismatching. We traced the full component tree on the homepage:

```
_app.tsx
  └── Layout
        ├── Header
        ├── Home (index.tsx)
        │     ├── Banner or BannerV2
        │     └── ProductList
        └── Footer
              └── PlatformFlag   ← found it
```

`PlatformFlag.tsx` had this at the top of the file (module scope, outside any component):

```tsx
const { NEXT_PUBLIC_PLATFORM = 'local' } = typeof window !== 'undefined' ? window.ENV : {};
const platform = NEXT_PUBLIC_PLATFORM;

const PlatformFlag = () => <S.Block>{platform}</S.Block>;
```

This runs at module import time. On the server `typeof window === 'undefined'` → `platform = 'local'`. On the client `window.ENV` is set by the inline script in `_document.tsx` to the actual deployment platform (e.g., `'kubernetes'`).

Server renders: `<span>local</span>`
Client renders: `<span>kubernetes</span>`
React: error #418.

This is a subtle bug — the `typeof window !== 'undefined'` check looks defensive, but it only guards the module-scope assignment, not the render. The value is captured once at import time and never updated.

**Fix:** Move the `window.ENV` read inside the component with `useState`/`useEffect`:

```tsx
const PlatformFlag = () => {
  const [platform, setPlatform] = useState('local');  // matches server render

  useEffect(() => {
    const { NEXT_PUBLIC_PLATFORM = 'local' } = window.ENV ?? {};
    setPlatform(NEXT_PUBLIC_PLATFORM);  // runs client-side after hydration
  }, []);

  return <S.Block>{platform}</S.Block>;
};
```

---

## Step 8: Hydration Fixed — Banner Still Not Toggling

After deploying the `PlatformFlag` fix, the React #418 error was gone. Console clean. SSE stream connected. EventStream confirmed `banner-v2-enabled: true`. But the banner still showed the original gray text.

At this point we knew:
- The hydration problem was solved
- `LDProvider` was no longer re-mounting
- The SDK was receiving the correct flag value
- Something between the SDK and the component was still broken

---

## Step 9: The Silent Bug — camelCase Flag Keys

With the component tree stable, we could focus on whether `useFlags()` was reading the right thing.

The code in `index.tsx` was:
```tsx
const flags = useFlags();
const bannerV2Enabled = flags['banner-v2-enabled'] ?? false;
```

**The LaunchDarkly React SDK camelCases all flag keys by default.** The key `banner-v2-enabled` is stored internally as `bannerV2Enabled`. Accessing `flags['banner-v2-enabled']` returns `undefined`. The `?? false` fallback silently converts `undefined` to `false`. No error, no warning — just always `false`.

This was invisible during all the hydration debugging because the SDK was never stable enough to evaluate flags properly. Once the hydration error was fixed and the SDK stayed connected, this became the last remaining issue.

**How we confirmed it:** The EventStream on the third SSE connection showed:
```
data: {"banner-v2-enabled":{"value":true,...}}
```
The SDK had `true`. `useFlags()` returned `false`. The only explanation: wrong key.

**Fix:** Use the camelCased key that matches the SDK's default behavior:
```tsx
// Before — hyphenated key, returns undefined silently
const bannerV2Enabled = flags['banner-v2-enabled'] ?? false;

// After — camelCased key, matches what the SDK stores
const bannerV2Enabled = flags.bannerV2Enabled ?? false;
```

---

## Why This Fixed the Banner Toggle

With all three fixes applied:

1. Server renders the page with consistent, static values everywhere
2. Client hydrates successfully — HTML matches, no error #418
3. `LDProvider` does not re-mount
4. The LD client initializes once and maintains its SSE stream
5. `useFlags()` reads `flags.bannerV2Enabled` — the key the SDK actually uses
6. `banner-v2-enabled: true` from LD propagates through React Context as `bannerV2Enabled`
7. The banner swaps instantly

---

## Key Lessons

**The `typeof window` guard is not enough.** Wrapping a module-scope variable in `typeof window !== 'undefined'` just means it defaults on the server — it doesn't prevent the server/client mismatch. The value still differs between environments. The guard needs to be inside the component, paired with `useState` + `useEffect`.

**UUID generation at module scope will always mismatch.** Any library that calls a random ID generator at import time (not inside a function) will produce different values in the server process and the browser process. Always read session IDs and user keys inside `useEffect`.

**Hydration errors cascade.** The banner toggle failing had nothing to do with LaunchDarkly, the flag value, or the SDK connection. Everything from LD was working correctly. The failure was React discarding the component tree due to a text node mismatch in an unrelated footer component — taking `LDProvider` down with it.

**Silent SDK conventions can mask bugs entirely.** The camelCase key issue produced no error. The SDK was working, the flag was correct, the React layer was stable — but `flags['banner-v2-enabled']` quietly returned `undefined` every time. Always check SDK documentation for key transformation behavior before debugging elsewhere.

**Confirm before assuming.** Before touching code, we confirmed:
- Correct image is running (pod digest matches local build)
- SDK is connected (SSE stream at `clientstream.launchdarkly.com`)
- Flag value is correct (EventStream shows `true`)
- Banner element has no style (flag evaluating `false` in React)

Only after confirming the problem was in the React layer did we look for the hydration error.
