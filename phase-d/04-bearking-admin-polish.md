# Phase D · Iteration 04 — Bearking admin polish

**Audit items closed:** Bearking 2.2 (brand whitelist), 2.3 (category
match), 2.5 (Stripe ✗ confusion), 5.3 (Stripe sync DRAFT)
**Depends on:** none
**Blocks:** none
**Estimated session length:** small (1 PR, ~hour)

## Why now
The 27 Bearking products show in the admin product list, but operator
perception is "they're missing or broken." Five small whitelist /
labeling fixes in BFR's admin UI fully resolve the perception gap.
None of these touch the studio worker.

## Files to touch (all in `creatorain/buyfishingrod-admin`)

- `lib/product-categories.ts`
  - Add `"Bearking"` to `PRODUCT_BRANDS` array
  - Document the canonical category enum at the top of the file:
    `baitcasting-reels`, `spinning-reels`, etc. Add a comment that
    bare `"Reels"` is invalid
- `scripts/upload_bearking_products.mjs` (or new follow-up script)
  - Migration script: rewrite category for the 27 Bearking products
    from `"Reels"` to `"baitcasting-reels"` (Zeus, Apollo, KER,
    Matador, Athena, Yuri-spinning) or `"spinning-reels"` (Yuri-BFS).
    Match on `slug LIKE 'bearking-%'`
- `app/(dashboard)/products/page.tsx` (the product list table)
  - Replace the binary red ✗ / green ✓ Stripe-synced indicator with
    a tri-state badge:
    - ACTIVE + synced → green ✓
    - ACTIVE + not synced → red ✗ (real problem)
    - DRAFT → grey "—" (intentional skip, not an error)
- `components/StripeStatusBadge.tsx` (new)
  - Small reusable badge component encoding the tri-state above so
    the same logic doesn't drift across product list / detail pages

## Acceptance criteria

- [ ] Brand-filter dropdown on `/products` includes "Bearking"
- [ ] Editing a Bearking product, the brand select shows "Bearking" as
      the selected option (not silently fallback to LYKAN)
- [ ] All 27 Bearking products' categories are `baitcasting-reels` or
      `spinning-reels` after the migration runs
- [ ] Category-filter dropdown shows the count of Bearking products
      under each reel type
- [ ] Stripe column shows grey "—" for DRAFT rows, red ✗ for ACTIVE
      rows that failed to sync, green ✓ for ACTIVE synced rows.
      Hovering reveals tooltip explaining the state
- [ ] No Bearking product has its brand silently flipped to LYKAN
      after an operator edit + save

## Implementation notes

- The category migration is idempotent: a product whose category is
  already kebab-case is skipped. Re-running the script is safe
- The Stripe badge tri-state should fall back to the most-conservative
  read for any unknown status (treat as "—" not as an error)
- Don't change Stripe sync POLICY — DRAFT products stay un-synced.
  Only the visual representation changes
- Since this is BFR-side only, no studio worker deploy needed; just
  push to the buyfishingrod-admin repo and Amplify auto-builds

## Out of scope (do NOT do this iteration)

- Migrating LYKAN/DMK/other historical brands' categories — focus
  Bearking; do the broader sweep in D5 if needed
- Adding an "intentional" DRAFT indicator beyond the tri-state badge
  (e.g., a separate "Skipped" filter chip) — overkill for v1
- Building a brand-management UI so operators can self-add brands —
  static enum is fine for the current scale
- Auto-syncing DRAFT to Stripe (changing the policy) — this is a
  product call, not engineering
