# Phase D · Iteration 06 — FF Studio multi-reference best-fill

**Audit items closed:** Bearking 4.1 (single-reference bottleneck) —
the #1 ranked silently-bad-output cause in the audit
**Depends on:** none
**Blocks:** none
**Estimated session length:** medium (1 PR, ~half day, careful)

## Why now
Today `runProductionPipeline` does `referenceR2Keys[0]` and discards
N−1 vendor angles. If the operator dropped 8 reference images, only
the first one informs every downstream worker. When the first happens
to be an awkward angle (back of the package, watermark, low fill), the
generated assets silently inherit the bad framing. Two DMK products
needed manual fixes earlier this session for exactly this reason.

## Files to touch (all in `apps/mcp-server/src`)

- `lib/image_post.ts` (existing — has `measureProductFill` already)
  - Export a new helper `pickBestReference(refs: { r2_key, buffer }[])`
    that scores each reference on:
    1. `productFillRatio` (target 0.55–0.75 — too small or too large
       both penalize)
    2. `cornerWhiteness` (clean white-bg images score higher than busy
       backgrounds)
    3. `longestSidePixels` (penalize anything <1500px)
    4. saliency-center distance (product centered = better)
  - Returns the reference with the highest weighted score plus its
    score breakdown so we can audit-log the choice

- `pipeline/index.ts`
  - Replace `referenceR2Keys[0]` with `pickBestReference(...)`. Keep
    the `referenceR2Keys` array passed to downstream workers so a
    future iteration can multi-reference the lifestyle composer (out
    of scope here)
  - Emit an `image_qa_judgments` row with `kind: 'reference_pick'`
    capturing the score breakdown — observability for "why did the
    pipeline pick reference 3?"

- `db/schema.ts`
  - Existing `imageQaJudgments` table already accepts arbitrary
    `kind` values (Phase G layered on top). No schema change needed

- `apps/dashboard/src/components/launch-wizard.tsx`
  - When the launch result includes a `reference_pick` audit row,
    show a small "Used reference image #3 of 8 (best fill score)"
    note in the result panel. Lets the operator verify the
    automation's choice

## Acceptance criteria

- [ ] A product with 8 references that includes one obviously-better
      angle (e.g., the only one shot on white background) generates
      assets from THAT reference, not the alphabetically-first one
- [ ] The `image_qa_judgments` table has a new row per launch with
      `kind = 'reference_pick'` and a JSON metadata blob containing
      score for every candidate reference
- [ ] If all references score below a quality floor (e.g., all
      <1500px), the pipeline still picks the best of the bad bunch
      AND emits a `notes[]` warning that propagates to the launch
      result so the operator sees "All references low-quality —
      consider higher-resolution sources"
- [ ] The launch result panel shows which reference was used (e.g.,
      "Used reference 3/8 — fill 0.62, white-bg score 0.91")
- [ ] No regression: a product with exactly 1 reference still works
      identically (best-of-1 = that-one)

## Implementation notes

- Scoring is deterministic. Use sharp's native `stats()` for fill
  + corner-whiteness; `metadata()` for dimensions. NO LLM call in the
  scoring path — it must be sub-second
- The weighted formula: 0.5×fill + 0.3×whiteness + 0.15×size +
  0.05×saliency. Tunable as a const at the top of `image_post.ts`
- Saliency-center distance is the optional/expensive bit. For v1,
  approximate by checking the center 50% of the image's RGB variance
  (busy center = product probably there). Real saliency model is a
  defer
- Cache score per `(r2_key, weights_hash)` so re-running the same
  product doesn't re-fetch + re-score. Cache key in KV with 24h TTL

## Out of scope (do NOT do this iteration)

- Multi-reference for lifestyle composers (passing 3 references to
  generate a varied composite) — separate iteration once we trust
  best-pick logic
- Per-tenant scoring weight tunables — overkill for v1
- Auto-rejecting all-bad reference batches with HITL pause — defer
  to D8 (input-quality fail-fast)
- Saliency model integration (real CV model, not the variance proxy)
  — defer
- Reference-pick UI in the wizard ("preview candidates, override
  pick") — too much UX for first cut
