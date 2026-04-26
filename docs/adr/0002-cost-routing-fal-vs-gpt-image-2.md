# ADR-0002 — Cost-effectiveness routing: fal.ai vs GPT Image 2

**Status:** Accepted
**Date:** 2026-04-25
**Supersedes:** parts of ADR-0001 §"Three-model pipeline" — refines the cost-side reasoning with verified pricing.
**Trigger:** OpenAI project key (validated against `/v1/models` 2026-04-25 with confirmed `gpt-image-2` / `gpt-image-1.5` / `dall-e-3` access) makes GPT Image 2 viable in production. Prior plan assumed it was 401-blocked. User directive: "save budget for fal.ai" — favor GPT Image 2 where it's competitive.

---

## TL;DR

The three-model routing in ADR-0001 stays. **GPT Image 2 is primary only where its strengths matter** (multilingual text + layout reasoning); fal.ai stays primary for everything else (it's cheaper for photo generation and is the only path for white-bg edits + per-SKU LoRAs). Switching photo workloads from fal to OpenAI to "save fal budget" would cost more total — fal is the cheaper provider for photo generation. Real fal-budget savings come from the Batch API discount, not from re-routing to OpenAI.

---

## Verified per-image pricing (2026-04-25)

| Model | Resolution / mode | Per-image USD | Source |
|---|---|---|---|
| GPT Image 2 | 1024×1024, high quality | **$0.211** | the-decoder Apr 2026 |
| GPT Image 2 | 1024×1536, high (portrait) | **$0.165** | the-decoder Apr 2026 |
| GPT Image 1 / 1.5 | smaller, lower-quality fallback | ~$0.04–0.08 | OpenAI pricing page |
| Nano Banana Pro (Gemini 3 Pro Image) | 1K/2K, official | **$0.134** | Google AI Studio pricing |
| Nano Banana Pro | 4K | $0.24 | Google AI Studio pricing |
| Nano Banana Pro | Batch API (async, -50%) | **$0.067** | aifreeapi.com cited in iter plan |
| Nano Banana Pro Edit | 2 refs | $0.15 | fal pricing page |
| FLUX Kontext Pro (edit) | 2K | **~$0.04** | fal pricing page |
| FLUX.2 Pro | 2K | **$0.03–0.08** | fal pricing page |
| FLUX.2 Dev | 2K | ~$0.03 | fal pricing page |
| FLUX.2 Dev + LoRA inference | 2K | ~$0.03 | fal pricing page |
| FLUX.2 LoRA training | one-time per SKU | $0.008/step → $4–8 | fal trainer page |
| Kling video | 15-30s 1080p | ~$0.35 | fal/Kling pricing |

Anthropic Sonnet 4.6 (transcreation, ad-flagger) and Opus 4.7 vision are separate budget; covered by ADR-0001.

---

## Per-job routing decision

### Job 1 — White-bg hero (Amazon main image)
**Requirement:** edit a real product photo to RGB(255,255,255) background while preserving every product detail.

| Option | Verdict | Why |
|---|---|---|
| **FLUX Kontext Pro** | **PRIMARY** | Image-to-image edit; preserves identity; ~$0.04/call |
| Nano Banana Pro Edit | Fallback | $0.15 — 4× cost; use only if Kontext rejects the input |
| GPT Image 2 | NOT VIABLE | Generate-from-scratch hallucinates product details = listing fraud risk |

**Stays fal. No GPT Image 2 substitution possible.** Cost: $0.04/SKU.

### Job 2 — Lifestyle / in-context shots
**Requirement:** photoreal scene with product placed naturally; reference-image conditioning.

| Option | Verdict | Why |
|---|---|---|
| **Nano Banana Pro** (standard or Batch) | **PRIMARY** | 14 reference image cap + best identity preservation; $0.067 batch beats GPT Image 2 by 60% |
| FLUX.2 Pro | Cost-saver fallback | $0.03–0.08; use for high-volume catalog refresh or when Nano Banana Pro is rate-limited |
| GPT Image 2 | NOT PRIMARY | $0.165/call vs $0.067 Nano Banana Pro Batch = 2.5× more expensive at lower fidelity to existing product |

**Stays fal.** Use Batch API for async overnight catalog regen → 50% off vs standard. Cost: $0.067/scene × 2-4 scenes/SKU = $0.13–0.27/SKU.

### Job 3 — Infographic / A+ Content / typography overlays
**Requirement:** dense multilingual text on image, layout reasoning, A+ module dimensions, English+Chinese characters.

| Option | Verdict | Why |
|---|---|---|
| **GPT Image 2** | **PRIMARY** | 95–99% character accuracy, "thinking mode" for dense layouts (VentureBeat April 2026) |
| Nano Banana Pro | Fallback | Peer-level on Chinese text but no layout-reasoning mode |
| FLUX.2 / Recraft V4 | Specialized fallback | Recraft V4 only model with editable SVG export — useful for localization-team handoff |

**GPT Image 2 primary.** This is where the OpenAI key actually saves fal budget — every infographic stays off fal. Cost: $0.165/module × 6 modules/SKU = $0.99/SKU.

### Job 4 — Catalog variants per SKU (LoRA-locked)
**Requirement:** 10–60 variants per SKU at locked product identity for catalog refresh; cheap per-image.

| Option | Verdict | Why |
|---|---|---|
| **FLUX.2 Dev + per-SKU LoRA** | **PRIMARY** | $0.03/image after $4–8 one-time training; 150-image breakeven |
| GPT Image 2 | NOT VIABLE | No per-SKU LoRA path; reference-image conditioning every call is expensive AND less consistent than a trained LoRA |

**Stays fal. Required.** Cost: $4–8 one-time + $0.03 × N variants.

### Job 5 — Video (Amazon main-image video slot)
**Requirement:** 1920×1080 H.264, 15–30s, animate the canonical hero image.

| Option | Verdict | Why |
|---|---|---|
| **Kling** (already in stack via fal) | **PRIMARY** | $0.35/clip; v1 already wired |

No OpenAI alternative for video generation in this price tier. **Stays fal.**

---

## "Save fal.ai budget" cost math

Per-SKU spend allocation (50 generated images per spec mix from iter plan §8):

| Slot | OLD (fal-heavy) | NEW (GPT Image 2 where competitive) |
|---|---|---|
| white_bg (1× Kontext) | $0.04 fal | $0.04 fal |
| lifestyle (4× Nano Banana Pro Batch) | $0.27 fal | $0.27 fal (no change — fal still cheaper) |
| infographic (6× GPT Image 2) | $0.99 OAI | $0.99 OAI |
| variants (5× FLUX.2 LoRA) | $0.15 fal | $0.15 fal |
| video (1× Kling) | $0.35 fal | $0.35 fal |
| 详情页 long image (1× GPT Image 2) | $0.50 OAI | $0.50 OAI |
| **Per-SKU total** | **$2.30** | **$2.30** |
| of which fal | **$0.81** | **$0.81** |
| of which OpenAI | **$1.49** | **$1.49** |

**The current routing is already optimal.** Shifting lifestyle work from Nano Banana Pro Batch ($0.067) to GPT Image 2 ($0.165) would *increase* both fal and OpenAI spend (because we'd lose the batch discount AND pay GPT Image 2's premium). The fal budget is already minimized for the work it's uniquely qualified to do.

### Where fal-budget savings actually come from

1. **Nano Banana Pro Batch API (-50%)** — already in plan; activate it for any async overnight job. **Save $0.067/scene** vs standard pricing.
2. **FLUX.2 Pro/Dev for low-stakes slots** — when Nano Banana Pro fidelity isn't required, FLUX.2 Pro at $0.03–0.08 is a 50% discount on the same provider.
3. **Per-SKU LoRA amortization** — train once, regenerate variants at $0.03 each. Pays back the $4–8 training cost after 150 inferences.
4. **Adapter pattern (already done)** — generate a small set of canonical assets, pure-function transform per platform. Don't regenerate per slot.

### Where fal cannot be replaced

- White-bg hero (FLUX Kontext is the only viable edit-based generator at this price tier)
- Per-SKU LoRA training and inference (no equivalent on OpenAI)
- Video generation in the $0.35/clip price tier (Kling)

---

## Decision

1. **Primary routing per slot** as enumerated in §"Per-job routing decision". Three-model architecture from ADR-0001 confirmed; no re-routing.
2. **OpenAI project key** is the production primary. Service-account key is the fallback (rotate via `wrangler secret put OPENAI_API_KEY` if project key is revoked).
3. **Fal-budget optimization** comes from Batch API + per-SKU LoRA amortization, not from cross-provider re-routing.
4. **Implementation gating:** Phase 2 wraps the fal endpoints listed above, plus calls GPT Image 2 via the now-working project key. No cost circuit-breaker re-routing logic needed at the model layer — `cost_cap_cents` (Phase 5) handles per-launch ceilings.

## Fallback chain

When a primary returns 5xx, rate-limits, or rates POOR after 3 evaluator-optimizer iterations:

| Slot | Primary | Fallback 1 | Fallback 2 |
|---|---|---|---|
| white_bg hero | FLUX Kontext Pro | Nano Banana Pro Edit | none — HITL block |
| lifestyle | Nano Banana Pro (Batch) | Nano Banana Pro (standard) | FLUX.2 Pro |
| infographic | GPT Image 2 (high) | GPT Image 2 (medium) | Nano Banana Pro |
| variants | FLUX.2 Dev + LoRA | Nano Banana Pro w/ refs | none — HITL block |
| video | Kling | none yet | manual |

Phase 4-follow's evaluator-optimizer loop already supports retry; the worker layer will pick the next fallback model when iteration ≥ 2.

---

## Citations
- the-decoder GPT Image 2 pricing: https://the-decoder.com/openais-chatgpt-images-2-0-thinks-before-it-generates-adding-reasoning-and-web-search-to-image-creation/
- VentureBeat GPT Image 2 review: https://venturebeat.com/technology/openais-chatgpt-images-2-0-is-here-and-it-does-multilingual-text-full-infographics-slides-maps-even-manga-seemingly-flawlessly
- Nano Banana Pro pricing (incl. Batch -50%): https://blog.laozhang.ai/en/posts/nano-banana-pro-pricing
- fal FLUX.2 trainer + dev: https://fal.ai/models/fal-ai/flux-2-trainer
- AI Magicx text rendering benchmark: https://www.aimagicx.com/blog/tested-10-ai-image-generators-best-use-cases
- ADR-0001 (parent architecture): docs/adr/0001-three-model-pipeline.md

## Validation as of 2026-04-25
- OpenAI project key returns HTTP 200 from `/v1/models` and lists `gpt-image-2`, `gpt-image-2-2026-04-21`, `gpt-image-1.5`, `gpt-image-1`, `dall-e-3`, `dall-e-2`, `chatgpt-image-latest`. GPT Image 2 access confirmed.
- Service-account key kept as `OPENAI_API_KEY_SVCACCT_FALLBACK` in `.env` for rotation.
- R2 + Langfuse keys populated locally. Worker production secrets NOT yet pushed (gated on user OK).
