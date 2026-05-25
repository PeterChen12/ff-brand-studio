-- 0023 — tenant_deletions table (GDPR Article 17 right-to-erasure).
--
-- Workflow:
--   1. Tenant clicks "Delete account" → row inserted with status='pending',
--      eligible_at = requested_at + GDPR_GRACE_PERIOD_DAYS (30).
--   2. Within the grace window, tenant can cancel → status='cancelled',
--      cancelled_at populated. The row stays for audit history.
--   3. Cron sweep picks up rows where status='pending' AND eligible_at
--      <= NOW() → flips to status='completed', completed_at populated.
--      ACTUAL DATA DELETION (cascade across assets/runs/etc.) is a
--      separate manual step gated on operator review for the first
--      few iterations — the sweep just marks the request as eligible.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- Single PK on tenant_id means a tenant can have at most one open
-- deletion request; cancelling and re-requesting overwrites the row
-- (handled in the lib via INSERT ... ON CONFLICT).

CREATE TABLE IF NOT EXISTS tenant_deletions (
  tenant_id     UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  status        TEXT NOT NULL CHECK (status IN ('pending', 'cancelled', 'completed')),
  requested_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  eligible_at   TIMESTAMP NOT NULL,
  cancelled_at  TIMESTAMP,
  completed_at  TIMESTAMP,
  reason        TEXT
);

-- Hot path: cron sweep scans pending rows past eligible_at.
CREATE INDEX IF NOT EXISTS idx_tenant_deletions_due
  ON tenant_deletions (eligible_at)
  WHERE status = 'pending';
