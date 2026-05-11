# Phase E · Iteration 05 — Chaining / routing / parallel quality audit + targeted fixes

**Problem:** #4 (audit other places where chaining/routing/parallel
patterns improve quality)
**Depends on:** E3 (validates the routing pattern works), E4 (validates
the chaining pattern works)
**Blocks:** none
**Estimated session length:** medium (1 PR for the high-impact bits;
audit findings logged for later)

## Why now
E3 (category-routed backgrounds) and E4 (chained text-overlay) ship
two examples of Anthropic's effective-agents patterns inside our
pipeline. The audit finds three more high-impact opportunities and
ships the cheapest one. The rest get plan stubs added to this file
for future iterations.

## Audit findings (cross-pipeline)

### Opportunity A — Auto-rewrite for ungrounded SEO claims (chain)
**Today:** claim-grounding judge flags claims like "Waterproof to 50m"
that aren't supported by source. Operator rejects → regenerates from
scratch → may produce a different but still-ungrounded variant. HITL
overhead per asset.

**Fix:** after `UNGROUNDED` verdict, chain a specialist rewrite call:
"Given source X and copy Y, rewrite Y so every claim is grounded in
X. Preserve persuasive structure." Re-run grounding judge; if
GROUNDED, accept; if still UNGROUNDED after 1 attempt, fall back to
HITL.

**Expected impact:** ~60% of UNGROUNDED listings auto-resolve. Saves
operator time, $0.01/listing for the chained call.

### Opportunity B — Compliance defect router (routing)
**Today:** when image QA returns FAIR/POOR with reasons like
"background not pure white" or "text detected in image", all
defect types route to the same generic regenerate prompt that just
re-runs the original. Wastes iterations.

**Fix:** parse the defect strings into typed categories
(`bg_not_white`, `text_in_image`, `wrong_color`, `cropped_subject`,
`watermark`) and route each to a specialist correction prompt that
addresses ONLY that defect with a targeted instruction. White-bg
defects → bg-correction prompt. Cropped → tighter framing prompt.
Text-detected → "remove all text" + sharp post-strip.

**Expected impact:** iteration count drops from 3 to 1 on most FAIR
results. ~30% fewer regenerations needed.

### Opportunity C — Specs-table chained extraction (chain, audit 3.3)
**Today:** Bearking vendor docx parser lost spec rows on some series
(8–13 rows when the source had ~15). Single-pass extractor.

**Fix:** chain extract → validate (Sonnet checks "are all spec rows
in the source captured?") → if NO, re-extract with the missed rows
explicitly named in the prompt.

**Expected impact:** spec completeness near 100%. Operator no longer
re-keys 1–2 rows per product.

### Opportunity D — Multi-judge ensemble for safety claims (chain)
**Today:** single Haiku claims-grounding judge. Acceptable for v1
but for safety-critical categories (medical, supplements, electrical
with regulatory claims) one judge can miss subtle issues.

**Fix:** for tenants/products in regulated categories, chain a
second pass with a more skeptical prompt. If the two judges disagree,
force HITL.

**Expected impact:** near-zero false negatives on regulated
categories.

### Opportunity E — Parallel claims-grounding (parallel)
**Today:** claims-grounding runs sequentially per surface in
`orchestrator/launch_pipeline.ts:670+`.

**Fix:** `Promise.all` the per-surface grounding calls. They're
independent.

**Expected impact:** ~3s wall-clock saved per launch with 4
surfaces. Marginal but free.

## Ship in this iteration

- **Opportunity A — auto-rewrite ungrounded claims** (highest impact,
  smallest scope)
- **Opportunity E — parallel grounding calls** (zero risk, trivial diff)

Defer B, C, D to follow-up iterations. Plan stubs above suffice for
future drafting.

## Files to touch (Opportunities A + E)

- `apps/mcp-server/src/lib/claims-grounding.ts`
  - Add `rewriteUngroundedCopy({ source, currentCopy,
    ungroundedClaims, anthropicKey })` → returns a new copy object.
    Single Haiku call, ~$0.01
- `apps/mcp-server/src/orchestrator/launch_pipeline.ts`
  - Change the per-surface grounding loop from sequential to
    `Promise.all(seoResult.surfaces.map(async (surface) => { ... }))`
  - When `UNGROUNDED` detected, call `rewriteUngroundedCopy(...)`
    once, re-grade with `checkClaimsGrounding(...)`, persist whichever
    final copy lands. Cap at 1 rewrite attempt to bound cost
  - Add new audit note: `auto_rewrite_ungrounded surface=... result=GROUNDED|UNGROUNDED_AFTER_REWRITE`

## Acceptance criteria

- [ ] A test listing with an `UNGROUNDED` initial verdict gets one
      rewrite attempt; if the rewrite makes it `GROUNDED`, the new
      copy is what's persisted to `platform_listings.copy`. Original
      copy goes to `platform_listings_versions` for audit
- [ ] If the rewrite still comes back `UNGROUNDED`, the listing stays
      `FAIR` rating and lands in HITL inbox as before
- [ ] All N surfaces' grounding calls fire in parallel — wall-clock
      time for the grounding step is ~max(individual) not sum
- [ ] `notes[]` on the launch contains the rewrite outcome so the
      operator can see "auto-rewrite saved this from HITL"
- [ ] Cost ledger has a new `reason = 'claim_rewrite'` row for the
      rewrite call

## Implementation notes

- The rewrite prompt is critical. Keep it short, structured, and
  unambiguous:
  > "Given the source product data and a generated listing copy with
  > the listed ungrounded claims, rewrite the copy so every claim is
  > supported by the source. Do not invent new claims. Preserve tone,
  > headline structure, and bullet count. Return JSON: { copy: {...} }
  > matching the input schema."
- Cap rewrite at 1 attempt. Multiple rewrites compound cost without
  proportional quality
- Parallel grounding requires the cost ledger writes to be inside the
  per-surface promise so they don't race. Each promise's wallet
  insert is independent

## Out of scope (do NOT do this iteration)

- Opportunities B, C, D — drafted above, defer to E5.1/5.2/5.3
- Replacing Haiku with a different judge model — model swap is its
  own iteration
- Per-tenant rewrite quotas — wallet already gates total spend
- HITL preview of "before vs after" auto-rewrite — operator sees the
  final copy + the audit note; preview is overkill for v1
