-- P3 — reverse reconciler. Detects drift between FF Studio's view of
-- a product (products.bfr_status) and the tenant's actual state. Cron
-- writes one row per detected diff; dashboard /library?tab=drift
-- surfaces them.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS last_reconciled_at timestamp;

CREATE TABLE IF NOT EXISTS reconciliation_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  provider text NOT NULL,
  external_id text,
  local_status text,
  remote_status text,
  diff jsonb NOT NULL,
  detected_at timestamp NOT NULL DEFAULT now(),
  resolved_at timestamp,
  resolution text
);

CREATE INDEX IF NOT EXISTS reconciliation_log_unresolved_idx
  ON reconciliation_log (tenant_id, resolved_at) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS reconciliation_log_product_idx
  ON reconciliation_log (product_id, detected_at DESC);
