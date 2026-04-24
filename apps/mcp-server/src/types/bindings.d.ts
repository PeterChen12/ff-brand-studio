interface CloudflareBindings {
  // Cloudflare bindings
  R2: R2Bucket;
  SESSION_KV: KVNamespace;

  // Env vars (set as wrangler secrets)
  ENVIRONMENT: string;
  R2_PUBLIC_URL: string;

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
}
