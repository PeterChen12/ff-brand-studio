-- Phase 0 (cross-system audit) P0.6 — IP-based rate limiter for /demo/*
-- routes. The existing per-tenant limiter (rate_limit_buckets, migration
-- 0007) doesn't cover demo endpoints because they run without a tenant
-- context. Demo routes still hit paid pipelines (SEO costs $0.10-0.50/call;
-- launch-sku can run image gen if dry_run=false), so an open endpoint is
-- a budget/grief vector.
--
-- Same fixed-window scheme as rate_limit_buckets, but keyed on a SHA-256
-- of the client IP (storing raw IPs is PII; the hash is enough for bucket
-- arithmetic). Opportunistic 1% cleanup on every increment keeps the
-- table bounded without a cron.

CREATE TABLE IF NOT EXISTS rate_limit_ip_buckets (
  ip_hash     bytea NOT NULL,
  scope       text NOT NULL,
  bucket_key  bigint NOT NULL,
  count       integer NOT NULL DEFAULT 0,
  PRIMARY KEY (ip_hash, scope, bucket_key)
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_ip_bucket_key
  ON rate_limit_ip_buckets(bucket_key);
