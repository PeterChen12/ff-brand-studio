-- Phase iter1 — product description column.
--
-- Issue 2 from FF_DASHBOARD_UX_ITERATION_FINDINGS.md: SEO copy quality
-- suffers without a long-form product description. Adds an optional
-- `description` column on products. Nullable so existing rows stay
-- valid; the dashboard form treats it as optional too. Cap is 2000
-- characters per Amazon listing-description guidance — enforced at
-- the API layer (Zod), not the column type, so we can adjust later
-- without a migration.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS description text;
