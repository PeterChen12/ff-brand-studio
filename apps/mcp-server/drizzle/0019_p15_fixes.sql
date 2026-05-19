-- P1.5 fixes from the code review.

-- #6 — TOCTOU race on POST /v1/integrations: two concurrent POSTs for the
-- same (tenant_id, provider) could both insert. Switch to ON CONFLICT DO
-- UPDATE in the handler, backed by this unique constraint at the DB.
-- Idempotent: silently no-ops when the constraint already exists.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'integration_credentials_tenant_provider_uniq'
  ) THEN
    ALTER TABLE integration_credentials
      ADD CONSTRAINT integration_credentials_tenant_provider_uniq
        UNIQUE (tenant_id, provider);
  END IF;
END $$;

-- #4 — webhook_inbox cleanup: an index on processed_at to make a
-- "delete rows older than 30 days" sweep cheap. Cron in the worker
-- (next iteration) runs the DELETE.
CREATE INDEX IF NOT EXISTS webhook_inbox_processed_at_idx
  ON webhook_inbox (processed_at) WHERE processed_at IS NOT NULL;
