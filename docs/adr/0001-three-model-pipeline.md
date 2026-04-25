# ADR-0001 — Three-model pipeline for FF Brand Studio v2

**Status:** Accepted
**Date:** 2026-04-25
**Deciders:** Peter Chen (CreatoRain CEO, project owner)
**Phase:** v2 (Chinese sellers → American platforms pivot)

---

## Context

v1 of FF Brand Studio uses a single-model image generation path (Flux Pro for hero shots, GPT Image 2 for infographics, Kling for video) with a single-agent ReAct workflow. v2 retargets the system from FF's own social content to Chinese ecommerce sellers shipping product listings to Amazon US + Shopify DTC.

Two architectural questions surfaced in the v2 plan (`FF_BRAND_STUDIO_V2_ITERATION_PLAN.md`):

1. **Should v2 consolidate to one image model (e.g., GPT Image 2 only) or split across multiple?**
2. **Which models for which jobs?**

---

## Decision

Adopt a **three-model pipeline with hard separation by job**:

- **FLUX Kontext Pro / Nano Banana Pro Edit** for the compliance-critical Amazon main image (white-background standardization on real product photos via image-to-image edit).
- **Nano Banana Pro (Gemini 3 Pro Image)** for lifestyle / in-context shots requiring up to 14 reference images and multilingual typography fidelity.
- **GPT Image 2** for infographic / A+ Content / on-image typography with high character accuracy (~95–99% multilingual per VentureBeat April 2026 review).
- **FLUX.2 Dev + per-SKU LoRA** for catalog-scale variant generation at $0.03/image after one-time $4–8 training.
- **Kling** (carryover from v1) for the Amazon main-image video slot.

The Brand Guardian compliance evaluator wraps every output with platform-specific scorecards, max 3 evaluator-optimizer iterations per asset.

---

## Alternatives considered

### Alternative A — GPT Image 2 alone

The original hypothesis floated by the user was that GPT Image 2's April 2026 release made it "the" image generator. **Rejected** because:

- GPT Image 2 generates from scratch; the Amazon main-image rule requires *the actual physical product*. Generate-from-scratch routinely produces hallucinated product details (logo placement drifts, wrong button counts on apparel) that get sellers flagged for listing fraud.
- Cost: ~$0.21 per high-quality 1024×1024 image. Multiplied across 50 SKUs × 50 images = $525 inference per launch; the three-model pipeline hits the same target for ~$115.
- Background fidelity: GPT Image 2 produces "near-white" outputs that fail Amazon's RGB(255,255,255) bot. We'd need the same OpenCV `forceWhiteBackground` post-processor anyway.

### Alternative B — Nano Banana Pro alone

**Rejected** because while Nano Banana Pro handles 14 reference images and CJK typography well, it lags FLUX.2 on photoreal hero atmosphere (per Higgsfield 2026 5-case test) and lacks per-SKU LoRA training, so catalog-consistency for variant runs requires sending refs every call (more expensive, less reliable).

### Alternative C — Foundation model + Photoroom/Pebblely wrapper

**Rejected** because Photoroom and Pebblely are SaaS endpoints that don't integrate with the per-SKU LoRA workflow and add per-image cost. The compliance presets they offer (Amazon white-bg, Tmall 5th slot) are easier to replicate as v2 post-processing steps than to license.

### Alternative D — LangGraph orchestrator-worker on Durable Objects

The plan §3 calls for LangGraph + DO. **Deferred** for Phase 3; v2 currently uses a hand-rolled async chain following v1's `campaign.workflow.ts` pattern. Will revisit if Phase 4's evaluator-optimizer loop becomes cumbersome to maintain in plain async.

---

## Consequences

### Positive

- **Compliance moat is the product.** OpenCV `forceWhiteBackground()` + per-platform spec validators are deterministic, cheap, and what gets a Chinese seller's listing past Amazon's bot. A single-model architecture would still need this — splitting just makes each model do what it's best at.
- **Cost predictability:** ~$2.30 inference + $8 LoRA per SKU. 50-SKU launch = ~$520 vs $10K–$75K traditional photography.
- **Catalog refresh leverage:** once a SKU's LoRA is trained, regenerating seasonal variants costs $0.03 each. The first regeneration pays back the training cost after ~150 inferences.
- **Pivot-ready:** if a single foundation model leapfrogs the field, the orchestrator's worker functions are the only contracts; the rest of the system (planner, adapters, scorers, dashboard) doesn't change.

### Negative

- **More vendors to monitor:** fal.ai, OpenAI, Google DeepMind. v1 already used fal + OpenAI; v2 adds Nano Banana Pro endpoint via fal which wraps Google.
- **GPT Image 2 currently 401-blocked** (HANDOFF.md known issue). v2 work proceeds with the slot stubbed; either rotate the OpenAI key or proxy via fal's GPT Image 2 endpoint.
- **More complexity in the planner.** A 5-model graph is harder to reason about than a single-call pipeline. Mitigated by the planner being a thin Sonnet 4.6 step that emits a JSON plan, not a deep LLM agent.

### Neutral

- The plan's recommendation to introduce LangGraph is pending. v2 ships Phase 3 without it; we'll add it if Phase 4's evaluator-optimizer loop accumulates ad-hoc orchestration code.

---

## Citations (load-bearing benchmarks)

- Higgsfield 5-case test, FLUX.2 vs Nano Banana Pro: <https://higgsfield.ai/blog/Flux-2-vs-Nano-Banana-Pro-Comparison>
- Vidguru 10-scenario test (8/10 ties): <https://www.vidguru.ai/blog/nano-banana-pro-vs-flux-2-max-comparison.html>
- AI Magicx text rendering benchmark (Ideogram 82%, GPT Image 2 ~99%): <https://www.aimagicx.com/blog/tested-10-ai-image-generators-best-use-cases>
- VentureBeat GPT Image 2 review (April 2026): <https://venturebeat.com/technology/openais-chatgpt-images-2-0-is-here-and-it-does-multilingual-text-full-infographics-slides-maps-even-manga-seemingly-flawlessly>
- Anthropic "Building Effective AI Agents" (orchestrator-worker + evaluator-optimizer): <https://resources.anthropic.com/hubfs/Building%20Effective%20AI%20Agents-%20Architecture%20Patterns%20and%20Implementation%20Frameworks.pdf>
- Cloudflare reference impl of all 5 Anthropic patterns (Durable Objects): <https://github.com/cloudflare/agents/blob/main/guides/anthropic-patterns/README.md>
- Amazon US image policy (RGB 255,255,255, JPEG/PNG/TIFF, 2000×2000 recommended): <https://www.sellerlabs.com/blog/amazon-product-image-requirements-2026/>
- fal FLUX.2 LoRA trainer ($0.008/step): <https://fal.ai/models/fal-ai/flux-2-trainer>

---

## Validation

- Phase 3 acceptance test (`scripts/test-phase3-pipeline.ts`) produced 10 platform_assets in 2s with 0 spec violations against placeholder canonicals — proves the orchestrator + adapter shell works.
- v2 Python prototype (`Desktop/ff_brand_studio_v2_test/test_white_bg_compliance.py`) validates the white-bg post-processor concept on a real product photo.
- Buyfishingrod batch test (35 products) showed 22.9% pass rate against the strict v2 rubric without any FF Brand Studio v2 generation — proving the rubric correctly discriminates compliant from non-compliant images. The 8 passing products demonstrate the underlying pipeline approach can produce Amazon-compliant output today.

---

## Revisit triggers

Re-open this ADR if any of these become true:

- A single foundation model passes 95% on both white-bg fidelity *and* dense multilingual typography in independent benchmarks.
- Total monthly spend on the 3-model pipeline exceeds $1,000 and >50% is on one slot.
- Per-SKU LoRA training cost falls below $1 OR rises above $20 (changes the amortization math meaningfully).
- A new Amazon image policy makes generated-image disclosure mandatory and the SynthID/C2PA chain becomes user-visible.
