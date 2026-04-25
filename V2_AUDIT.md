# V2 Audit — Phases 1–3

Self-review of `FF_BRAND_STUDIO_V2_ITERATION_PLAN.md` Phases 1–3 against what was actually built. Issues are flagged P0 (blocks correctness), P1 (correctness gap, recoverable), P2 (style/ergonomics).

Verified by running the Phase 3 acceptance test (`scripts/test-phase3-pipeline.ts`) which produced 10 platform_assets rows in 2s with 0 spec violations.

---

## P0 — fix before Phase 4

### 1. Variants generated without a trained LoRA
**Where:** `apps/mcp-server/src/orchestrator/launch_pipeline.ts` workers fan-out, `apps/mcp-server/src/orchestrator/planner.ts` variant block.

The planner returns variants if `product.loraUrl` exists OR `train_lora=true`. But `train_lora=true` only signals the LoRA *should* be trained — Phase 2's `train_sku_lora` is async and may not finish in the same launch run. If we kick off variant generation while `loraUrl` is still null, FLUX.2 Dev runs without the LoRA and produces generic outputs that diverge from the SKU.

**Fix:** gate the variant worker on `product.loraUrl !== null` only. If `train_lora` is set, queue the train but skip variant generation in this run; the next launch (after training completes) will pick them up.

### 2. Worker errors abort the whole launch
**Where:** `launch_pipeline.ts` step 4 — `Promise.all(...)` on workers.

If any single worker throws (e.g., one lifestyle scene fails), the whole launch dies and `launch_runs.status` stays `pending` forever. Plan §4.5 puts an evaluator-optimizer loop here in Phase 4, but Phase 3 should still degrade gracefully.

**Fix:** wrap each worker call in a `Promise.allSettled` style and record per-worker outcomes. On full failure, mark `launch_runs.status='failed'` with an error note. Partial success continues to adapters with the canonicals that succeeded.

### 3. Adapter is not idempotent across re-runs
**Where:** `apps/mcp-server/src/adapters/index.ts` `runAdapter`.

Re-running the orchestrator for the same product appends new `platform_assets` rows rather than replacing. The test script works around this by `DELETE`ing prior rows before each run. Plan §3.2 says "Adapters MUST be idempotent: same canonical + slot → same output." A `(variant_id, platform, slot)` unique constraint + `ON CONFLICT DO UPDATE` would enforce this.

**Fix:** add a unique index on `platform_assets (variant_id, platform, slot)` and switch the adapter insert to upsert. Migration is additive and safe.

---

## P1 — fix before Phase 4 if cheap, otherwise track

### 4. `platform_specs` seed uses `ON CONFLICT DO NOTHING`
**Where:** `scripts/schema.sql` v2 seed block.

This means the only way to update a spec value (e.g., Amazon raises minimum zoom from 1000px to 1600px) is to manually `DELETE` and re-seed. Plan §0.3 says specs are the "single source of truth" with "one row update" semantics — that ergonomic only works with upsert.

**Fix:** change `ON CONFLICT (platform, slot) DO NOTHING` to `ON CONFLICT (platform, slot) DO UPDATE SET ...` listing every column. Alternative: keep DO NOTHING but write a `scripts/reseed-platform-specs.mjs` that does DELETE+INSERT in a transaction.

### 5. Adapter only validates file size + format, not dimensions
**Where:** `runAdapter` violations check.

The function reads `min/max width/height` from `platform_specs` and uses them to derive output dimensions, but never validates that the *derived* dimensions actually fall within those bounds. For canonicals smaller than the spec floor (e.g., 800×800 source for a 2000×2000 Amazon main), `deriveDimensions` returns a target the resize would have to upscale to — without the resize itself happening yet (Phase 2). When Phase 2 lands, this will silently upscale beyond source resolution.

**Fix:** validate `canonical.width >= spec.minWidth` (and height) before deriving. If undersized, report a violation and let Phase 4's evaluator route to regeneration.

### 6. Aspect ratio not validated against the spec
**Where:** `runAdapter`.

Spec rows declare `aspect_ratio` (e.g., '1:1', '2.44:1') but the adapter never checks it. With placeholder canonicals this is harmless; with real Phase 2 outputs that may not match aspect, we'd ship non-compliant assets.

**Fix:** parse `aspect_ratio` and compare to `width/height` with ±2% tolerance.

### 7. `refinement_history` column starts as NULL
**Where:** all adapter inserts and `launch-product-sku.ts` runs.

Plan §4.5 evaluator-optimizer expects to *append* to `refinement_history`. Drizzle/jsonb append on NULL silently no-ops. Initialize as `[]` so Phase 4 appends work without a null check.

**Fix:** default `refinement_history` to `[]` in the adapter insert.

### 8. `category` field is freeform text
**Where:** `products.category` column (schema.sql + Drizzle).

Plan §1.1 enumerates 6 categories; the planner's `LIFESTYLE_COUNT_BY_CATEGORY` falls back to 2 for unknown categories. Without a CHECK constraint or app-level enum, a typo (`'apperel'`) silently uses the fallback instead of erroring loudly.

**Fix:** add a CHECK constraint in schema.sql and a Zod enum for `category` in `packages/types`.

---

## P2 — style / docs / ergonomics

### 9. Test script delete-before-test masks idempotency issues
**Where:** `scripts/test-phase3-pipeline.ts` `ensureTestProduct` resets prior assets.

Useful for clean re-runs, but it hides the P0 #3 issue. After fixing #3 (upsert), the DELETE step can stay as a hygiene measure but should be optional.

### 10. `prepare: false` on apply-v2-schema.mjs
**Where:** `scripts/apply-v2-schema.mjs`.

Disables prepared statements to allow multi-statement input. One-shot setup script, fine for now. If anyone reuses postgres-js for queries inside this file, they should re-enable.

### 11. `CloudflareBindings` cast in test script
**Where:** `scripts/test-phase3-pipeline.ts` `env as unknown as CloudflareBindings`.

Bypasses TS's check that env keys exist. Fine for a script, but a cleaner pattern would be a typed `mockEnv()` helper.

### 12. No Langfuse tracing in the orchestrator
**Where:** `launch_pipeline.ts`.

Plan §3.4 says "LangGraph trace visible in Langfuse with one root span per worker." Phase 3's orchestrator runs no LLM calls (planner is pure JS), so there's nothing to trace yet — but the wiring isn't there for Phase 4 when planner becomes Sonnet 4.6.

**Track for Phase 4** — when planner upgrades to LLM, wire Langfuse spans then.

### 13. Plan-doc inconsistency on shopify slots
**Where:** `FF_BRAND_STUDIO_V2_ITERATION_PLAN.md` §1.2 vs §3.2.

§1.2 lists 3 Shopify slots (main, lifestyle, banner). §3.2 lists 4 (main, lifestyle, banner, detail). Phase 3 build added the 4th to make the ≥10 acceptance possible. The plan doc should be updated for consistency, OR the acceptance bar at §3.4 should drop from 10 to 9.

**Fix:** edit the plan doc to align both sections on 4 Shopify slots.

### 14. `pnpm db:migrate` and `apps/mcp-server/migrations/` from the plan don't exist
**Where:** `FF_BRAND_STUDIO_V2_ITERATION_PLAN.md` §1.1 / §1.3.

Already documented in `V2_INVENTORY.md`. Real convention is `scripts/schema.sql` + `node scripts/setup-db.mjs` (or our v2-only `apply-v2-schema.mjs`). Update the plan doc.

---

## Summary

- 3 P0 issues — must fix before Phase 4 (variants without LoRA, worker error handling, adapter idempotency).
- 5 P1 issues — fix opportunistically (spec validation gaps, refinement_history default, category enum, upsert seed).
- 6 P2 issues — track for later phases or cosmetic.

Total v2 files touched in Phases 1–3: 11
- New: `V2_INVENTORY.md`, `V2_AUDIT.md`, `apps/mcp-server/src/tools/launch-product-sku.ts`, `apps/mcp-server/src/orchestrator/{planner,workers,launch_pipeline}.ts`, `apps/mcp-server/src/adapters/index.ts`, `scripts/{apply-v2-schema.mjs,test-phase3-pipeline.ts}`
- Modified: `scripts/schema.sql`, `apps/mcp-server/src/db/schema.ts`, `apps/mcp-server/src/tools/index.ts`, `packages/types/src/{tools,index}.ts`
- Gitignored (not committed): `.env`, `apps/mcp-server/.dev.vars`
