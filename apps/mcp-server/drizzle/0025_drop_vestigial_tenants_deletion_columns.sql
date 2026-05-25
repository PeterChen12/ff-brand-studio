-- 0025 — Drop vestigial deletion_* columns on tenants.
--
-- Background:
--   Migration 0023 introduced a dedicated `tenant_deletions` table for
--   GDPR right-to-erasure (status enum + audit timestamps). The
--   `tenants` table had earlier scaffolding columns from a prior
--   never-wired attempt:
--     - deletion_requested_at
--     - deletion_eligible_at
--     - deletion_reason
--   Verified `SELECT COUNT(*) WHERE … IS NOT NULL → 0` on the live DB
--   before this migration: no row carries any data in these columns,
--   so dropping is a pure cleanup.
--
-- Idempotent: DROP COLUMN IF EXISTS.
-- Reversible: re-add with a follow-up migration if needed.

ALTER TABLE tenants DROP COLUMN IF EXISTS deletion_requested_at;
ALTER TABLE tenants DROP COLUMN IF EXISTS deletion_eligible_at;
ALTER TABLE tenants DROP COLUMN IF EXISTS deletion_reason;
