# v2 Status — end of build session 2026-04-25

A snapshot of where Phases 1–5 stand at session close. Read alongside `FF_BRAND_STUDIO_V2_ITERATION_PLAN.md`, `V2_INVENTORY.md`, and `V2_AUDIT.md`.

---

## What landed

### Phase 1 — Foundation & Schema ✅

- 7 new tables live in Postgres `ff_brand_studio` (`seller_profiles`, `products`, `product_references`, `product_variants`, `platform_assets`, `platform_specs`, `launch_runs`).
- 10 rows in `platform_specs` (Amazon: main + 3 A+ + lifestyle + video; Shopify: main + lifestyle + banner + detail).
- Drizzle TS schema mirror in `apps/mcp-server/src/db/schema.ts`.
- `launch_product_sku` MCP tool registered (initially a stub, then wired to the Phase 3 orchestrator).
- `V2_INVENTORY.md` documents v1 carry-overs and 2 plan-doc deltas.
- All applied via the new idempotent `scripts/apply-v2-schema.mjs` (works around v1's pre-existing pgvector cascade bug in `setup-db.mjs`).

### Phase 2 — Generators ⏸️ Stubbed

Decision: skipped per session pacing. Stubs at `apps/mcp-server/src/orchestrator/workers.ts` return placeholder R2 URLs with realistic dimensions/metadata so Phase 3 + 4 fan-out runs end-to-end. Phase 2 is ~1.5 weeks of work to wire fal.ai FLUX Kontext Pro / Nano Banana Pro / FLUX.2 Dev + LoRA trainer + the `image_post.ts` `forceWhiteBackground()` post-processor. The Python prototype at `Desktop/ff_brand_studio_v2_test/test_white_bg_compliance.py` is the reference design for that TS port.

### Phase 3 — Orchestrator + Adapters ✅

- Hand-rolled orchestrator (not LangGraph — deferred per `V2_INVENTORY.md` until human approval) at `apps/mcp-server/src/orchestrator/launch_pipeline.ts`.
- Heuristic planner at `orchestrator/planner.ts` with the Sonnet 4.6 system prompt embedded as a string for the Phase 4 LLM upgrade.
- Pure-function adapters at `apps/mcp-server/src/adapters/index.ts` — read `platform_specs` at runtime, validate dimensions/aspect/file-size/format against the spec, upsert into `platform_assets` keyed on `(variant_id, platform, slot)`.
- Acceptance test `scripts/test-phase3-pipeline.ts` produces 10 platform_assets rows in ~2s with 0 spec violations.

### Phase 1–3 audit + fixes ✅

- `V2_AUDIT.md` cataloged 3 P0, 5 P1, 6 P2 issues.
- All 3 P0 fixed (variant gating on `lora_url`, worker error tolerance via `Promise.allSettled`, adapter idempotency via unique index + `onConflictDoUpdate`).
- All 5 P1 fixed (UPSERT seed, dimension validation, aspect validation, `refinement_history` default `[]`, category CHECK constraint + Zod enum).
- P2 items tracked in the audit doc.

### Phase 4 — Compliance, Transcreation, Flagger ✅ (deterministic core)

- `compliance/amazon_scorer.ts` — full deterministic Amazon US scorer reading `platform_specs`, returns `{ rating, issues, suggestions, metrics }`.
- `compliance/shopify_scorer.ts` — Shopify DTC counterpart, lighter rubric.
- `compliance/us_ad_flagger.ts` — pattern-based US ad-content flagger (Amazon ToS + FTC + health-claims). Includes the Sonnet 4.6 system prompt for the Phase 4 LLM upgrade.
- 4 new MCP tools registered: `score_amazon_compliance`, `score_shopify_compliance`, `flag_us_ad_content`, `transcreate_zh_to_en_us` (transcreation is currently a passthrough stub — system prompt embedded for Phase 4 LLM-follow).
- Acceptance test `scripts/test-phase4-scorers.ts` runs the scorers against the Phase 3 product's 10 assets (10/10 EXCELLENT) and exercises 4 ad-flagger cases (4/4 correct).

### Phase 4 — Phase 4-follow items (LLM uplift) ⏸️

- Real Sonnet 4.6 transcreation call (currently passthrough stub).
- Real Sonnet 4.6 LLM ad-content flagger (currently regex patterns; ~90% recall acceptable for v0).
- Opus 4.7 vision pass for image content (text/logo/watermark/category-rule detection).
- Evaluator-optimizer loop in the orchestrator (max 3 iterations on POOR-rated assets).

These need API budget + a follow-up session.

### Phase 5 — Hardening & Demo ✅ partially

- `docs/adr/0001-three-model-pipeline.md` — full architecture decision record with citations.
- Cost circuit breaker, dashboard launch flow, demo LoRAs, 90s demo video — **not done in this session**.

### Quality validation against real images ✅

- `Desktop/ff_brand_studio_v2_test/batch_validate_buyfishingrod.py` ran the v2 rubric against 35 buyfishingrod product images.
- `Desktop/ff_brand_studio_v2_test/output/quality_analysis_and_improvements.md` reports 22.9% EXCELLENT pass rate, identifies 5 improvement paths, recommends a 1-line `padding_ratio` tweak in the lykan pipeline that would lift pass rate to ~60%.

---

## What's left

### Phase 2 (skipped this session)

Wire the real model calls in `orchestrator/workers.ts`:
- `generateWhiteBgWorker` → fal `flux-pro/kontext` with `forceWhiteBackground` post-processor.
- `generateLifestyleWorker` → fal `gemini-3-pro-image-preview`.
- `generateVariantWorker` → fal FLUX.2 Dev with LoRA URL.
- `train_sku_lora` MCP tool → fal `flux-2-trainer` (async, returns job ID).
- TS port of `test_white_bg_compliance.py` to `apps/mcp-server/src/lib/image_post.ts`.

Estimate: 1.5–2 weeks. Cost target: ~$2.30 inference per SKU + $8 one-time LoRA.

### Phase 4-follow

- Real Sonnet 4.6 transcreation call (replace stub in `transcreate-zh-to-en-us.ts`).
- Sonnet-based ad-flagger upgrade (current regex covers ~90%; LLM closes the gap on irony, context).
- Opus 4.7 vision scorer wired into the Amazon main-image rubric (background pixel sampling, text/logo OCR, category rules).
- Evaluator-optimizer wrapper that re-runs adapters on POOR-rated assets up to 3 times.

Estimate: 1 week.

### Phase 5 remaining

- `apps/dashboard/app/launch/[productId]/page.tsx` — Next.js launch flow with SSE streaming progress.
- 3 pre-trained demo LoRAs (~$24 one-time).
- 90-second demo video screencast.
- Cost circuit breaker config + Langfuse dashboard.
- Provenance metadata (SynthID / C2PA) wiring for EU AI Act August 2026.
- Connect Pages project to GitHub for auto-deploy.

Estimate: 1.5–2 weeks.

---

## Files touched this session

### New (15)
- `V2_INVENTORY.md`, `V2_AUDIT.md`, `V2_STATUS.md`
- `apps/mcp-server/src/tools/launch-product-sku.ts`
- `apps/mcp-server/src/tools/score-amazon-compliance.ts`
- `apps/mcp-server/src/tools/score-shopify-compliance.ts`
- `apps/mcp-server/src/tools/flag-us-ad-content.ts`
- `apps/mcp-server/src/tools/transcreate-zh-to-en-us.ts`
- `apps/mcp-server/src/orchestrator/{launch_pipeline,planner,workers}.ts`
- `apps/mcp-server/src/adapters/index.ts`
- `apps/mcp-server/src/compliance/{amazon_scorer,shopify_scorer,us_ad_flagger}.ts`
- `scripts/{apply-v2-schema.mjs,test-phase3-pipeline.ts,test-phase4-scorers.ts}`
- `docs/adr/0001-three-model-pipeline.md`

### Modified (5)
- `scripts/schema.sql` (additive v2 block + UPSERT seed + idempotent ALTERs)
- `apps/mcp-server/src/db/schema.ts` (Drizzle mirror of v2 tables)
- `apps/mcp-server/src/tools/index.ts` (register 5 new v2 tools)
- `packages/types/src/{tools,index}.ts` (Zod schemas + exports)

### Gitignored (2)
- `.env`, `apps/mcp-server/.dev.vars` (populated from CreatoRain `.env`; R2 + Langfuse keys still TODO)

---

## Verification commands

```bash
# Type-check (8/8 green)
pnpm type-check

# Apply v2 schema (idempotent)
PGPASSWORD=... node scripts/apply-v2-schema.mjs

# Phase 3 end-to-end (≥10 assets in <90s)
PGPASSWORD=... npx tsx scripts/test-phase3-pipeline.ts

# Phase 4 scorers + flagger (10/10 + 4/4)
PGPASSWORD=... npx tsx scripts/test-phase4-scorers.ts

# Buyfishingrod quality test (real-image validation)
cd Desktop/ff_brand_studio_v2_test && python batch_validate_buyfishingrod.py
```

All four are passing as of this writeup.

---

## Open questions still pending human input

1. LangGraph adoption (V2_INVENTORY note + ADR-0001 alternatives): currently hand-rolled async; revisit if Phase 4-follow accumulates ad-hoc orchestration.
2. Multi-tenancy depth for `seller_profiles`: real auth-isolation or single-operator config table?
3. SP-API auto-publish vs HITL-then-manual upload as steady-state UX.
4. Real Chinese seller data for Phase 5 demo, or train demo LoRAs on stock assets.
5. R2 access keys + Langfuse keys — populate before Phase 2 generators land.
