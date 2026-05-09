# Phase D · Iteration 09 — FF Studio pipeline polish (#4–10)

**Audit items closed:** Bearking 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10 —
performance and reliability fixes that don't gate trust
**Depends on:** D6 (multi-reference scoring), D8 (input-quality gate)
**Blocks:** none
**Estimated session length:** medium (1 PR, ~half day)

## Why now
Seven smaller pipeline issues from the audit, none of which alone
cause silently-bad outputs but together amount to a slower, less
reliable, less observable pipeline. Bundling them into one iteration
because they're all in the same set of files (`lib/image_post.ts`,
`pipeline/iterate.ts`).

## The 7 fixes

### #4 — `measureProductFill` is O(W·H) JS
27M raw-pixel reads per QA pass on a 3000×3000 buffer. Replace with
sharp's native `stats()` + `trim()`.

### #5 — CLIP threshold hard-coded per-kind
All non-multi kinds use 0.78. Add a `clipThresholdOverride: real|null`
column to `products` so per-product tuning is possible. Migration
0015.

### #6 — Cost-cap halt is after-the-fact
`chargeAndAccount` debits before checking budget headroom. Move the
check to BEFORE the worker invocation; only debit after success.

### #7 — No transient-vs-quality distinction
A FAL 5xx counts as one of the 3 iterations. Wrap the FAL call in
retry-with-backoff (3 attempts: 0ms, 500ms, 2000ms) for 5xx/429.
Only count quality-fail toward the iteration cap.

### #8 — `forceWhiteBackground` tolerance hard-coded at 8
Add a `tenant.features.white_bg_tolerance: number` flag. Default 8;
operators on darker brand colors can tune up. No UI surface; setting
via `PATCH /v1/tenants/me/preferences`.

### #9 — Corner sampling uses `Math.random()`
Re-running QA gives different pass/fail. Replace with a seeded RNG
(hash of imageBuffer's sha256, take low 32 bits). Deterministic
output for the same input.

### #10 — No dedup on identical refine calls
Hash `(sourceR2Key, cropR2Key, prompt)` and cache FAL result for 24h
in KV. Each `(platform, slot)` pair that produces the same hash
returns the cached URL.

## Files to touch (all in `apps/mcp-server/src`)

- `lib/image_post.ts`
  - Replace `measureProductFill` body with sharp `stats()` + `trim()`
    calculation (#4)
  - Replace `Math.random()` corner sampling with seeded RNG (#9)
- `pipeline/iterate.ts`
  - Wrap FAL call in `retry({ retries: 3, backoff: [0, 500, 2000] })`
    for 5xx/429; only count quality-fail toward iteration cap (#7)
  - Compute `(sourceR2Key, cropR2Key, prompt)` hash before FAL call;
    check KV; return cached URL if present (#10)
- `pipeline/index.ts`
  - Move cost-cap check to BEFORE worker invocation; debit only after
    success (#6)
- `pipeline/derivers/index.ts`
  - Read `product.clipThresholdOverride` if non-null; fall back to
    the kind default (#5)
- `db/schema.ts` — add `clipThresholdOverride: real("clip_threshold_override")`
  to `products` table (#5)
- (new) `drizzle/0015_clip_threshold_override.sql` — schema migration
- `pipeline/cleanup.ts` — read `tenant.features.white_bg_tolerance`,
  fall back to 8 (#8)

## Acceptance criteria

- [ ] `measureProductFill` runs <50ms on a 3000×3000 input (was
      ~600ms before). Verify with a console.time during a smoke launch
- [ ] Re-running the same launch twice produces identical
      compliance-score outputs (deterministic QA)
- [ ] A FAL 502 response triggers a retry; only the third 502 in a
      row counts as one of the 3 iteration attempts
- [ ] Cache hit on a re-run launch with identical inputs surfaces
      `notes: ["fal_cache_hit slot=amazon-hero"]` and the wallet
      ledger row for that slot has `cost_cents: 0`
- [ ] Setting `tenant.features.white_bg_tolerance: 12` via the prefs
      PATCH propagates into the next launch's cleanup pass
- [ ] Migration 0015 applied to prod via `apply-migration.mjs`

## Implementation notes

- The retry wrapper for #7 should NOT retry on 4xx (those are FAL
  prompt-rejection — retrying won't help). Only 5xx + 429
- The seeded RNG for #9 doesn't need crypto-quality randomness; a
  simple LCG seeded with the buffer hash is fine
- The KV cache for #10 has a 24h TTL; operators who regenerate a
  product with the same prompt within that window get a freebie
- `clip_threshold_override` is nullable; existing rows stay null and
  use the kind default

## Out of scope (do NOT do this iteration)

- Replacing CLIP entirely with a different image-similarity model —
  swap is its own iteration
- Tenant-level FAL key swapping (BYOK) — separate iteration if a
  customer ever asks
- Per-launch cost-cap UI in the wizard — defer to a billing iteration
- Caching across tenants (shared FAL responses) — privacy concern
