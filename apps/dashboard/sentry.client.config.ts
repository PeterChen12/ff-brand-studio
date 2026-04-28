/**
 * Phase U3 — browser-side Sentry init.
 *
 * Loaded by Next at app boot via the auto-injection that
 * `withSentryConfig()` adds to next.config. Static-export-safe:
 * everything here is browser-side.
 *
 * Activates when NEXT_PUBLIC_SENTRY_DSN is set at build time. Without
 * a DSN it stays a no-op so dev environments don't blow up.
 */

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    replaysSessionSampleRate: 0.0,
    integrations: [
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
    environment: process.env.NEXT_PUBLIC_SENTRY_ENV ?? "production",
    enabled: dsn.length > 0,
  });
}
