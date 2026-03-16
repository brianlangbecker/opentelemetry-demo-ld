# Troubleshooting Guide

---

## LaunchDarkly SDK Not Connecting

### Symptom
Network tab shows requests going to `events.launchdarkly.com/events/bulk/your-client-side-id-here`

### Cause
The wrong Docker image is running. The frontend is using the upstream image (without the LD SDK) instead of the locally built one. This happens when `helm upgrade` or `fix-collector.sh` is run after the frontend deploy — Helm reverts the image back to upstream.

### Fix
Re-run the deploy script:
```bash
LD_CLIENT_ID="your-client-side-id" ./launchdarkly/scripts/deploy-k8s.sh
```

### How to verify the correct image is running
```bash
# Get digest of running pod
kubectl get pod -l app.kubernetes.io/name=frontend \
  -o jsonpath='{.items[0].status.containerStatuses[0].imageID}'

# Get digest of local image
docker inspect ghcr.io/open-telemetry/demo:latest-frontend \
  --format '{{index .RepoDigests 0}}'
```
Both should match.

---

## Flag Toggle Not Updating the UI

### Symptom
Flag is toggled in the LD dashboard but the banner does not change.

### Cause (most likely)
The SDK connects via Server-Sent Events (SSE) to `clientstream.launchdarkly.com`, not WebSocket. The connection can be interrupted when the page first loads via port-forward on Docker Desktop.

### Fix
1. Load the page and **wait a few seconds** for the stream to establish
2. Flip the flag in the LD dashboard **without reloading the page**
3. The banner should swap instantly

### How to verify the stream is connected
In browser DevTools → Network tab, filter by `launchdarkly`. You should see:
- `200` to `clientstream.launchdarkly.com` — this is the SSE stream
- `202`/`204` to `events.launchdarkly.com` — these are analytics events

If you only see localhost connections, the wrong image is running (see above).

---

## React Hydration Error #418

### Symptom
Console shows: `Uncaught Error: Minified React error #418`

### Cause
Next.js renders the page on the server first, then React "hydrates" it on the client. If the server-rendered HTML doesn't match what React tries to render client-side, hydration fails.

In our case, `browser` and `isMobile` context attributes use `navigator.userAgent` which doesn't exist server-side. The server renders `browser: 'unknown'` but the client renders `browser: 'firefox'` — mismatch.

### Root cause
`SessionGateway` calls `uuid.v4()` at **module load time** to create `defaultSession.userId`. Since Next.js imports the module separately on the server and the client, each gets a different random UUID. `_app.tsx` used to pass `session.userId` as the `key` in the initial `ldContext` state — server renders with UUID `abc`, client hydrates with UUID `xyz`, React detects the mismatch, throws #418, and `LDProvider` re-mounts from scratch. By the time it re-initializes, the flag stream hasn't arrived yet so `useFlags()` returns `false`.

### Fix
The initial `ldContext` state must be **fully static** — no session reads, no `navigator` reads. Move all dynamic data into `useEffect` so it only runs client-side after hydration succeeds:

```tsx
const [ldContext, setLdContext] = useState({
  kind: 'user' as const,
  key: 'anonymous-user',  // static — matches server render
  anonymous: true,
  currencyCode: 'USD',    // static default — matches server render
  browser: 'unknown',     // matches server render
  isMobile: false,        // matches server render
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

---

## OTel Collector Symlink Errors on Docker Desktop

### Symptom
```
failed to try resolving symlinks in path "/var/log/pods/default_otel-collector-agent-.../opentelemetry-collector/12.log"
```

### Cause
The OTel collector agent runs as a DaemonSet and tries to collect host metrics and logs. On Docker Desktop, `/var/log/pods` uses symlinks that go stale after pod log rotation. The collector tries to resume reading from previous log positions but the files no longer exist.

### Fix
Run the fix script which disables the problematic collection presets via Helm:
```bash
./launchdarkly/scripts/fix-collector.sh
```

This disables `logsCollection`, `hostMetrics`, `kubeletMetrics`, and `clusterMetrics` presets — none of which are needed for the demo.

> **Important:** After running `fix-collector.sh`, re-run the frontend deploy script — Helm reverts the frontend image as a side effect.

---

## Helm Upgrade Field Manager Conflicts

### Symptom
```
conflict with "kubectl-client-side-apply" using v1: .data.relay
conflict with "kubectl-set" using apps/v1: .spec.template.spec.containers[name="frontend"].image
```

### Cause
Running `kubectl apply` or `kubectl set image` directly takes ownership of those fields away from Helm. When Helm tries to upgrade, it conflicts with the field manager set by kubectl.

### Fix
Use `--force-conflicts` on the helm upgrade:
```bash
helm upgrade my-otel-demo open-telemetry/opentelemetry-demo --reuse-values --force-conflicts
```

---

## npm Package Not Found During Docker Build

### Symptom
```
npm error 404 Not Found - GET https://registry.npmjs.org/@launchdarkly%2freact-client-sdk
```

### Cause
The scoped package `@launchdarkly/react-client-sdk` does not exist on npm. The correct package name is `launchdarkly-react-client-sdk` (unscoped).

### Fix
Ensure `package.json` references `"launchdarkly-react-client-sdk"` and all imports in source files use the unscoped name:
```ts
import { LDProvider } from 'launchdarkly-react-client-sdk';
import { useFlags } from 'launchdarkly-react-client-sdk';
```

---

## Flag Toggle Confirmed True in LD but useFlags() Always Returns False

### Symptom
The EventStream shows `banner-v2-enabled: true`. The SDK is connected. No console errors. But `useFlags()` returns `false` and the UI never updates.

### Cause
The LaunchDarkly React SDK **camelCases all flag keys by default**. `banner-v2-enabled` is stored internally as `bannerV2Enabled`. Accessing `flags['banner-v2-enabled']` returns `undefined`, which the `?? false` fallback silently converts to `false`. No error is thrown.

### Fix
Use the camelCased key to match the SDK's default behavior:
```tsx
// Wrong — hyphenated key returns undefined
const bannerV2Enabled = flags['banner-v2-enabled'] ?? false;

// Correct — camelCased key matches what the SDK stores
const bannerV2Enabled = flags.bannerV2Enabled ?? false;
```

The SDK default can be disabled with `reactOptions={{ useCamelCaseFlagKeys: false }}` on `LDProvider`, but using the camelCased key is the correct approach — it works with the SDK's default rather than overriding it.

---

## Individual Targeting Not Working — LD Only Sees `anonymous-user`

### Symptom
Individual target is set in the LD dashboard for a specific session UUID. Default rule is `false`. But the flag still returns `false` — the individual target is never matched.

### Diagnosis
Check the LD **Live Events** tab on the flag's Targeting page. If it shows `anonymous-user` as the key instead of the real session UUID, `identify()` is not being called with the real user context.

### Cause
`LDProvider` initializes with a static `anonymous-user` key (required to avoid React SSR hydration errors). The real session UUID is only available client-side. The original approach relied on `LDProvider` watching its `context` prop for changes and calling `identify()` internally — but this was not happening reliably. LD never received the real key, so individual targets for the session UUID never matched.

Additionally, `anonymous: true` in the context can interfere with individual targeting — LD treats anonymous contexts as having no persistent identity.

### Fix
Use `withLDProvider` as a HOC on the export and call `useLDClient().identify()` directly in `MyApp`. Because `withLDProvider` wraps `MyApp`, `useLDClient()` is available inside `MyApp` without a separate component:

```tsx
// _app.tsx
function MyApp({ Component, pageProps }: AppProps) {
  const ldClient = useLDClient();

  useEffect(() => {
    if (!ldClient) return;
    const session = SessionGateway.getSession();
    ldClient.identify({
      kind: 'user',
      key: session.userId,
      currencyCode: session.currencyCode,
      browser: getBrowser(),
      isMobile: /Mobi|Android/i.test(navigator.userAgent),
    });
  }, [ldClient]);
  ...
}

export default withLDProvider({ clientSideID: ldClientID })(MyApp as any);
```

Remove `anonymous: true` from the context — it interferes with individual targeting by key.

### Why This Works
`withLDProvider` initializes the SDK client-side with an anonymous context. `ldClient.identify()` is the explicit SDK API for switching user identity at runtime — it sends the real context to LD, re-evaluates all flags, and updates React so `useFlags()` re-renders. This is the pattern documented in the official LD React SDK docs.

### How to Verify
After the fix, the LD Live Events tab should show your real session UUID as the key, and the reason should be `TARGET_MATCH` when individual targeting is configured.
