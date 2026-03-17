// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

import '../styles/globals.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App, { AppContext, AppProps } from 'next/app';
import { useEffect } from 'react';
import CurrencyProvider from '../providers/Currency.provider';
import CartProvider from '../providers/Cart.provider';
import { ThemeProvider } from 'styled-components';
import Theme from '../styles/Theme';
import FrontendTracer from '../utils/telemetry/FrontendTracer';
import SessionGateway from '../gateways/Session.gateway';
import { withLDProvider, useLDClient } from 'launchdarkly-react-client-sdk';

declare global {
  interface Window {
    ENV: {
      NEXT_PUBLIC_PLATFORM?: string;
      NEXT_PUBLIC_OTEL_SERVICE_NAME?: string;
      NEXT_PUBLIC_OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?: string;
      IS_SYNTHETIC_REQUEST?: string;
    };
  }
}

if (typeof window !== 'undefined') {
  FrontendTracer();
}

const queryClient = new QueryClient();

// Client-side ID is baked in at build time via the deploy script:
// LD_CLIENT_ID="your-client-side-id" ./launchdarkly/scripts/deploy-k8s.sh
// Find your client-side ID in the LD dashboard: Project → Environments → click environment
const ldClientID = process.env.NEXT_PUBLIC_LD_CLIENT_ID || 'your-client-side-id-here';

const getBrowser = () => {
  const ua = navigator.userAgent;
  if (ua.includes('Chrome')) return 'chrome';
  if (ua.includes('Firefox')) return 'firefox';
  if (ua.includes('Safari')) return 'safari';
  if (ua.includes('Edge')) return 'edge';
  return 'other';
};

function MyApp({ Component, pageProps }: AppProps) {
  const ldClient = useLDClient();

  // Identify the real user after mount. withLDProvider initializes with an anonymous context;
  // identify() switches to the actual session identity so targeting rules evaluate correctly.
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

  return (
    <ThemeProvider theme={Theme}>
      <QueryClientProvider client={queryClient}>
        <CurrencyProvider>
          <CartProvider>
            <Component {...pageProps} />
          </CartProvider>
        </CurrencyProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

MyApp.getInitialProps = async (appContext: AppContext) => {
  const appProps = await App.getInitialProps(appContext);
  return { ...appProps };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default withLDProvider({
  clientSideID: ldClientID,
  options: {
    flushInterval: 5000, // flush events every 5s instead of 30s — needed for Playwright experiment traffic
    evaluationReasons: true, // required for experiment exposure tracking — tells LD why a user received a flag value
  },
  reactOptions: {
    sendEventsOnFlagRead: true, // required for experiment exposures — sends evaluation events on flag reads
  },
})(MyApp as any);
