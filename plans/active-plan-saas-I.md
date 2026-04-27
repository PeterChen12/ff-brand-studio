# Phase I — Production-Quality Image Pipeline (detailed plan)

> Detailed plan for Phase I of the SaaS iteration. Depends on Phase G
> (auth + tenant column) being complete and on Phase H (billing) for
> the per-image charge to be live. Phase I is what makes the platform
> actually deserve the $0.50/image price tag.
>
> See `plans/saas-iteration-plan.md` for the broader sequence (G–M).

**Goal of Phase I**

Replace the current stubbed Phase 2 image generators in
`apps/mcp-server/src/orchestrator/launch_pipeline.ts` with the same
production-grade pipeline that ships images to buyfishingrod.com, but
**generalized to any agency catalog (rods, reels, handbags, watches,
shoes, drinkware, apparel, etc.)** and **scaled to multi-tenant**.

The buyfishingrod insight document outlined this 6-step pipeline:

```
Raw supplier image
  → Step 2: gpt-image-2 cleanup (text/watermark/halo removal)
  → Step 3: derive (kind-aware crops + adaptive padding)
  → Step 4: Nano Banana Pro dual-reference refine [studio, crop]
  → Step 5: CLIP triage @ 0.78 → Claude-Vision adjudication if below
  → Step 6: Iterate ≤3 with explicit geometry-correction prompts
  → Step 7: Frontend hover-zoom + native-res lightbox (Phase J)
```

By the end of Phase I, every launch produces a 7-view (or
platform-spec'd subset) image set that passes Amazon's main-image rule,
shows variety across slots, and has been vision-audited for product
identity. Cost target: ~$2.70/SKU raw COGS, ~$6.20 charged (Phase H
pricing applies).

---

## ADR-0003 — Image pipeline approach: hybrid-lite (TS-first)

### Decision

Run the orchestration + most image manipulation **inside the existing
TS Worker**, using `sharp` (already a workspace dep) for all crop /
composite / resize work. Keep an **optional Python sidecar** behind a
feature flag for operations sharp can't do well (sophisticated mask
post-processing, scipy-based corrections). Start without the sidecar
and add it only if the I1 spike proves sharp falls short.

### Context / alternatives considered

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **(A) Pure TS Worker + sharp** | Single language, edge-deployed, no extra ops, no cold-start, billing/audit/wallet already TS | sharp covers crop/composite/resize but no bbox detection or scipy ops; need creative workarounds for kind-aware crops | **Picked for MVP** |
| (B) External Python service (Modal Labs / Cloud Run) | 1:1 fidelity with the lykan_upload Python pipeline, full Pillow / scipy / numpy ecosystem | Cold-start (3–10s on Modal free tier), dual deploy, dual CI/CD, dual secret stores, extra failure mode | Hold in reserve |
| (C) Hybrid: TS orchestration + Python for one specific step | Each does what it's best at | Most complex; 2 services to operate; debugging crosses a network hop | Adopt only if A fails |

### Why this works without Python's scipy/Pillow

The lykan_upload pipeline's heavy Pillow lift is in:

- **Step 2 (cleanup):** an HTTP call to **gpt-image-2**. The Pillow part
  is just "post-process the API response" (which is already a clean PNG
  from OpenAI's side). sharp can do PNG re-encoding + size normalization.
- **Step 3 (derive):** percentage-based crops with adaptive padding.
  sharp's `extract` + `extend` + `resize` cover this exactly. The
  bbox detection that scipy does in lykan_upload is replaceable with:
  - assume gpt-image-2 cleanup produces a centered-on-white-bg subject
    (it does, by design)
  - kind-aware percentage crops then work without explicit bbox detection
  - if a specific SKU drifts off-center, fall back to a Claude vision
    bbox call ($0.005, async)
- **Step 4 (refine):** an HTTP call to **FAL Nano Banana Pro**. No
  Python needed.
- **Step 5 (CLIP triage):** **Cloudflare Workers AI** has
  `@cf/openai/clip-vit-base-patch16` available on the free tier from
  the same Worker. No Python.
- **Step 5 (vision adjudication):** an HTTP call to **Anthropic Opus
  4.7**. No Python.
- **Step 6 (iterate):** pure control flow.

### Consequences

- New Worker dependency: `sharp` confirmed already in
  `apps/mcp-server/package.json` (was added for Phase 2 white_bg work).
- New env / binding: Workers AI binding (`AI`) added to `wrangler.toml`
  — free tier, ample for CLIP triage volume.
- All image bytes flow through R2; the Worker reads + writes via
  `R2.get()` + `R2.put()`. Only the active step's bytes are in memory
  at a time.
- The Python `lykan_upload` codebase becomes a **reference document**,
  not a runtime dependency. The shape is what we're cloning.
- If the I1 spike shows sharp is insufficient (e.g. handbag reflection
  cleanup needs scipy), we add Modal Labs Python sidecar in I1.5.

### Migration / rollback

- Phase I lands behind a `tenant.features.production_pipeline` flag
  (default OFF). Existing tenants keep the stubbed pipeline until
  rolled forward one tenant at a time.
- Rollback: flip the flag off; orchestrator falls back to the existing
  Phase 2 stubs. No data loss (platform_assets rows from the production
  pipeline can coexist with stubs, distinguishable by `model_used`).

---

## Iteration I1 — Pipeline scaffolding + research spike

**Outcome:** a runnable end-to-end TS pipeline on 3 reference SKUs (rod,
drinkware, handbag) that produces visibly higher-quality output than
the current stubs. Costs + latency measured. ADR-0003 finalized with
real numbers; Python sidecar decision (yes/no) made.

### I1.1 — Pipeline module skeleton

**Files / new files:**
- `apps/mcp-server/src/pipeline/cleanup.ts` — Step 2 (gpt-image-2)
- `apps/mcp-server/src/pipeline/derive.ts` — Step 3 (kind-aware crops)
- `apps/mcp-server/src/pipeline/refine.ts` — Step 4 (Nano Banana Pro)
- `apps/mcp-server/src/pipeline/triage.ts` — Step 5a (CLIP via
  Workers AI)
- `apps/mcp-server/src/pipeline/audit.ts` — Step 5b (Claude vision
  adjudicator)
- `apps/mcp-server/src/pipeline/iterate.ts` — Step 6 (control flow)
- `apps/mcp-server/src/pipeline/index.ts` — orchestrator that composes
  the 6 steps + writes platform_assets rows
- `apps/mcp-server/src/pipeline/types.ts` — shared types: `PipelineCtx`,
  `StepResult`, `RefineSpec`, `Verdict`, etc.

**Subtasks:**
1. Define the data flow: each step takes `{ ctx, inputR2Key }` and
   returns `{ outputR2Key, costCents, metadata, status }`.
2. Each step is independently testable (vitest mocks for HTTP calls).
3. Composer in `index.ts` handles wallet billing per step + audit
   events + retries (≤3 per step) + step-level cost cap.
4. Error model: `PipelineError` discriminated union covers
   `provider_error | quota_exceeded | identity_mismatch | wallet_capped`.

### I1.2 — Cleanup step (gpt-image-2)

**Resources:**
- OpenAI gpt-image-2 API — text/watermark/halo cleanup
- Cost: ~$0.06/img medium quality
- Don't use `input_fidelity` parameter — that's gpt-image-1 only,
  per the production "what doesn't work" notes

**Subtasks:**
1. HTTP call: `POST https://api.openai.com/v1/images/edits`
   with the supplier reference, prompt:
   `"Remove all text, logos, watermarks, supplier dimension labels, and
   white-background haloes. Center the product on a pure white #FFFFFF
   seamless background. Maintain exact product geometry — no
   re-shaping, no re-coloring, no added details."`
2. Quality `medium`, size matches input.
3. Read output → write to R2 at `tenant/<tid>/pipeline/<run>/cleanup.png`.
4. Return `{ key, costCents: 6 }`.
5. 30s timeout with retry-once on transient 5xx.

### I1.3 — Derive step (kind-aware crops)

**Resources:**
- `sharp` for crop/extract operations (already in package.json)
- `apps/mcp-server/src/pipeline/derivers/` — one file per kind

**Subtasks:**
1. `derivers/index.ts` — `DERIVERS: Record<Kind, Deriver>`. Each Deriver
   has: `paddingPct`, `crops: { name: string; bbox: BBoxFn }[]`,
   `keyFeatures: string[]`, `negativePrompts: string[]`.
2. Implement 8 kinds (porting lykan_upload's strategies + generalized):

| Kind | Aspect | Padding | Crops |
|---|---|---|---|
| `long_thin_vertical` | <0.5 | 94% height-fill | top% / mid% / bottom% of vertical bbox |
| `long_thin_horizontal` | >2.0 | 94% width-fill | left% / mid% / right% of horizontal bbox |
| `compact_square` | ~1.0 | 92% fill | left half / right half / middle band |
| `compact_round` | ~1.0 | 92% fill | top arc / bottom arc / center |
| `horizontal_thin` | 1.5–2.0 | 94% fill | left% / mid% / right% |
| `multi_component` | varies | 92% fill | component A zoom / component B zoom / both |
| `apparel_flat` | ~1.2 | 92% fill | full / collar zoom / hem zoom |
| `accessory_small` | ~1.0 | 90% fill | side profile / 3⁄4 angle / detail |

3. Each Deriver runs on the cleanup output: extracts the canonical
   1:1 white-bg studio shot + N detail crops (typically 3 per kind).
4. Outputs: `derive_studio.png` + `derive_crop_A.png`, `_B.png`, `_C.png`.

### I1.4 — Refine step (FAL Nano Banana Pro)

**Resources:**
- FAL endpoint: `fal-ai/gemini-3-pro-image-preview/edit`
- Cost: $0.30/call, accepts up to 14 reference images
- Production rule: **always pass [studio, crop] not just [studio]**

**Subtasks:**
1. For each crop produced by I1.3, fire one FAL refine call:
   - References: `[derive_studio.png, derive_crop_X.png]`
   - Prompt: kind-specific template (from `DERIVERS[kind].refinePrompt`)
   - Output: `refine_X.png` written to R2
2. Parallelize: 3 crops × 1 call each = 3 concurrent FAL calls.
   Bound concurrency to 4 (respect FAL rate limits; production note
   said `getaddrinfo` failures appear after ~45min continuous calls
   so we add retry-with-cache).
3. Cost track: 3 × 30c = 90c per SKU per refine round.

### I1.5 — Optional Python sidecar (deferred decision)

**Trigger:** I1 spike output shows sharp can't reliably handle one of
the production tasks (e.g. mask post-processing, dynamic bbox
detection). Run the spike first; defer this iteration if sharp suffices.

**If needed:**
- Containerize `lykan_upload/derive_v2.py` + minimal Pillow / numpy
  dependencies into a Modal Labs function or Cloud Run container.
- Worker calls via `POST <sidecar>/derive` with R2 key, gets back R2
  key. Auth via shared HMAC secret.
- Cost: ~$30/mo Modal flat + $0.0001/call. Negligible at MVP volume.

### I1.6 — Spike acceptance

- 3 reference SKUs (rod, drinkware, handbag — one per kind family)
  run end-to-end through Steps 2→4 in <90s wall-time per SKU.
- Output images visibly cleaner + on-brand vs the supplier originals.
- Cost per SKU recorded in `audit_events`: matches ±10% of the COGS
  estimate in ADR-0005.
- ADR-0003 updated with real numbers; sidecar decision committed.

---

## Iteration I2 — Object-kind dispatch generalized

**Outcome:** product creation form lets the agency pick from 8 kinds;
pipeline reads `product.kind` and dispatches to the matching Deriver +
prompt template; all 8 kinds tested on at least one sample SKU.

### I2.1 — Schema + form changes

**Files:**
- `apps/mcp-server/src/db/schema.ts` — add `kind text NOT NULL` to
  `products`, default `'compact_square'`. Drizzle migration.
- `packages/types/src/tools.ts` — add `Kind` enum to `ProductCategory`
  schema (or new `Kind` schema).
- `apps/dashboard/src/components/product-upload-form.tsx` (Phase H1) —
  add the "Object kind" select with auto-suggest from category.

**Auto-suggest mapping:**

| Category | Default kind |
|---|---|
| `apparel` | `apparel_flat` |
| `drinkware` | `compact_square` |
| `tech-acc` | `compact_square` |
| `bag` | `compact_square` |
| `hat` | `compact_round` |
| `other` | (no default — user must pick) |

User can always override.

### I2.2 — Deriver prompts per kind

**Files:** `apps/mcp-server/src/pipeline/derivers/*.ts`

**Subtasks:**
1. Each kind file exports a `Deriver` with a `refinePrompt(args)` fn
   that emits the dual-reference prompt for FAL.
2. Per-kind prompt templates emphasize the geometry + key features of
   that kind. Example for `compact_square` (handbag):
   ```
   Studio product photograph of a [productName].
   Match the framing of the second reference (the crop oracle).
   Match the identity of the first reference (the studio source).
   Key features to preserve exactly:
     - hardware metal color and shape
     - stitch pattern visible on the seams
     - leather grain texture
     - strap attachment hardware
   ABSOLUTELY NO:
     - re-shaping the bag silhouette
     - re-coloring the leather
     - inventing logo / monogram patterns
   Pure white seamless background (#FFFFFF). No shadow, no gradient.
   No text, no logos, no dimension labels.
   ```
3. Prompts follow the production rule: be specific about geometry,
   never use vague styling words like "premium" or "luxury".

### I2.3 — Negative-example tests

**Files:** `apps/mcp-server/src/pipeline/derivers/*.test.ts` (vitest)

**Subtasks:**
1. For each kind, snapshot test: given the input SKU + reference image,
   the prompt string should match the snapshot. Catches drift in
   prompt engineering.
2. End-to-end smoke (mocked FAL): confirm the right Deriver is selected
   for each kind.

### I2.4 — Acceptance for I2

- Product create form has a kind dropdown that defaults sanely.
- A handbag SKU runs through the pipeline and produces images that
  preserve the bag silhouette + hardware (visual review on 3 sample
  bags).
- A rod SKU still works (regression — the existing fishing-rod outputs
  should not get worse).

---

## Iteration I3 — CLIP triage + Claude-Vision adjudication

**Outcome:** every refined image is auto-checked. ~90% pass cheap CLIP
triage at iter 1 (per the production calibration); only the ~10%
suspect ones burn $0.02 vision calls. Identity drift caught before the
asset reaches the library.

### I3.1 — CLIP triage via Workers AI

**Resources:**
- Cloudflare Workers AI binding (`AI`)
- Model: `@cf/openai/clip-vit-base-patch16` (free tier, ample budget
  for our triage volume)
- Compares cosine similarity of two image embeddings

**Subtasks:**
1. Add `AI` binding to `wrangler.toml`:
   ```toml
   [ai]
   binding = "AI"
   ```
2. `pipeline/triage.ts`:
   ```ts
   async function clipSimilarity(a: ArrayBuffer, b: ArrayBuffer, env): Promise<number>
   ```
   - Embed each image via Workers AI
   - Cosine similarity of the two 512-d vectors
   - Returns 0..1
3. Decision: `score >= 0.78` → `'pass'`; below → escalate to vision.
4. Per the production calibration, 0.78 is the right threshold; we
   can tune per kind in a `DERIVERS[kind].clipThreshold` override.

### I3.2 — Vision adjudication via Opus 4.7

**Resources:**
- Anthropic Opus 4.7 with vision input (already configured for Phase 4
  evaluator-optimizer)
- Cost: ~$0.02/call (1024×1024 image ≈ 1500 input tokens + small output)

**Subtasks:**
1. `pipeline/audit.ts`:
   ```ts
   async function visionVerdict(reference: ImageData, generated: ImageData, kind: Kind, env): Promise<{verdict: 'pass' | 'fail'; reasons: string[]}>
   ```
   - Two images attached
   - Prompt: kind-specific checklist (per `DERIVERS[kind].visionChecklist`)
   - JSON-formatted return
2. Reasons feed back into iterate (Step 6) as the next-iteration prompt
   amendment.
3. Cap to 1 vision call per crop per launch (no recursive vision audit
   of the audit).

### I3.3 — Iterate loop with explicit geometry-correction prompts

**Resources:** existing `evaluator_optimizer.ts` is the precedent.

**Subtasks:**
1. `pipeline/iterate.ts`:
   ```ts
   async function refineWithIteration(ctx, crop, derivers, env): Promise<RefinedAsset>
   ```
   - Iter 1: standard refine prompt
   - If CLIP < 0.78: vision adjudicate
     - If vision says fail: iter 2 with prompt amended by vision reasons
     - If vision says pass: ship despite low CLIP (false negative bias)
   - If iter 2 still fails: iter 3 with explicit geometry-correction
     prompt (from production "iteration prompts" in lykan_upload)
   - After iter 3: ship the best-rated; flag asset `status='fair'` for
     HITL review (Phase K)
2. Wallet-aware: each iter is debited; halt if next iter would exceed
   per-launch cap.

### I3.4 — Acceptance for I3

- 100 sample images across 8 kinds: ≥90% pass at iter 1, ≥98% by iter
  3; 0 obviously-wrong images shipped without HITL flag.
- Cost ledger shows correct per-step charges.
- Vision audit prompts include the kind-specific checklist.

---

## Iteration I4 — Text-overlay "detail" composite slot

**Outcome:** for every SKU, a "detail" slot is generated that overlays
3 spec strings on top of a product hero shot. Replaces Amazon
A+ feature-1/2/3 slots with infographic-style text composites.

### I4.1 — Composite generator

**Files / new files:**
- `apps/mcp-server/src/pipeline/composite.ts` — text-on-image
  compositor using sharp's SVG overlay

**Resources:**
- `sharp` SVG composite — overlay arbitrary SVG on an image
- Brand fonts via R2-hosted woff2: Fraunces (display), Geist (body)

**Subtasks:**
1. Function: `compositeDetailImage({ background, specs[], colors, brand })`
   - `background`: R2 key of the cleaned product photo (1:1 from Step 2)
   - `specs[]`: 3 short strings (≤30 chars each), e.g.
     `["12 ft length", "4-piece collapsible", "285 g weight"]`
   - `colors`: brand palette pulled from `tenant.brand_voice`
   - Returns: composited PNG → written to R2
2. Layout: spec strings centered on either side of the product; serif
   for prominent claim, mono for spec values; FF watermark in the
   bottom-right corner at 8% opacity.
3. Generated as 2000×2000 1:1 (Amazon-compliant).

### I4.2 — Spec extraction from product metadata

**Files:** `apps/mcp-server/src/pipeline/specs.ts`

**Subtasks:**
1. `extractSpecs(product)` — pulls 3 most-prominent specs from
   `product.dimensions` + `product.materials`. Falls back to a Sonnet
   call if the metadata is sparse:
   `"Given product name '{name}' and category '{category}', generate 3
   short marketing-friendly specs (≤30 chars each) that emphasize
   tangible product features. Return JSON array."`
2. Operator can override on the launch wizard or product detail page.

### I4.3 — Wire into slot generation

**Subtasks:**
1. Planner (`planner.ts`) emits a `detail_composite` slot kind
   alongside the existing `white_bg` and `lifestyle` kinds.
2. Adapters route the composite output to the right platform slots:
   - Amazon: `a_plus_feature_1`, `_2`, `_3` (3 different spec
     compositions, same product hero)
   - Shopify: `detail`

### I4.4 — Acceptance for I4

- Full launch produces 3 distinct detail-composite images (different
  specs each) — not the same composite reused.
- Specs match `product.dimensions` / `product.materials`.
- 1:1 aspect, ≥1600×1600, WCAG AA contrast on overlay text.
- Operator can override the spec strings before launch.

---

## Iteration I5 — Slot generation matrix per platform

**Outcome:** every launch produces a per-platform slot set that aligns
with marketplace requirements. No more single-canonical-reused-everywhere.

### I5.1 — Slot definitions (drop the slots we can't produce)

Per the locked decision: skip packaging + scale photo (we don't have
real-world reference for either). Use composites where Amazon expects
infographics.

**Amazon US — 7 image slots:**

| Slot | Source | Notes |
|---|---|---|
| `main` | refine_studio | white-bg, ≥85% fill, no text, 2000×2000 |
| `lifestyle` | new lifestyle render | text-free in-use scene (Nano Banana with FAL "lifestyle" prompt) |
| `a_plus_feature_1` | composite_detail_1 | spec text overlay |
| `a_plus_feature_2` | composite_detail_2 | different spec text |
| `a_plus_feature_3_grid` | composite_detail_3 | different spec text |
| `close_up` | derive_crop_C | from kind-specific crop |
| `comparison_grid` | composite_grid | (optional) 2x2 grid of crops with feature labels — produced if `tenant.features.amazon_a_plus_grid` |

**Shopify DTC — 5 image slots:**

| Slot | Source | Notes |
|---|---|---|
| `main` | refine_studio | same as Amazon main |
| `lifestyle` | new lifestyle render | same content as Amazon |
| `detail` | composite_detail_1 | one composite for the gallery |
| `close_up` | derive_crop_B | different crop than Amazon close |
| `banner` | wide_crop | 16:9 hero (uses sharp to extend the studio shot with brand-color matched gradient) |

### I5.2 — Planner update

**Files:** `apps/mcp-server/src/orchestrator/planner.ts`

**Subtasks:**
1. New `planSkuLaunch` signature accepts `tenant.features` and the new
   slot matrix.
2. Emits `adapter_targets` reflecting the matrix — 7 Amazon + 5 Shopify
   = 12 slots per SKU launch (or subsets if the tenant unchecked
   marketplaces).
3. Each `adapter_target` carries the `source` field (`refine_studio` |
   `composite_detail_N` | etc.) so adapters know which generated asset
   to attach.

### I5.3 — Adapter rewrites

**Files:** `apps/mcp-server/src/adapters/index.ts`,
`apps/mcp-server/src/adapters/amazon.ts`,
`apps/mcp-server/src/adapters/shopify.ts`

**Subtasks:**
1. Drop `pickCanonicalForSlot()` — the single-canonical pattern is gone.
2. Each adapter takes the planned `adapter_targets` and writes one
   `platform_assets` row per target, looking up the matching asset
   from `pipeline.outputs[target.source]`.
3. Per-platform spec validation runs against each output (existing
   `score_amazon_compliance` + `score_shopify_compliance` tools).

### I5.4 — Lifestyle render step (new in I5)

**Files:** `apps/mcp-server/src/pipeline/lifestyle.ts`

**Subtasks:**
1. Independent FAL call: input = clean studio shot + a kind-specific
   lifestyle prompt template.
2. Per-kind lifestyle prompt examples:
   - `long_thin_vertical` (rod): "the rod held by an angler at sunrise
     on a quiet lake, soft natural light, no text, no overlays"
   - `compact_square` (handbag): "the bag styled on a marble surface
     with simple coffee accessories, daylight, no text"
   - `apparel_flat` (t-shirt): "the shirt worn by a model in a clean
     studio environment, no other branded items visible"
3. Cost: $0.30/call (one per launch — single lifestyle reused across
   Amazon + Shopify).

### I5.5 — Per-platform spec validation pass

**Subtasks:**
1. After all assets land, run platform-specific compliance scoring
   (`score_amazon_compliance` requires the main image to have a true
   white background — we already validate this in `evaluator_optimizer`).
2. If any asset fails, mark `platform_assets.compliance_score = 'POOR'`
   and the launch goes to HITL review (Phase K).

### I5.6 — Acceptance for I5

- Single launch on a fishing-rod SKU produces 12 distinct R2 keys
  across 7 Amazon + 5 Shopify slots (no two slots return the same URL).
- Amazon main image passes the white-background spec check.
- Lifestyle slot is text-free, on-brand, kind-appropriate.
- A handbag launch produces visually coherent main + lifestyle +
  composites (visual review on 3 sample handbags).

---

## Cross-cutting Phase I concerns

### Cost ceilings (per-launch, per-step, per-tenant)

| Layer | Cap | Behavior on hit |
|---|---|---|
| Per-step retry (transient 5xx) | 3 retries with exponential backoff | Continue or fail step |
| Per-crop iteration (CLIP/vision) | 3 iters | Ship best, mark FAIR for HITL |
| Per-launch cost cap | `tenant.max_per_launch_cents` (default $10) | Halt remaining adapters; refund unused predicted cost |
| Per-tenant daily cost cap | `tenant.max_daily_cents` (default $200) | Reject new launches with `429 daily_cap_exceeded` |
| Workers AI quota | CF free tier ~10K calls/day | Switch CLIP triage to Replicate ($0.0006/call) when exceeded |

### Observability

- Every step emits a Langfuse trace span with input + output R2 keys,
  cost, duration, model used.
- Failures emit `audit_events` row + Sentry breadcrumb.
- Cost-per-SKU dashboard: hourly summary written to `costs_summary`
  table for the / Overview KPI ribbon.

### Caching

- Workers AI CLIP embeddings cached in R2 keyed by content hash
  (sha256 of bytes). Saves repeated triage for the same input across
  iterations.
- gpt-image-2 cleanup output cached in R2 keyed by reference image hash
  + prompt hash. Re-run launches reuse the cleanup result.
- Nano Banana Pro outputs not cached (generative, deterministic input
  is rare — different prompt amendments per iter).

### Frontend impact

Phase I changes the platform_assets table content but not its shape.
The dashboard library + launch wizard already render whatever assets
the orchestrator writes. The only frontend change is **hover-zoom +
native-resolution lightbox** (per the production "Step 7"), which is
Phase J's J1 iteration — listed there, not duplicated here.

### Estimated effort

| Iteration | Engineer-days |
|---|---|
| I1 (scaffolding + spike) | 5 |
| I1.5 (Python sidecar, only if needed) | +3 |
| I2 (kind dispatch generalized) | 3 |
| I3 (CLIP triage + vision adjudication) | 3 |
| I4 (text composite) | 2 |
| I5 (slot matrix + adapters) | 3 |
| Buffer (provider quirks, FAL rate limits, prompt iteration) | 3 |
| **Total** | **~19 days** (~5 weeks at half-time) |

This is the most quality-sensitive iteration in the plan. The 19-day
estimate assumes only minor prompt-tuning surprises; allow up to 50%
slip for the inevitable "this kind needs its own special handling".

---

## Resolved questions (locked 2026-04-27)

1. **Pipeline approach.** **Hybrid-lite (TS-first + sharp).** Python
   sidecar deferred unless the I1 spike proves it necessary.
2. **Object kinds.** **8 kinds at MVP** (rod / reel / horizontal-thin /
   compact-square / compact-round / multi-component / apparel-flat /
   accessory-small). New kinds added on demand, requires a new
   Deriver + prompt template + smoke SKU.
3. **CLIP threshold.** **0.78** as the default (per production
   calibration), per-kind override via `DERIVERS[kind].clipThreshold`.
4. **Vision adjudicator.** **Opus 4.7** for the audit step. Cost
   $0.02/call is acceptable given the ~10% escalation rate.
5. **Lifestyle slot.** **One lifestyle render per launch**, reused
   across Amazon + Shopify. Future: per-platform-specific lifestyle if
   conversion data shows it matters.
6. **Detail composite count.** **Three** spec composites per SKU
   (covers Amazon a_plus_feature_1/2/3 + Shopify detail). Operator can
   override the specs.
7. **Production-pipeline rollout.** **Feature-flag gated**
   (`tenant.features.production_pipeline`). New tenants OFF by default;
   opt-in tenant-by-tenant for the first 2 weeks; default-on once we
   see <5% FAIR rate over 200 launches.
8. **Worker AI vs Replicate for CLIP.** **Workers AI** by default
   (free tier sufficient + same-Worker latency); fall back to
   Replicate only on quota exhaustion.

---

## Deliverables checklist

When Phase I is done:

- [ ] ADR-0003 committed with real cost/latency numbers from the spike
- [ ] `apps/mcp-server/src/pipeline/` modules: cleanup, derive, refine,
      triage, audit, iterate, composite, lifestyle, index
- [ ] 8 kind Derivers with kind-specific prompts + crop strategies
- [ ] Workers AI binding wired in `wrangler.toml`
- [ ] CLIP triage threshold tunable per kind
- [ ] Vision adjudication uses Opus 4.7 with structured JSON output
- [ ] Iterate loop caps at 3 iters per crop, falls back to HITL flag
- [ ] Text composite generator produces Amazon-compliant 2000² PNGs
- [ ] Slot matrix: 7 Amazon + 5 Shopify slots per launch, 0 dupes
- [ ] Per-step + per-launch cost gating; refund-on-cap path verified
- [ ] Langfuse traces emit per step
- [ ] R2 cache layer for cleanup outputs + CLIP embeddings
- [ ] Feature flag `tenant.features.production_pipeline` switches
      between stub and production pipeline
- [ ] 3 sample SKUs (rod / drinkware / handbag) launch end-to-end and
      pass visual review
- [ ] FAIR rate on the 3 samples ≤ 10%
- [ ] `SESSION_STATE.md` updated with the new pipeline shape + ADR-0003

When all are checked, the platform produces images that justify the
$0.50/image charge. Phase J (library SaaS features) becomes the next
priority to make those images discoverable + downloadable.
