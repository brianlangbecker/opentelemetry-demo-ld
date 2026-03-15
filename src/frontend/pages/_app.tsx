// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

import '../styles/globals.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App, { AppContext, AppProps } from 'next/app';
import { useState, useEffect } from 'react';
import CurrencyProvider from '../providers/Currency.provider';
import CartProvider from '../providers/Cart.provider';
import { ThemeProvider } from 'styled-components';
import Theme from '../styles/Theme';
import FrontendTracer from '../utils/telemetry/FrontendTracer';
import SessionGateway from '../gateways/Session.gateway';
import { LDProvider } from 'launchdarkly-react-client-sdk';

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
  // Static initial state must match the server render exactly.
  // SessionGateway.getSession() calls v4() at module load — different UUID on server vs client
  // causes React hydration error #418. We defer all session/browser reads to useEffect.
  const [ldContext, setLdContext] = useState({
    kind: 'user' as const,
    key: 'anonymous-user',
    anonymous: true,
    currencyCode: 'USD',
    browser: 'unknown',
    isMobile: false,
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

  return (
    <ThemeProvider theme={Theme}>
      <LDProvider clientSideID={ldClientID} context={ldContext}>
        <QueryClientProvider client={queryClient}>
          <CurrencyProvider>
            <CartProvider>
              <Component {...pageProps} />
            </CartProvider>
          </CurrencyProvider>
        </QueryClientProvider>
      </LDProvider>
    </ThemeProvider>
  );
}

MyApp.getInitialProps = async (appContext: AppContext) => {
  const appProps = await App.getInitialProps(appContext);

  return { ...appProps };
};

export default MyApp;
