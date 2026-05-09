# Phase C · Iteration 09 — Product picker upgrade

**Audit items closed:** #31
**Depends on:** Iteration 02 (clean wizard state)
**Blocks:** none
**Estimated session length:** medium (1 PR, ~half day)

## Why now
The wizard's product picker is a native `<select>` dropdown of every
product the tenant owns. With 200 SKUs it's unusable: no search, no
thumbnails, no recently-launched filter, no category grouping. A
marketer with a real catalog scrolls forever and can't tell SKUs
apart. This iteration replaces the `<select>` with a lightweight
combobox: type-ahead search over name + SKU + category, optional
thumbnail strip, and a "recently launched" pre-filter.

## Files to touch

- (new) `apps/dashboard/src/components/launch/product-picker.tsx`
  — combobox component with:
  - Search input (debounced 200ms)
  - Filter chips: `[All] [Recently launched] [Drafts]`
  - Result list: SKU + name + thumbnail (lazy loaded from R2)
  - Keyboard nav (arrow up/down, enter to select)
  - Selected state matches existing wizard's compact breadcrumb
- `apps/dashboard/src/components/launch-wizard.tsx`
  - Replace the `<select>` block (lines 420–432) with the new
    `<ProductPicker selected={productId} onChange={setProductId} />`
  - Drop the `selected` breadcrumb derivation since the picker
    owns it
- `apps/mcp-server/src/index.ts`
  - Extend `GET /v1/products` to support `?q=<search>` and
    `?recent=true` (last 30 days, ordered by `last_launch_at`)
  - Server-side search uses `ILIKE '%term%'` on `name_en`, `name_zh`,
    `sku`, `category`. Trigram index nice-to-have but not required
    for v1

## Acceptance criteria

- [ ] Wizard product picker is a search input, not a `<select>`.
      Typing "rod" filters to matching SKUs across name + SKU
      fields with a 200ms debounce
- [ ] Result rows show a thumbnail (first reference image, lazy
      loaded). Missing image falls back to a category icon
- [ ] Filter chips work: "Recently launched" returns only products
      with a `last_launch_at` in the last 30 days
- [ ] Picker is keyboard-accessible: arrow keys navigate results;
      enter selects; escape closes
- [ ] With 200 products, search latency is < 100ms

## Implementation notes

- Don't add a third-party combobox dep (no `@headlessui/combobox`
  etc.). Custom is fine — needs ~100 lines of state management
- Thumbnails use `<img loading="lazy">`. Sized 32×32. Square crop
  to keep grid alignment
- The `last_launch_at` column may not exist on `products` —
  derive via subquery from `runs` table: `(SELECT max(created_at)
  FROM runs WHERE product_id = products.id)`. Cache as a tenant-
  scoped query for 60s if perf becomes an issue
- The recently-launched filter is a tab default for users who've
  ever launched anything — empty for new users

## Out of scope (do NOT do this iteration)

- Bulk-launch from the picker (multi-select + single launch) —
  separate feature
- Inline product creation from the picker — defer
- Drag-and-drop reorder of recently-launched — too much for one
  iteration
- Tag/folder organization — needs schema work, defer
