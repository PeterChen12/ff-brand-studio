interface CloudflareBindings {
  // Cloudflare bindings
  R2: R2Bucket;
  SESSION_KV: KVNamespace;

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
}
