# Phase D · Iteration 05 — Bearking data quality

**Audit items closed:** Bearking 3.1, 3.2, 3.3, 3.4, 3.5, 3.7, 3.8,
2.7
**Depends on:** none
**Blocks:** none
**Estimated session length:** medium (1 PR, ~half day; mostly mechanical)

## Why now
Eight data-quality gaps in the Bearking onboard left the catalog
looking unprofessional: HTML entities (`&amp;`) visible in copy,
70-char subtitles truncating in cards, no variant relationships
between L/R-handed SKUs, default `inStock=true` on items vendor
didn't confirm. Same fixes apply to any future vendor batch.

## Files to touch (mostly `creatorain/buyfishingrod-admin`)

- `scripts/extract_bearking_products.py` (or a new follow-up cleanup
  script `scripts/fix_bearking_data_quality.py`):
  - **3.2 HTML entities:** decode `&amp;`, `&quot;`, `&#39;`, etc. in
    `description` + `longDescription` columns for all 27 products.
    Use `html.unescape` on the existing values
  - **3.4 Subtitles:** for any subtitle >70 chars, truncate at the
    first comma OR the 70-char cap with ellipsis. Persist the full
    original to `longDescription` if not already there
  - **3.5 inStock default:** flip to `false` for the 27 Bearking
    products. Operators should opt-in via `/products/[id]` before the
    public storefront can sell

- (new) `scripts/relate_bearking_variants.mjs`:
  - **2.7 + 3.8:** for each pair of `bearking-yuri-50-{left,right}-hand-...`
    create a `ProductRelation` row with `kind: "variant"` linking
    them. Same for any L/R / size pairs detected via slug regex
  - **3.8 image dedup warning:** if two related variants share the
    same `images.src`, log a warning to the console (don't auto-fix —
    operator decides whether identical imagery is acceptable)

- `app/(dashboard)/products/[id]/page.tsx`:
  - When a product has `ProductRelation` rows, render a "Variants"
    card showing siblings with thumbnails. Click-through to the
    sibling's edit page

- (new) `scripts/refresh_specs_from_docx.py`:
  - **3.3:** re-extract the spec table from each docx with stricter
    table-row parsing (the original script lost rows on some series).
    Diff against current `Product.specs` rows; insert missing ones,
    don't overwrite operator-edited rows. Keep the 8–13 → 15+ delta
    auditable in the script's stdout

## Acceptance criteria

- [ ] No `&amp;` / `&quot;` / `&#39;` strings remain in any Bearking
      product's description or longDescription
- [ ] Every Bearking subtitle ≤70 chars; the original long version is
      in longDescription (verify a couple in admin)
- [ ] All 27 Bearking products have `inStock = false`
- [ ] L-hand and R-hand Yuri-50 SKUs each show the sibling in a new
      "Variants" card on the product detail page
- [ ] Spec-row counts increase to a reasonable target (~15) on the
      series that were under-extracted, without overwriting any
      operator-modified rows
- [ ] Storefront catalog file (`src/data/products.ts`, audit issue 3.7)
      gets a regenerate run so the fallback catalog matches DB
      (out-of-scope to fix the redeploy gap; just regenerate once)

## Implementation notes

- All data fixes are SQL-level migrations dressed up as Node scripts.
  Use `postgres` with explicit transactions; print before/after for
  every changed row so the operator can audit
- Run scripts in this order: `relate_variants` → `fix_data_quality` →
  `refresh_specs`. The relations script is the only one that adds
  rows; the others mutate existing ones
- Zero changes to FF Brand Studio side — these are admin-only fixes
- The static catalog regenerate is one command: re-run the existing
  catalog-build script post-migration

## Out of scope (do NOT do this iteration)

- 3.6 (webp re-compression of vendor JPEGs) — requires re-running
  the FF Studio image pipeline; that's an operational call, not
  data quality
- 3.7 fix (auto-keeping static catalog in sync) — that's an
  infrastructure decision in D10
- Auto-detecting variant relationships from arbitrary slug patterns
  beyond L/R-hand — too fragile; do the next case when it shows up
- Generic "vendor batch QA" tooling for future imports — defer to
  the D2 agentic-upload classifier improvements
