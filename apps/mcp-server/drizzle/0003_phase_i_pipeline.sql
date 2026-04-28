-- Phase I — Production-quality image pipeline schema additions.
--
-- Adds:
--   1) products.kind text NOT NULL DEFAULT 'compact_square'
--   2) Backfill kind for existing rows from products.category mapping.
--
-- The tenant feature flag `production_pipeline` lives in the existing
-- tenants.features jsonb column; no DDL needed for it. Default-off
-- means a missing key reads as false in the orchestrator, which is the
-- safe path.
--
-- Idempotent via IF NOT EXISTS / DO blocks so re-application is harmless.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) products.kind
-- ─────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'products' AND column_name = 'kind'
  ) THEN
    ALTER TABLE products ADD COLUMN kind text;
  END IF;
END $$;

-- Backfill from category. Anything unmapped lands on compact_square,
-- which is the safest fallback (shape-agnostic centered framing).
UPDATE products SET kind = CASE
  WHEN category = 'apparel'   THEN 'apparel_flat'
  WHEN category = 'drinkware' THEN 'compact_square'
  WHEN category = 'tech-acc'  THEN 'compact_square'
  WHEN category = 'bag'       THEN 'compact_square'
  WHEN category = 'hat'       THEN 'compact_round'
  WHEN category = 'rod'       THEN 'long_thin_vertical'
  WHEN category = 'reel'      THEN 'compact_square'
  ELSE 'compact_square'
END
WHERE kind IS NULL;

ALTER TABLE products ALTER COLUMN kind SET NOT NULL;
ALTER TABLE products ALTER COLUMN kind SET DEFAULT 'compact_square';

CREATE INDEX IF NOT EXISTS idx_products_kind ON products(kind);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Verify backfill — abort if any kind IS NULL (safety net).
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  null_count integer;
BEGIN
  SELECT count(*) INTO null_count FROM products WHERE kind IS NULL;
  IF null_count > 0 THEN
    RAISE EXCEPTION 'Phase I migration aborted: % rows in products have NULL kind after backfill', null_count;
  END IF;
END $$;
