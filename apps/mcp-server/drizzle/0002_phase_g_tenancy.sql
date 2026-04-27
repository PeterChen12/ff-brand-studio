-- Phase G — Foundation: tenants + tenant_id on every domain table +
-- platform_listings + wallet_ledger + audit_events.
--
-- Idempotent via IF NOT EXISTS guards so the file can be re-applied if a
-- partial run fails halfway. Run order:
--   1) DDL (create new tables, add nullable tenant_id columns, indexes)
--   2) Backfill (insert legacy-demo tenant, set tenant_id on existing rows)
--   3) Tighten (set NOT NULL on tenant_id columns)
-- Step 3 is gated behind a guard that aborts if any tenant_id IS NULL —
-- prevents data loss if the backfill skipped a row.

-- ────────────────────────────────────────────────────────────────────────────
-- 1) New tables
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenants (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_org_id           text UNIQUE NOT NULL,
  name                   text NOT NULL,
  stripe_customer_id     text,
  wallet_balance_cents   integer NOT NULL DEFAULT 500,
  plan                   text NOT NULL DEFAULT 'free',
  features               jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at             timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenants_clerk_org_id ON tenants(clerk_org_id);

CREATE TABLE IF NOT EXISTS platform_listings (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id),
  variant_id             uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  surface                text NOT NULL,
  language               text NOT NULL,
  copy                   jsonb NOT NULL,
  flags                  jsonb NOT NULL DEFAULT '[]'::jsonb,
  violations             jsonb NOT NULL DEFAULT '[]'::jsonb,
  rating                 text,
  iterations             integer NOT NULL DEFAULT 1,
  cost_cents             integer NOT NULL DEFAULT 0,
  status                 text NOT NULL DEFAULT 'draft',
  created_at             timestamp with time zone DEFAULT now(),
  updated_at             timestamp with time zone DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_variant_surface_lang
  ON platform_listings(variant_id, surface, language);
CREATE INDEX IF NOT EXISTS idx_listings_tenant ON platform_listings(tenant_id);

CREATE TABLE IF NOT EXISTS platform_listings_versions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_listing_id      uuid NOT NULL REFERENCES platform_listings(id) ON DELETE CASCADE,
  tenant_id              uuid NOT NULL REFERENCES tenants(id),
  variant_id             uuid NOT NULL,
  surface                text NOT NULL,
  language               text NOT NULL,
  copy                   jsonb NOT NULL,
  flags                  jsonb NOT NULL DEFAULT '[]'::jsonb,
  violations             jsonb NOT NULL DEFAULT '[]'::jsonb,
  rating                 text,
  iterations             integer NOT NULL DEFAULT 1,
  cost_cents             integer NOT NULL DEFAULT 0,
  status                 text NOT NULL,
  version                integer NOT NULL,
  archived_at            timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listings_versions_parent
  ON platform_listings_versions(parent_listing_id, version DESC);

CREATE TABLE IF NOT EXISTS wallet_ledger (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id),
  delta_cents            integer NOT NULL,
  reason                 text NOT NULL,
  reference_type         text,
  reference_id           uuid,
  balance_after_cents    integer NOT NULL,
  at                     timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallet_ledger_tenant_at
  ON wallet_ledger(tenant_id, at DESC);

CREATE TABLE IF NOT EXISTS audit_events (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id),
  actor                  text,
  action                 text NOT NULL,
  target_type            text,
  target_id              uuid,
  metadata               jsonb NOT NULL DEFAULT '{}'::jsonb,
  at                     timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_events_tenant_at
  ON audit_events(tenant_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_action
  ON audit_events(action, at DESC);

-- ────────────────────────────────────────────────────────────────────────────
-- 2) tenant_id columns (nullable for backfill phase)
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE seller_profiles    ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE products           ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE product_variants   ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE product_references ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE platform_assets    ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE launch_runs        ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE assets             ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE run_costs          ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);

CREATE INDEX IF NOT EXISTS idx_seller_profiles_tenant    ON seller_profiles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_products_tenant           ON products(tenant_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_tenant   ON product_variants(tenant_id);
CREATE INDEX IF NOT EXISTS idx_product_references_tenant ON product_references(tenant_id);
CREATE INDEX IF NOT EXISTS idx_platform_assets_tenant    ON platform_assets(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_launch_runs_tenant        ON launch_runs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assets_tenant             ON assets(tenant_id);
CREATE INDEX IF NOT EXISTS idx_run_costs_tenant          ON run_costs(tenant_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 3) Backfill — every existing row goes to the legacy-demo tenant
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO tenants (id, clerk_org_id, name, plan, features, wallet_balance_cents)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'legacy-demo',
  'Sample Catalog (Legacy Demo)',
  'sample',
  '{"has_sample_access": true, "is_sample_tenant": true}'::jsonb,
  0
)
ON CONFLICT (clerk_org_id) DO NOTHING;

UPDATE seller_profiles    SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE products           SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE product_variants   SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE product_references SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE platform_assets    SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE launch_runs        SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE assets             SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE run_costs          SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- 4) Tighten — guard then enforce NOT NULL
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  null_count integer;
BEGIN
  SELECT
    (SELECT count(*) FROM seller_profiles    WHERE tenant_id IS NULL) +
    (SELECT count(*) FROM products           WHERE tenant_id IS NULL) +
    (SELECT count(*) FROM product_variants   WHERE tenant_id IS NULL) +
    (SELECT count(*) FROM product_references WHERE tenant_id IS NULL) +
    (SELECT count(*) FROM platform_assets    WHERE tenant_id IS NULL) +
    (SELECT count(*) FROM launch_runs        WHERE tenant_id IS NULL) +
    (SELECT count(*) FROM assets             WHERE tenant_id IS NULL) +
    (SELECT count(*) FROM run_costs          WHERE tenant_id IS NULL)
  INTO null_count;

  IF null_count > 0 THEN
    RAISE EXCEPTION 'Phase G migration aborted: % rows still have tenant_id IS NULL after backfill', null_count;
  END IF;
END $$;

ALTER TABLE seller_profiles    ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE products           ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE product_variants   ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE product_references ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE platform_assets    ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE launch_runs        ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE assets             ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE run_costs          ALTER COLUMN tenant_id SET NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- 5) Bonus signup-ledger row for the legacy-demo tenant if missing.
--    Sample tenants have wallet_balance_cents = 0 and are billed-out;
--    this row exists purely to keep the integrity audit script clean.
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO wallet_ledger (tenant_id, delta_cents, reason, balance_after_cents)
SELECT '00000000-0000-0000-0000-000000000001', 0, 'tenant_created', 0
WHERE NOT EXISTS (
  SELECT 1 FROM wallet_ledger
  WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
);
