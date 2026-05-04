interface CloudflareBindings {
  // Cloudflare bindings
  R2: R2Bucket;
  SESSION_KV: KVNamespace;
  AI: Ai;

  // Env vars (set as wrangler secrets)
  ENVIRONMENT: string;
  R2_PUBLIC_URL: string;
  R2_THUMB_HOST?: string;

  // Model providers
  ANTHROPIC_API_KEY: string;
  OPENAI_API_KEY: string;
  FAL_KEY: string;

  // Postgres
  PGHOST: string;
  PGPORT: string;
  PGDATABASE: string;
  PGUSER: string;
  PGPASSWORD: string;

  // Langfuse
  LANGFUSE_PUBLIC_KEY: string;
  LANGFUSE_SECRET_KEY: string;
  LANGFUSE_BASE_URL: string;

  // SEO Layer (v2)
  DATAFORSEO_LOGIN: string;
  DATAFORSEO_PASSWORD: string;
  APIFY_TOKEN: string;

  // Clerk auth (Phase G)
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  CLERK_WEBHOOK_SECRET: string;

  // R2 SigV4 (Phase H — direct-to-R2 presigned uploads)
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;

  // Stripe (Phase H — wallet top-ups)
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_PRICE_TOPUP_10: string;
  STRIPE_PRICE_TOPUP_25: string;
  STRIPE_PRICE_TOPUP_50: string;
  STRIPE_PRICE_TOPUP_100: string;

  // Phase I — image sidecar (sharp ops in Node)
  IMAGE_SIDECAR_URL?: string;
  IMAGE_SIDECAR_SECRET?: string;

  // Phase K3 — Resend email API key
  RESEND_API_KEY?: string;

  // Phase U2 — rate limiter is now Postgres-backed; reuses PG* secrets.
  // (Earlier UPSTASH_REDIS_REST_URL/TOKEN secrets removed — see Phase U2.)

  // Phase M3 — Sentry DSN (Worker error reporting)
  SENTRY_DSN?: string;

  // P0-2 (backend audit) — comma-separated extra origins for CORS
  // beyond the static prod + localhost set. Used for preview deploys.
  CORS_EXTRA_ORIGINS?: string;
}
