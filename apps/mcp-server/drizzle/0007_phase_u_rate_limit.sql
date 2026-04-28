-- Phase U2 — Postgres-backed rate-limit counter.
--
-- Replaces the Upstash Redis sliding-window store with a tiny
-- fixed-window counter table. Per-tenant row, bucket key = floor of
-- now / window. INSERT...ON CONFLICT atomically increments without
-- a separate read-modify-write round-trip.
--
-- Cleanup is handled by an opportunistic DELETE on every increment
-- with a 1% probability — no separate cron needed, table stays small.

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  bucket_key  bigint NOT NULL,
  count       integer NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, bucket_key)
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_bucket_key
  ON rate_limit_buckets(bucket_key);
