# Phase C · Iteration 07 — Cost & wallet transparency

**Audit items closed:** #16, #29, #33, #39
**Depends on:** Iteration 05 (vocab sweep — friendlyStatus helper)
**Blocks:** none
**Estimated session length:** small (1 PR, ~hour)

## Why now
The cost story is fragmented: launch button uses `$X.XX`, hint text
uses `50¢/image`, breakdown rows use cents notation. KPI ribbon shows
"Total spend $42.50" with no time scope. Wallet pill turns red below
$0.50 with no explainer copy. Cost breakdown labels rows by internal
jargon ("4 surfaces × 5¢"). Pick one currency style, add scope to
KPIs, write friendly wallet-state copy, and translate "surfaces" to
"listings."

## Files to touch

- `apps/dashboard/src/lib/format.ts`
  - Add `formatPrice(cents: number, mode?: "compact"|"full"): string`
    that always returns `$X.XX` for ≥$1.00, `$0.XX` for < $1 (never
    `XX¢`). Replace all visible callers
- `apps/dashboard/src/components/launch-wizard.tsx`
  - Quality preset hint (line 584): `${formatCents(q.perImageCents)}/image`
    → `${formatPrice(q.perImageCents)}/image`
  - Cost breakdown Row component (line 836+): "4 surfaces × 5¢" →
    "4 listings × $0.05" (translate "surfaces" + currency)
  - Tweak panel "Regenerate · $0.30" — already correct, no change
- `apps/dashboard/src/app/_overview-client.tsx`
  - KPI ribbon "Total spend" cell: add a small selector or fixed
    "this month" label so the scope is unambiguous. Default to
    last-30-days. Backend already supports `?since=` on
    `/api/launches`; iterate scope client-side from existing data
    (filter by `createdAt >= now - 30d`)
- `apps/dashboard/src/components/layout/shell.tsx`
  - Wallet pill: when `walletState.cents < 50`, show inline copy
    "Top up to keep launching" under the balance
  - When `< 100`, just turn amber, no extra copy (the color is
    enough warning at this threshold)
  - Tooltip on hover always reads "Click to add credits"

## Acceptance criteria

- [ ] No visible `XX¢` notation anywhere in the wizard or library.
      All prices read `$0.XX` or `$X.XX`
- [ ] Cost breakdown Row label says "Listings" (not "surfaces")
      with detail like "4 listings × $0.05" (was "4 surfaces × 5¢")
- [ ] KPI "Total spend" cell has a "Last 30 days" sub-label
- [ ] Wallet pill below $0.50 shows "Top up to keep launching"
      copy under the balance
- [ ] Mei understands at a glance whether the wallet is OK, low,
      or critical without hovering

## Implementation notes

- `formatPrice` lives in `format.ts` next to `formatCents`. Don't
  delete `formatCents` (audit log + admin pages need raw-cent
  precision); just stop using it in marketer-facing surfaces
- Time-scope filter on KPI uses client-side `Date` math against
  the already-fetched `launches` array — no new endpoint needed
- Wallet copy must not push the sidebar layout; use a max-2-line
  truncation
- Don't gate the wallet's "Top up" link behind a config — it
  always points at `/billing`

## Out of scope (do NOT do this iteration)

- Auto-topup config (Stripe billing portal integration is its
  own iteration)
- Per-SKU cost attribution (which products burned the most spend)
  — interesting analytics but defer
- Forecasting / "at this rate, you'll run out in 5 days"
- Currency localization (CNY for CN sellers) — single-currency for
  v1
