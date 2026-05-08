-- 0013_phase_b_ingest.sql — Phase B (B1) inbound product ingestion.
--
-- POST /v1/products/ingest accepts a draft from a customer admin
-- (e.g. buyfishingrod-admin). To make repeat sends idempotent, we
-- track the customer's own product identifier (external_id) and the
-- source system that issued it (external_source) on our products row.
--
-- Re-POSTing the same external_source + external_id from the same
-- tenant returns the existing product_id (no new charge, no duplicate
-- references). Different external_source values for the same tenant
-- ARE allowed to share an external_id — they're independent streams.
--
-- The unique index is partial (only enforced when both columns are
-- non-null) so dashboard-form-created products (which leave both
-- null) don't collide.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS external_id     text,
  ADD COLUMN IF NOT EXISTS external_source text;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_products_tenant_external
  ON products (tenant_id, external_source, external_id)
  WHERE external_id IS NOT NULL AND external_source IS NOT NULL;

-- Lookup index for the ingest handler's "does this external_id already
-- exist?" query. Uses the same composite as the unique constraint.
CREATE INDEX IF NOT EXISTS idx_products_external
  ON products (tenant_id, external_source, external_id)
  WHERE external_id IS NOT NULL;

-- Phase B (B6) — credentials storage scaffolding. Empty for now;
-- adapter implementations land in B-2. Encrypted_credentials is an
-- envelope-encrypted JSON blob (per-tenant DEK wrapped by a Worker
-- secret-bound KEK). See lib/crypto.ts for the helpers.
CREATE TABLE IF NOT EXISTS integration_credentials (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id),
  provider              text NOT NULL,
  account_label         text,
  encrypted_credentials jsonb NOT NULL,
  scopes                text[],
  expires_at            timestamp,
  status                text NOT NULL DEFAULT 'active',
  created_at            timestamp NOT NULL DEFAULT NOW(),
  rotated_at            timestamp,
  UNIQUE (tenant_id, provider, account_label)
);

CREATE INDEX IF NOT EXISTS idx_integration_credentials_tenant_provider
  ON integration_credentials (tenant_id, provider)
  WHERE status = 'active';
