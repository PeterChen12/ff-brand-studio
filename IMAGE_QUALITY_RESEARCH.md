# Image Quality Research — gaps, prior art, relevant resources

**Date:** 2026-05-13
**Brief:** Research-only. Why our product images still have crops errors,
text inaccuracies, hallucinations, product shapeshifting, and wrong
backgrounds. Map each failure mode to prior art and identify our gaps.
**No proposed fixes** — that's a future phase.

---

## TL;DR — top-10 gaps with concrete origins

| Gap | Failure mode it fuels | Industry-standard fix exists? |
|---|---|---|
| 1. We pass only **`referenceR2Keys[0]`** to FAL; discard N−1 vendor angles | Shapeshifting, wrong angle | Yes — FLUX.2 supports 10 refs natively; IP-Adapter accepts multi-ref |
| 2. No **IP-Adapter / ControlNet** layer; gemini-3-pro-image-preview gets prompt+ref only | Shapeshifting, wrong background composition | Yes — IP-Adapter (Tencent), ControlNet scale 0.7-0.8 for product structure |
| 3. No **per-product LoRA fine-tune** path; every launch is from-scratch | Shapeshifting across regenerations | Yes — DreamBooth+LoRA, 15-45 min training, 10-50 images |
| 4. CLIP similarity is our only identity metric; **DINO is industry standard** | False-positive identity matches | Yes — DINO embeddings, 2-3% higher human correlation than CLIP |
| 5. CLIP+dual-judge is our only alignment metric; **VQAScore/TIFA outperform CLIP** | Compositional drift (e.g., "show product at edge of dock" → product in center) | Yes — TIFA (VQA-based), VQAScore from `linzhiqiu/t2v_metrics` |
| 6. No **SAM-based mask / bounding-box conditioning** on generation | Crops errors, product framed weirdly | Yes — SAM 3 (Meta) accepts text or box prompts, produces pixel-accurate masks |
| 7. We let pipeline run fully then judge; **HEaD stops bad generations mid-denoise** | Wasted FAL spend on doomed runs | Yes — HEaD (arXiv 2409.10597) uses cross-attention maps to stop early |
| 8. Text in images comes from the diffusion model; **sharp+SVG overlay is the canonical answer** | Text inaccuracies, line artifacts, garbled chars | Partially shipped (composite.ts sidecar + F7 in-worker MVP), but not wired to lifestyle/banner |
| 9. Claims-grounding checks only against `source` field; **no external web fact-check** | Subtle compliance hallucinations (FDA, Amazon, FTC claims that pass source check) | Yes — exa-hallucination-detector uses Exa web-search verification |
| 10. **No Dynamic Guidance** in our denoise schedule (we use FAL defaults) | General hallucinations | Yes — Dynamic Guidance (arXiv 2510.05356) cuts >50% of hallucinations |

---

## 1. Assessment of the 4 references peter shared

### 1.1 `devanshug2307/Awesome-AI-Image-Prompts` (highly relevant)

Curated collection of **900+ tested prompts** across Midjourney v6, DALL-E
3, Flux Pro, Nano Banana (the underlying model behind our FAL endpoint),
SDXL. Section #2 has **25 product-photography prompts** with concrete
structures we don't currently use:

- **JSON-structured prompts** with explicit fields: `subjectAndElements`,
  `planesAndDepthOfField`, `saturationAndContrast`, `lensPresumed`,
  `technical_parameters` (aspect_ratio, stylize). Way more structured
  than our string-template prompts in `pipeline/derivers/index.ts`.
- **`negative_prompt`** as a first-class field. Examples:
  > "cartoon, CGI, illustration, anime, plastic-looking skin, uncanny
  > face, distorted anatomy, extra fingers, deformed hands, duplicated
  > limbs, wrong perspective, unrealistic scale, blurry, low-res, noisy,
  > harsh artifacts, over-smoothed, bad shadows, floating objects,
  > cluttered scene, messy background, text, watermark, logo, brand
  > names, extra people, face not matching reference"
- **Identity preservation clause**: every reference-based prompt
  contains an explicit "preserve facial likeness, skin tone, hairstyle,
  and overall identity" clause. We have a "match the reference exactly"
  clause but it's not consistently structured.
- **Per-shot variables** (`{THEME}`, `{USER_IMAGE}`) — template variables
  the operator can override per launch. We hard-code scene strings.
- **Lens/aperture/depth specs** ("50–85mm lens look", "shallow DoF, f/1.8").
  Models trained on EXIF-tagged photo data respond to these.

**What's directly applicable to FF Studio:**
- Adopt JSON-structured prompts for `refinePrompt` + `lifestylePrompt`
- Add `negative_prompt` field to the FAL request body (currently absent)
- Promote the existing "no text, no watermarks" block from `bannedBlock()`
  into the FAL `negative_prompt` parameter rather than inlining in the
  positive prompt
- Add lens/aperture vocabulary to scene strings

### 1.2 `yuqie6/ProductFlow` (NOT relevant)

Python/FastAPI/React workflow orchestrator for product material
management. Stack: FastAPI + SQLAlchemy + Dramatiq + Redis + Pillow +
OpenAI SDK. README explicitly states it **does not provide identity
preservation, background control, or cropping** at the application
level — delegates to underlying models.

It's architecturally a parallel to our `apps/dashboard` + `apps/mcp-
server`: a workbench wrapping image-gen APIs. Nothing here we'd lift.

### 1.3 `rhgao/Im2Flow` (NOT relevant)

CVPR 2018 paper: deep learning method that generates **optical flow
(motion) from static images** for action recognition. Uses pix2pix-style
image-to-image translation on UCF-101 video dataset.

Domain mismatch — our problem is static product photography quality,
not motion inference from video frames. The word "hallucination" in
the paper title ("Motion Hallucination from Static Images") is in the
opposite sense (intentional hallucination of motion) from our concern.

### 1.4 `exa-labs/exa-hallucination-detector` (partially relevant)

Text-only fact-checker. Architecture:

1. **Claim Extraction** via Claude 3.5 Sonnet (splits LLM output into
   atomic claims)
2. **Source Verification** via Exa's web-search API (finds supporting
   or refuting sources)
3. **Accuracy Analysis** by Claude (judges each claim against sources)
4. **Results Display** (suggested corrections)

**What our claims-grounding currently does:** steps 1+3 against the
product's own `source` text only. No external web search.

**The gap exa-hallucination-detector exposes:** A vendor description
that says "Made in USA" but is actually made in China would pass our
internal grounding (the source says so). External fact-check (Exa or
similar) could catch this against vendor records, Amazon listings,
compliance databases. Relevant for **regulated-category tenants**
(F6's `regulated_category` flag) where the cost of a wrong claim is
real (FDA, FTC).

Note: stack mismatch (Next.js/Vercel, not our Cloudflare Worker) and
no published library API — would have to lift the prompt + Exa API
call patterns rather than `npm install`-ing the package.

---

## 2. Failure-mode-by-failure-mode mapping

### 2.1 Crops errors

**Symptom:** product's tip/handle/edge cut off; subject too tight or
too loose in frame; wrong aspect.

**Our current path:** sharp-based crop after generation (`pipeline/
image_post.ts` `measureProductFill`). The diffusion model itself
isn't told where to put the subject — we let it freelance.

**Industry standard:**
- **SAM 3** (Meta, available on FAL) — accepts text OR bounding-box
  prompts, returns pixel-accurate masks. Use case: pre-process the
  reference to get a tight mask, feed the mask back to the generator
  as a constraint.
- **ControlNet** at scale 0.7-0.8 for product structure — locks the
  composition while allowing texture/lighting variation.
- **Layout Quality Score (LQS) / VISOR / GroundingScore** for measuring
  if the generated layout matches the requested composition.

**Concrete gap:** the generation path is unconditioned on where the
product should sit in frame. We crop after the fact and accept whatever
the model produced.

### 2.2 Text inaccuracies / line artifacts in text

**Symptom:** diffusion model puts garbled text on product / in scene;
line artifacts crossing through characters.

**Our current path:** strong negative prompts ("no text, no letters,
no numbers anywhere in the image" — strengthened in E4); dual-judge
catches text artifacts via the extended FRAMING_JUDGE_SYSTEM_PROMPT;
F4 defect router routes "text" reasons to specialist regen prompt;
F7 MVP shipped a sharp+SVG text overlay helper but it's not wired to
any slot yet.

**Industry standard:**
- **Never ask diffusion to render text.** Generate clean base → composite
  text via SVG/sharp/Pillow with real font files.
- Our `composite.ts` sidecar already does this for A+ feature slots.
- Newer models (Nano Banana Pro, FLUX with text-aware variants) handle
  short text better but still fail on long/multilingual strings.

**Concrete gap:** lifestyle, banner, and detail slots don't have an
overlay layer wired. F7's `lib/sharp-text-overlay.ts` exists but no
caller. When the operator wants a tagline on a banner, the model adds
it directly (and sometimes wrong).

### 2.3 Hallucinations (image: features that aren't on the product)

**Symptom:** invented logos, fake hardware, wrong number of components,
extra fingers on hands (when humans appear in lifestyle).

**Our current path:** dual-judge (similarity + framing) rejects if the
generated image doesn't match references; iterate up to 3 times.
Phase F's defect router routes "melted_geometry" → specialist prompt.

**Industry standard:**
- **Dynamic Guidance** (arXiv 2510.05356): adaptively selects target
  for guidance at each denoising step using a noisy-sample classifier.
  Cuts >50% of hallucinations across guidance scales.
- **HEaD — Hallucination Early Detection** (arXiv 2409.10597): uses
  cross-attention maps + Predicted Final Image (PFI) to detect anomalies
  mid-denoise. Stops generation early when prompt-attention misalignment
  predicts failure. Saves cost on doomed runs.
- **Hallucination Index** (MICCAI 2024): Hellinger distance from
  reconstructed image distribution to zero-hallucination reference
  distribution. Image-quality metric, not a runtime gate.
- **Mode Interpolation analysis** (arXiv 2406.09358): hallucinations
  often happen when the model interpolates between training-data modes.

**Concrete gap:** we're at the FAL API boundary — we can't intervene
in their denoising schedule. We can only post-judge. HEaD / Dynamic
Guidance require model-level access we don't have unless we self-host.

### 2.4 Hallucinations (text: claims not in source)

**Symptom:** SEO copy says "Waterproof to 50m", "Made in USA", "FDA
approved" when source text doesn't support it.

**Our current path:** Phase C iter 01 shipped `lib/claims-grounding.ts`
(Haiku judge vs source text); Phase E iter 05 added auto-rewrite chain;
Phase F iter 06 added dual-judge ensemble (permissive + skeptical) for
regulated-category tenants.

**Industry standard:**
- **TIFA** (`Yushi-Hu/tifa`, EMNLP 2023): VQA-based faithfulness eval.
  Generates Q&A pairs from the prompt, uses BLIP-2 / GPT-4V to answer
  them against the image. Higher human correlation than CLIP.
- **VQAScore** (`linzhiqiu/t2v_metrics`): simpler than TIFA — single
  "Does this figure show {text}?" probability. State-of-the-art on
  compositional prompts.
- **exa-hallucination-detector** pattern: claim extraction → external
  web verification (not just source-text grounding).

**Concrete gap:** our judge grounds against the operator's `source`
field only. For regulated-category claims where the source itself might
mis-state regulatory status, external verification (FDA database,
Amazon compliance docs, FTC guidelines) would be additive. Today's
flow trusts the operator's source text.

### 2.5 Product shapeshifting (identity drift)

**Symptom:** Bearking Zeus 1000 generated on Monday vs Wednesday look
like different products. Or: regenerating an asset produces a noticeably
different product silhouette.

**Our current path:** dual-judge similarity check (Haiku vision) +
CLIP similarity threshold (0.78). Reject if mismatch.

**Industry standard:**
- **IP-Adapter** (Tencent, 2023): lightweight image-prompting extension
  for diffusion models via decoupled cross-attention. Identity transfer
  from reference image. Industry-standard for "make new image of THIS
  product."
- **IP-Adapter-FaceID** variant: even tighter identity preservation
  (originally for faces, but the architecture generalizes).
- **ControlNet** at scale 0.7-0.8 for structural lock on product
  geometry.
- **DreamBooth + LoRA**: per-subject fine-tuning. 10-50 reference images,
  15-45 min training. Produces a tiny LoRA file that any future
  generation can load to preserve identity.
- **FLUX.2**: supports up to 10 reference images natively with strong
  preservation across multi-scene workflows.
- **DINO similarity**: industry-standard identity metric (cosine
  similarity between DINO embeddings of generated vs reference).
  Stronger than CLIP for identity tasks. Originated in DreamBooth paper.

**Concrete gaps:**
- We pass exactly 1 reference to FAL. FLUX.2 / IP-Adapter handle 10.
- We have no per-product LoRA — every regen starts from scratch.
- We use CLIP for similarity; DINO would be more accurate.
- We're at the FAL API boundary (gemini-3-pro-image-preview); we can't
  layer ControlNet/IP-Adapter unless we self-host or switch endpoints.

### 2.6 Wrong background

**Symptom:** outdoor fishing reel rendered on a marble coffee table
(closed in E3 via scene library + category router).

**Our current path:** Phase E iter 03 shipped category-routed scene
library + per-product variation seeding. Fishing-rod category now gets
dock/shoreline/tackle-box scenes.

**Industry standard:**
- **SAM + Stable Diffusion inpainting**: segment the product out, then
  inpaint a new background around it. Cleaner than "generate everything
  including a new background" because the product pixels stay literal.
- **ControlNet for compositional structure**: keeps product position
  fixed while regenerating background.
- **Scene libraries similar to ours** (e.g., Segmind's product-photo
  background-replacement service) — confirms the category-route
  pattern is the right answer.

**Where E3 is incomplete:**
- Scene library is curated finite (~30 scenes). No semantic search
  over a larger pool, no per-tenant brand-themed scenes.
- No SAM-based mask preserves the product literally; the model is
  asked to recreate both product AND background, which means it can
  drift the product while moving it onto the new scene.

---

## 3. Additional relevant resources I found

### 3.1 Models & techniques

| Resource | What it does | Relevance |
|---|---|---|
| [IP-Adapter homepage](https://ip-adapter.github.io/) | Decoupled cross-attention for image prompts | Shapeshifting fix |
| [FaceID variant](https://www.mercity.ai/blog-post/understanding-and-training-ip-adapters-for-diffusion-models/) | Tighter identity preservation | Could generalize to products |
| [SAM 3 on FAL](https://fal.ai/models/fal-ai/sam-3/image) | Text/box-prompted segmentation | Crop / mask control |
| [FLUX.2 multi-reference](https://www.veo3ai.io/blog/veo-3-image-reference-workflow-2026) | Up to 10 reference images | Multi-ref bottleneck fix |
| [Gemini 3 Pro prompting guide](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/start/gemini-3-prompting-guide) | Conversational vs keyword prompts; aspect/lens/lighting vocabulary | Better prompts for FAL's gemini-3-pro endpoint |
| [LoRA training (15-45 min, 10-50 images)](https://imagera.ai/guides/what-is-lora-guide-ai-model-fine-tuning-2026) | Per-product fine-tune | Shapeshifting fix at the model level |

### 3.2 Evaluation & QA

| Resource | What it does | Relevance |
|---|---|---|
| [TIFA (`Yushi-Hu/tifa`)](https://github.com/Yushi-Hu/tifa) | VQA-based faithfulness eval (EMNLP 2023) | Replace or augment our CLIP similarity for compositional checks |
| [VQAScore (`linzhiqiu/t2v_metrics`)](https://github.com/linzhiqiu/t2v_metrics) | State-of-the-art text-image alignment metric | Same role as TIFA but simpler |
| [Awesome-Evaluation-of-Visual-Generation](https://github.com/ziqihuangg/Awesome-Evaluation-of-Visual-Generation) | Curated list of T2I evaluation metrics | DINO, NexusScore, GenEval, VISOR, GroundingScore all listed with papers |
| [DINO similarity for identity](https://arxiv.org/abs/2208.12242) (DreamBooth paper) | Cosine similarity over DINO embeddings | Replace CLIP for identity scoring |
| [GenEval](https://arxiv.org/abs/2310.11513) | Object-focused T2I alignment | Same alignment role |
| [VISOR](https://arxiv.org/abs/2212.10015) | Spatial-relationship benchmark | Could detect "product centered" vs "product at edge" composition issues |

### 3.3 Hallucination / safety

| Resource | What it does | Relevance |
|---|---|---|
| [HEaD (arXiv 2409.10597)](https://arxiv.org/html/2409.10597) | Cross-attention based hallucination early-stop | Cost savings — abandon doomed runs mid-denoise |
| [Dynamic Guidance (arXiv 2510.05356)](https://arxiv.org/html/2510.05356v1) | Adaptive denoising target selection | >50% hallucination reduction at the generation level |
| [Mode Interpolation analysis](https://arxiv.org/html/2406.09358v1) | Why hallucinations happen — interpolation between training modes | Theoretical understanding |
| [Hallucination Index (MICCAI 2024)](https://link.springer.com/chapter/10.1007/978-3-031-72117-5_42) | Image-quality metric via Hellinger distance | Could be a third QA signal alongside CLIP + dual_judge |
| [GHOST (arXiv 2509.25178)](https://arxiv.org/html/2509.25178v1) | Adversarial dataset of hallucination-inducing inputs | Test-set source for evaluating our pipeline |
| [Multimodal Hallucination Survey (arXiv 2507.19024)](https://arxiv.org/html/2507.19024v2) | Survey of detection & eval methods | One-stop literature review |

### 3.4 Prompt engineering

| Resource | What it does | Relevance |
|---|---|---|
| [`devanshug2307/Awesome-AI-Image-Prompts`](https://github.com/devanshug2307/Awesome-AI-Image-Prompts) | 900+ tested prompts, 25 product photography | Direct prompt patterns to lift |
| [`YouMind-OpenLab/awesome-gemini-3-prompts`](https://github.com/YouMind-OpenLab/awesome-gemini-3-prompts) | 50+ Gemini-3 specific prompts | Gemini-3 is the model behind our FAL endpoint |
| [Nano Banana Pro prompting tips (Google)](https://blog.google/products-and-platforms/products/gemini/prompting-tips-nano-banana-pro/) | First-party prompt guide | Authoritative source |
| [`PSRahul/product_photography_with_lora_sd`](https://github.com/PSRahul/product_photography_with_lora_sd) | Experiment: highly accurate product photography via LoRA on SD | Concrete recipe for per-product LoRA |

### 3.5 Reference architectures

| Resource | What it does | Relevance |
|---|---|---|
| [ComfyUI ControlNet + IP-Adapter workflow](https://comfyui.org/en/image-style-transfer-controlnet-ipadapter-workflow) | Reference workflow for combining the two | Architecture pattern even if we don't run ComfyUI in prod |
| [ICAS (arXiv 2504.13224)](https://arxiv.org/abs/2504.13224) | IP-Adapter + ControlNet attention structure for multi-subject style transfer | Multi-product scenes (e.g., set of 3 reels) |

---

## 4. Concrete gaps in our system

Listed in approximate order of impact-per-effort:

### Gap 1: Single-reference bottleneck

**Where:** `apps/mcp-server/src/pipeline/index.ts:104`
```ts
const sourceR2Key = ctx.referenceR2Keys[0];
```
**Impact:** When vendor drops 8 images, we use 1. If the first is awkward
(back of package, low fill, watermark), output silently inherits.
**Fix exists?** Yes — D6 plan deferred. FLUX.2 supports 10 natively.
**Effort:** the FAL endpoint we use takes `image_urls: []` array; D6 plan
already drafted.

### Gap 2: No `negative_prompt` field in FAL request

**Where:** `apps/mcp-server/src/pipeline/refine.ts:47` and
`apps/mcp-server/src/pipeline/lifestyle.ts:39`. The bannedBlock content
is concatenated into the positive prompt rather than passed as a
separate `negative_prompt` parameter.
**Impact:** Negative-prompt directives compete with positive-prompt
content; models respect them less than a dedicated field.
**Industry standard:** every prompt example in the curated lists has
a separate negative_prompt.

### Gap 3: No IP-Adapter / ControlNet layer

**Where:** FAL endpoint boundary. `fal.run/fal-ai/gemini-3-pro-image-
preview/edit` is a single-shot generation API. Adding IP-Adapter
requires either a different FAL endpoint (some support it) or self-
hosted comfy / diffusers pipeline.
**Impact:** Shapeshifting on regenerations; identity drift across
iterations of the same product.
**Effort:** high — possibly model-swap surgery.

### Gap 4: CLIP for identity instead of DINO

**Where:** `apps/mcp-server/src/pipeline/triage.ts` clipSimilarityFromR2.
**Impact:** CLIP measures semantic similarity (good for "is this a fishing
reel?"); DINO measures structural similarity (good for "is this the
SAME fishing reel?"). We need the latter.
**Effort:** small — DINO embeddings via HuggingFace or a sidecar call;
threshold needs re-calibration.

### Gap 5: No external claim verification

**Where:** `apps/mcp-server/src/lib/claims-grounding.ts` checks against
the `source` field only.
**Impact:** A vendor-misstated regulatory claim ("FDA approved") that
appears in source text passes our grounding.
**Industry standard:** exa-hallucination-detector style web verification.
**Effort:** medium — Exa API integration + cost model.

### Gap 6: Lifestyle/banner slots don't use sharp text overlay

**Where:** F7 shipped `lib/sharp-text-overlay.ts` with 9 tests; no
caller in `pipeline/index.ts` or `composite.ts` wires it for non-A+
slots.
**Impact:** Banner slot with a brand tagline asks the diffusion model
to render text → garbled output.
**Effort:** small — invoke the helper in `bannerExtend` and any
lifestyle slot that takes copy.

### Gap 7: VQAScore/TIFA not used

**Where:** our evaluation is CLIP + dual_judge (Haiku vision). TIFA/
VQAScore measure faithfulness via VQA, which is what "did the model
follow the prompt" actually requires.
**Impact:** A lifestyle prompt "fishing reel at sunrise on a dock" can
pass dual_judge if the reel is plausible, even if the scene is wrong.
TIFA would catch the scene mismatch.
**Effort:** medium — TIFA/VQAScore are PyTorch models; would need a
sidecar.

### Gap 8: No prompt-effectiveness telemetry

**Where:** prompts are constant strings in `pipeline/derivers/index.ts`,
no A/B testing infrastructure. Can't tell which prompt patterns produce
fewer rejections per category.
**Impact:** Prompt tuning is blind. F4 defect router shipped specialist
prompts but no measurement of their effect.
**Effort:** medium — add `prompt_version` to `image_qa_judgments` and
analytics queries.

### Gap 9: No HEaD-style early stop

**Where:** Every launch runs full pipeline + judges at end.
**Impact:** Doomed runs (input quality too low, prompt drift detected
early) burn full wallet before failing.
**Industry standard:** D8 plan (input-quality fail-fast) addresses
the gross case; HEaD addresses the mid-denoise case but requires
model-level access we don't have via FAL.

### Gap 10: No per-product LoRA / DreamBooth lineage

**Where:** No fine-tuning infrastructure in the codebase. Every launch
is a from-scratch generation conditioned only on the prompt + reference.
**Impact:** Series products (Bearking Zeus 1000/2000/3000) generate
independently without learning shared visual DNA. Operators see
sibling products that don't look like a family.
**Effort:** high — LoRA training takes 15-45 min compute per SKU, and
serving requires keeping LoRA files in R2 and loading at generation
time.

---

## 5. Honest summary of what's hardest to fix

Three structural constraints determine what's reachable:

1. **We don't run the diffusion model.** FAL hosts gemini-3-pro-image-
   preview. We can't add HEaD, Dynamic Guidance, IP-Adapter, ControlNet,
   or per-step interventions at the denoising level unless we either
   (a) switch to a FAL endpoint that exposes those, or (b) self-host.

2. **Cloudflare Workers can't host PyTorch.** TIFA, VQAScore, DINO,
   SAM, ControlNet, IP-Adapter all run in PyTorch. Putting them in our
   pipeline means a sidecar (we already have one for the sharp composite
   step) or external API calls (FAL has SAM-3 and others).

3. **Per-product fine-tuning is its own platform.** Training, storing,
   versioning, and serving LoRA files for every SKU is a 6-12 month
   infra build, not a Phase G iteration.

**The reachable quick wins given those constraints:**
- Multi-reference (Gap 1) — pure prompt construction
- `negative_prompt` field (Gap 2) — pure API call shape
- Wire sharp text overlay to more slots (Gap 6) — pure code
- TIFA/VQAScore via sidecar (Gap 7) — bounded sidecar work
- External claim verification (Gap 5) — Exa API integration

**The deep-but-bounded next layer:**
- DINO via sidecar (Gap 4)
- SAM 3 via FAL endpoint for crop conditioning (Gap 6 alt)
- FAL endpoint swap to one supporting ControlNet/IP-Adapter (Gap 3)

**The infra investments:**
- Per-product LoRA training pipeline (Gap 10)
- Self-hosted diffusion for full-stack control (Gap 3 deep)
- HEaD / Dynamic Guidance integration (Gap 9 deep)

---

## 6. What's NOT in this research

Things I checked and don't think are relevant for our current product:
- **Im2Flow** — wrong domain (motion from video, not static product photography)
- **ProductFlow** — same architectural layer as us; no quality techniques to lift
- **Video generation** (Sora, Veo, Kling) — separate product surface
- **3D reconstruction** (NeRF, Gaussian splatting) — overkill for our 2D slot needs
- **Real-time avatars** (HeyGen, Synthesia) — wrong domain

Things I'd want to research more if we move into Phase G+:
- **FAL model catalog** — which of their endpoints expose IP-Adapter /
  ControlNet directly (vs just gemini-3-pro)
- **Cost-per-quality tradeoff curves** for FLUX.2, Recraft, Ideogram —
  each has different strengths
- **Self-hosting economics** — at what monthly launch volume does
  self-hosted Flux on Modal/Lambda Labs beat FAL pricing
