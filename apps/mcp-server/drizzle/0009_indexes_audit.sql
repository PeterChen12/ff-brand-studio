-- 0009_indexes_audit.sql — backend audit P1-3, P1-4, P1-6, P2-4
--
-- Adds composite indexes on hot cursor-paginated query paths and
-- tightens the platform_listings_versions FK so orphan version rows
-- are deleted automatically when a listing is removed.
--
-- Idempotent: every index uses IF NOT EXISTS; the FK alter checks
-- pg_constraint before re-creating.

-- P1-3 — products list paginates on (tenant_id, created_at DESC)
CREATE INDEX IF NOT EXISTS idx_products_tenant_created
  ON products (tenant_id, created_at DESC);

-- P1-4 — launch_runs list paginates on (tenant_id, created_at DESC)
CREATE INDEX IF NOT EXISTS idx_launch_runs_tenant_created
  ON launch_runs (tenant_id, created_at DESC);

-- P2-4 — legacy assets table also reads by (tenant_id, created_at DESC)
CREATE INDEX IF NOT EXISTS idx_assets_tenant_created
  ON assets (tenant_id, created_at DESC);

-- P1-6 — platform_listings_versions.parent_listing_id should cascade
-- on parent delete so orphan versions don't accumulate. Drop + re-add
-- with the cascade clause; idempotent because the constraint name is
-- deterministic.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name = 'platform_listings_versions'
      AND constraint_name = 'platform_listings_versions_parent_listing_id_fkey'
  ) THEN
    ALTER TABLE platform_listings_versions
      DROP CONSTRAINT platform_listings_versions_parent_listing_id_fkey;
  END IF;
  -- Re-create with ON DELETE CASCADE
  ALTER TABLE platform_listings_versions
    ADD CONSTRAINT platform_listings_versions_parent_listing_id_fkey
    FOREIGN KEY (parent_listing_id)
    REFERENCES platform_listings (id)
    ON DELETE CASCADE;
END$$;
