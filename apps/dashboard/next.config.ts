import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const config: NextConfig = {
  // Static export — all pages prerendered, all data fetched client-side from the Worker.
  // Lets us deploy to Cloudflare Pages without Node runtime.
  output: "export",
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: "https", hostname: "*.r2.dev" },
      { protocol: "https", hostname: "*.r2.cloudflarestorage.com" },
    ],
  },
};

// Phase U3 — Sentry. Activates when SENTRY_AUTH_TOKEN +
// NEXT_PUBLIC_SENTRY_DSN are set at build time; otherwise this is
// a passthrough. Static export → no server/edge runtime, so we only
// configure browser-side capture (sentry.client.config.ts).
export default withSentryConfig(config, {
  org: "midwest-ai-solution-inc",
  project: "javascript-nextjs",
  silent: !process.env.CI,
  widenClientFileUpload: true,
  disableLogger: true,
});
