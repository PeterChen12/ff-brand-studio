# Phase D · Iteration 03 — Cost reduction strategies

**Problem:** #3 ($6.20/launch — is this normal? how to save?)
**Depends on:** none
**Blocks:** none
**Estimated session length:** medium (1 PR, ~half day, requires care)

## Why now
A current full launch is `12 slots × $0.50 + 2 listings × $0.10 =
$6.20`. For a 100-SKU catalog, that's $620 in image gen. This isn't
unreasonable for AI-generated commercial product imagery (a human
photographer + retoucher would charge 10-50× more), but there are real
inefficiencies in our current pipeline that are spending wallet on
work that doesn't add quality. This iteration ships the highest-
impact savings without quality degradation.

## Cost-reduction levers (in priority order)

### 1. Cross-platform image dedup
Amazon main hero and Shopify hero are visually nearly identical
(white background, product centered). Today we generate them twice.

**Fix:** content-addressed cache keyed by `(product_id, slot_kind,
quality_preset)` where `slot_kind` collapses Amazon-hero + Shopify-hero
into one canonical kind. Skip second generation, reuse the R2 URL,
emit a "deduped" cost ledger row showing $0 for that slot.

**Expected savings:** ~$0.50–$1.00 per launch when both marketplaces
are selected (the most common case). 8–16% off the total bill.

### 2. Smart-tier per slot
Today the operator picks one quality tier for the whole launch
("Recommended", "Best performing", "Most cost saving"). But white-bg
infographics don't benefit from 4K — only lifestyle composites do.

**Fix:** quality tier becomes a per-slot routing decision. Lifestyle
images use the operator's chosen tier; white-bg + spec-table go to
the budget tier (-30% per image) regardless of overall preset.

**Expected savings:** ~$0.10–$0.20 per launch on Recommended,
~$0.20–$0.30 on Best performing. 3–5% off.

### 3. Batch-discount for queued jobs
When the D1 queue holds ≥5 jobs in `queued` state, switch to FAL's
async batch endpoint for the white-bg + spec-table workers (Most-
cost-saving routing applied automatically). Operator gets a banner:
"Batch mode active — 25% off images for the next 5 jobs." Lifestyle
images stay on synchronous tier to keep latency reasonable.

**Expected savings:** ~$1.50/launch when batch-active. 24% off.

### 4. Optional A+ comparison grid
Today the 7th Amazon slot (A+ comparison grid) ships for every Amazon
launch when `tenant.features.amazon_a_plus_grid === true`. It's $0.50
of generation that not every product needs.

**Fix:** make it a per-launch toggle in the wizard, default off (vs.
the current tenant default). Mei can opt in for hero SKUs.

**Expected savings:** ~$0.50/launch when off (most launches). 8% off.

## Files to touch

- `apps/mcp-server/src/orchestrator/launch_pipeline.ts` — add a
  cross-slot dedup pass before the worker loop. New helper at
  `lib/slot-dedup.ts`
- `apps/mcp-server/src/orchestrator/workers/index.ts` — accept a
  `tier_override?: "budget"|"balanced"|"premium"` per worker; route
  white-bg + spec-table to budget tier always
- `apps/mcp-server/src/index.ts` — extend the `/v1/launches/preview`
  response with `breakdown.savings` showing what the optimizations
  saved vs naive cost
- `apps/dashboard/src/components/launch-wizard.tsx` — show the
  savings line in the cost preview ("$6.20 — saved $2.10 via dedup +
  smart-tier"). Add A+ grid toggle as a per-launch checkbox

## Acceptance criteria

- [ ] Launching with both Amazon + Shopify selected costs less than
      launching each separately summed (proves dedup ran)
- [ ] Cost preview shows a green "saved $X.XX" line itemizing dedup +
      tier-routing savings
- [ ] Toggling A+ comparison grid off in the wizard drops the slot
      count from 12 to 11 and the predicted cost by $0.50
- [ ] When ≥5 jobs are in the D1 queue, a banner reads "Batch mode —
      25% off images" and the next launch's predicted cost reflects it
- [ ] Wallet ledger rows tag deduped slots with `cost_cents = 0` and
      `reason = 'image_dedup'` so the books still balance

## Implementation notes

- Dedup CANNOT collapse compliance-shaped slots (Amazon's exact
  1500×1500 white-bg vs Shopify's 1800×1800) into one image — those
  must remain separately rendered for spec compliance. Dedup applies
  only when slot specs are bit-for-bit identical
- Smart-tier routing per slot needs a small lookup table:
  `slot_kind: budget | balanced | premium` → bracket. Keep it static
  in `lib/slot-tier-map.ts` so non-engineers can read it
- A+ grid toggle persists in `searchParams` so a marketer who toggles
  off and reloads doesn't lose the choice
- Don't auto-degrade quality on existing launches — savings only apply
  to NEW launches; historical wallet ledger stays intact

## Out of scope (do NOT do this iteration)

- Image-result caching across products (e.g., reuse a generic
  outdoor-lifestyle backdrop) — too lossy for compliance
- Changing the per-image base price — that's a packaging concern, not
  a feature
- Async batch endpoint plumbing — depends on FAL having one; if not,
  defer "batch-discount" to D-future
- Volume-tier discount baked into wallet ledger — pricing question,
  not engineering
