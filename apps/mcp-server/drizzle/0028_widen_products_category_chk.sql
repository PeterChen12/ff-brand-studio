-- 0028 — widen products_category_chk to include the app's PRODUCT_CATEGORIES.
--
-- 2026-06-08 root cause: the AI auto-classifier
-- (apps/mcp-server/src/lib/derive-product-metadata.ts → PRODUCT_CATEGORIES)
-- emits fishing-rod / handbag / watch / shoe / accessory, but the DB
-- products_category_chk constraint only allowed apparel / drinkware / tech-acc
-- / bag / hat / other. So EVERY product the classifier tagged as one of the
-- former (e.g. every BuyFishingRod rod → "fishing-rod") failed the insert with
-- `violates check constraint "products_category_chk"` and returned a 500 on
-- POST /v1/products (and /v1/products/ingest).
--
-- This is ADDITIVE: it keeps every value the constraint already allowed (so no
-- existing row is invalidated) and adds the app's remaining categories. The
-- handler also clamps any out-of-set category to AI derivation as defense in
-- depth. Keep this list in sync with PRODUCT_CATEGORIES.
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_category_chk;
ALTER TABLE products ADD CONSTRAINT products_category_chk
  CHECK (category = ANY (ARRAY[
    'apparel', 'drinkware', 'tech-acc', 'bag', 'hat', 'other',
    'fishing-rod', 'handbag', 'watch', 'shoe', 'accessory'
  ]::text[]));
