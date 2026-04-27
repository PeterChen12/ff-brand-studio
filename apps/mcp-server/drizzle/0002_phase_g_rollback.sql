-- Rollback for Phase G — drops new tables and tenant_id columns. NOT
-- idempotent in production (will lose tenant data); use only on local /
-- staging or after explicitly confirming with the user.

ALTER TABLE seller_profiles    DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE products           DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE product_variants   DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE product_references DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE platform_assets    DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE launch_runs        DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE assets             DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE run_costs          DROP COLUMN IF EXISTS tenant_id;

DROP TABLE IF EXISTS audit_events;
DROP TABLE IF EXISTS wallet_ledger;
DROP TABLE IF EXISTS platform_listings_versions;
DROP TABLE IF EXISTS platform_listings;
DROP TABLE IF EXISTS tenants;
