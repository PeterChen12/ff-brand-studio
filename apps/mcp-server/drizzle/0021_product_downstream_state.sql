-- P4 — canonical per-(product, integration) state.
--
-- Replaces the per-platform columns on products (bfr_status, bfr_url,
-- bfr_synced_at, bfr_stage_event_id, last_reconciled_at) with a join
-- table. Each row is: "this product, as seen by this tenant's
-- integration, has this status / url / event id".
--
-- Migration strategy (live):
--   1. This SQL adds the new table + backfills from existing
--      products.bfr_* columns.
--   2. Application code dual-writes for one release: every write to
--      products.bfr_* also writes to product_downstream_state.
--   3. Readers switch over (a follow-up commit), keeping the bfr_*
--      columns as a read-shadow for one more release in case of bugs.
--   4. Drop the bfr_* columns (a later migration).
--
-- Idempotent: safe to re-run. Backfill uses INSERT ... ON CONFLICT
-- DO NOTHING so a partial backfill doesn't double-insert.

CREATE TABLE IF NOT EXISTS product_downstream_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL REFERENCES integration_credentials(id),
  provider text NOT NULL,
  external_id text,
  external_url text,
  status text,
  stage_event_id text,
  last_synced_at timestamp,
  last_reconciled_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT product_downstream_state_uniq UNIQUE (product_id, integration_id)
);

CREATE INDEX IF NOT EXISTS product_downstream_state_provider_idx
  ON product_downstream_state (provider, status);
CREATE INDEX IF NOT EXISTS product_downstream_state_external_idx
  ON product_downstream_state (provider, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS product_downstream_state_reconcile_idx
  ON product_downstream_state (last_reconciled_at) WHERE external_id IS NOT NULL;

-- Backfill: for every product where bfr_status IS NOT NULL AND the
-- tenant has an active 'buyfishingrod-admin' integration credentials
-- row, create the join row. We pick THAT row's id as integration_id
-- so the canonical state ties cleanly to a credential.
INSERT INTO product_downstream_state
  (product_id, integration_id, provider, external_id, external_url,
   status, stage_event_id, last_synced_at, last_reconciled_at)
SELECT
  p.id,
  ic.id,
  'buyfishingrod-admin',
  p.external_id,
  p.bfr_url,
  p.bfr_status,
  p.bfr_stage_event_id,
  p.bfr_synced_at,
  p.last_reconciled_at
FROM products p
JOIN integration_credentials ic
  ON ic.tenant_id = p.tenant_id
  AND ic.provider = 'buyfishingrod-admin'
  AND ic.status = 'active'
WHERE p.bfr_status IS NOT NULL
ON CONFLICT (product_id, integration_id) DO NOTHING;
