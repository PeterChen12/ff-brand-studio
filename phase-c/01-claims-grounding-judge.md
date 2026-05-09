# Phase C · Iteration 01 — Claims-grounding LLM judge

**Audit items closed:** #A
**Depends on:** none
**Blocks:** none (but should ship before bulk customer launches)
**Estimated session length:** medium (1 PR, ~half day)

## Why now
Today the system can fabricate product specs ("Waterproof to 50m", "Made
in USA", "IP68 rated") and surface them to the operator with the same
EXCELLENT/GOOD/FAIR/POOR rating used for image quality. **There is no
fact-check between the source product data and the generated copy.**
Publishing fabricated claims to Amazon is a takedown + FTC + product-
liability risk. This iteration adds a cheap LLM-as-judge pass that
flags ungrounded claims so the existing HITL inbox catches them.

## Files to touch

- (new) `apps/mcp-server/src/lib/claims-grounding.ts` — Sonnet-Haiku judge.
  Input: `{ source_fields, generated_copy }`. Output:
  `{ rating: "GROUNDED"|"PARTIALLY_GROUNDED"|"UNGROUNDED",
     ungrounded_claims: string[], confidence: number }`.
- `apps/mcp-server/src/index.ts` — call the judge after the SEO step but
  before persisting the listing rating. If `UNGROUNDED` or
  `PARTIALLY_GROUNDED`, downgrade overall rating → `FAIR` so it lands in
  HITL inbox; attach `ungrounded_claims` to the listing row.
- `apps/mcp-server/src/db/schema.ts` — add `ungroundedClaims:
  jsonb("ungrounded_claims")` to `listings` table (nullable).
- (new) `apps/mcp-server/drizzle/0014_listing_grounding.sql` — schema
  migration matching above.
- `apps/dashboard/src/components/listings/ListingCopy.tsx` — render the
  `ungrounded_claims` array as a yellow callout above the copy if
  present: "AI flagged these as not grounded in your input — verify
  before publishing."
- `apps/dashboard/src/app/inbox/_client.tsx` — when an asset has
  ungrounded claims, show the claim list inline on the inbox card.

## Acceptance criteria

- [ ] A test listing seeded with source `{ name: "Cotton T-shirt",
      description: "100% cotton, machine washable" }` and generated
      copy containing "waterproof" comes back rated `UNGROUNDED` with
      `["waterproof"]` in the array
- [ ] Same source with generated copy containing only claims grounded
      in the input ("100% cotton", "machine washable", "soft hand feel"
      — last is a reasonable inference) returns `GROUNDED`
- [ ] When `UNGROUNDED`, the listing's overall rating is downgraded to
      FAIR and the run lands in `/inbox` even if image scores were good
- [ ] `ungrounded_claims` JSON renders as a yellow alert above the copy
      preview in the dashboard
- [ ] Judge cost ≤ $0.01 per listing (Haiku at ~200 input + 200 output
      tokens)
- [ ] Migration 0014 applied to prod via `apply-migration.mjs`

## Implementation notes

- **Judge prompt shape:** "Given the source product data below and the
  generated listing copy, list every factual claim in the copy that
  is NOT supported by, or directly contradicts, the source. Return JSON
  `{ rating, ungrounded_claims, confidence }`. Reasonable inferences
  from the source ARE grounded (e.g. 'soft hand feel' from '100%
  cotton'); fabricated specs are not."
- Use Haiku 4.5 (`claude-haiku-4-5-20251001`) — cheap, fast, sufficient
  for this judgement. Cap output at 500 tokens.
- The judge ONLY runs on listing copy (text), NOT image alt-text or
  image overlays in v1. Cover those in a follow-up.
- If the judge call itself fails (timeout, 5xx), default to
  `PARTIALLY_GROUNDED` with `confidence: 0` so we err on the side of
  HITL review — never silently ship.
- Store the judge response on the run as a billable event
  (`claims_grounding_check`, ~$0.01) in `wallet_ledger` for cost
  attribution.

## Out of scope (do NOT do this iteration)

- Image-overlay text grounding (defer to iteration 11)
- Multi-judge ensemble for high-stakes categories (medical, supplements,
  electronics regulatory claims) — single Haiku pass is v1
- Auto-rewrite of ungrounded claims (could be a "Suggest fix" button,
  but for v1 the operator just rejects + regenerates)
- Surfacing per-claim source-citation evidence — keep the output to a
  flat `ungrounded_claims` list
