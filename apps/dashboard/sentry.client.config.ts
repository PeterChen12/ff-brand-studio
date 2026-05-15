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

// Phase G · G23 — PII redaction for the event payload before it leaves
// the browser. Replay already masks all text via `maskAllText: true`;
// this `beforeSend` covers the OTHER event shapes (breadcrumb URLs,
// fetch bodies, error strings, request headers) where secrets and
// emails leak. Patterns are conservative — false positives just show
// up as `[redacted]` in Sentry, not as missed bugs.
const PII_PATTERNS: Array<{ re: RegExp; replacement: string }> = [
  // Bearer / token-style header values
  { re: /Bearer\s+[A-Za-z0-9._\-]+/g, replacement: "Bearer [redacted]" },
  // FF API keys: ff_live_..., ff_test_...
  { re: /\bff_(live|test)_[A-Za-z0-9]+/g, replacement: "ff_$1_[redacted]" },
  // Stripe secrets and customer IDs in error messages
  { re: /\bsk_(live|test)_[A-Za-z0-9]+/g, replacement: "sk_$1_[redacted]" },
  { re: /\bcus_[A-Za-z0-9]+/g, replacement: "cus_[redacted]" },
  // Email addresses
  {
    re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    replacement: "[email]",
  },
];

function scrub(value: unknown): unknown {
  if (typeof value === "string") {
    let s = value;
    for (const { re, replacement } of PII_PATTERNS) {
      s = s.replace(re, replacement);
    }
    return s;
  }
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = scrub(v);
    }
    return out;
  }
  return value;
}

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
    beforeSend(event) {
      return scrub(event) as typeof event;
    },
    beforeBreadcrumb(breadcrumb) {
      return scrub(breadcrumb) as typeof breadcrumb;
    },
  });
}
