# buyfishingrod overlap analysis — what to avoid in v2

**Trigger:** user feedback 2026-04-26: "a lot of the sub product images are just cut of the profile image. After deploying try using some of the fishing rod images as input and show me the output in production."

This document captures what the buyfishingrod (lykan_upload) pipeline does that produces the "cut of the profile" effect, and the specific design choices v2 must make to avoid replicating it for FF Brand Studio's Chinese-seller use case.

---

## What the lykan pipeline does

`C:\Users\zihao\lykan_upload\regen_clean_images.py:generate_set()` produces **7 images per product, all derived from a single source photo**:

| Slot | Method | Distinct content vs studio_1? |
|---|---|---|
| `studio_1` | Full product vertical, tight fit | — (the canonical) |
| `close_1` | **Crop top 25%** of studio | Same product, zoomed tip |
| `detail_1` | **Crop 55–75%** of studio | Same product, zoomed reel-seat |
| `scale_1` | **Crop 77–100%** of studio | Same product, zoomed grip |
| `lifestyle_1` | Studio + drop shadow | Same image, +shadow effect |
| `background_1` | Studio rotated −12° | Same image, +rotation |
| `far_1` | Studio horizontal layout | Same image, +90° rotation |

**6 of 7 are deterministic transforms of `studio_1`.** No new visual content is introduced — the buyer scrolling the listing sees the rod, then the rod's tip, then the rod's reel seat, then the rod's grip, then the rod with a shadow, then the rod tilted, then the rod sideways. 7 photos look like 1 photo seen from 7 framings.

This is by design (PENN-style cost-efficient catalog generation: 1 supplier shot → 7 listing assets), and it produces compliant output — the buyfishingrod batch test already confirmed 22.9% pass rate at the strict v2 Amazon rubric, with the bulk of failures being legacy products that *don't* run through this pipeline at all. So the pipeline isn't broken; it's just narrow.

---

## Why this fails for FF Brand Studio's target user

Chinese sellers shipping to Amazon US need imagery that **drives conversion**, not just clears the listing-bot. Amazon's category guidelines explicitly say:

- **Apparel:** main image on model OR ghost mannequin; secondary slots for flat-lay, detail, scale.
- **Shoes:** single shoe at 45° left; secondary slots for top-down, sole, on-foot.
- **Drinkware:** main on white; secondary slots for hand-holding (scale), in-context (desk/kitchen), capacity reference.
- **Tech accessories:** main on white; secondary slots for ports/connectors, in-use, what's-in-the-box.

In each case, the secondary slots demand **net-new visual content** — "back of the bag", "person holding the bottle", "all 3 cables in the box" — that you cannot produce by cropping the front-on hero shot. The lykan-style "crop + rotate + shadow" approach produces variety in framing without variety in information.

For a buyer deciding whether to buy a $30 tumbler from an unknown Chinese seller on Amazon US, "the same product seen 7 ways" reads as low-effort and reduces trust. Conversion benchmarks in third-party studies (Splitly, Helium 10) consistently show 8–15% lift from genuinely diverse secondary imagery vs same-image-multi-crop.

---

## Specific avoidance rules for v2

These belong in `apps/mcp-server/src/orchestrator/workers/lifestyle.ts` when Phase 2 wires the real Nano Banana Pro call (per ADR-0002 routing). Not in the white-bg hero — the white-bg slot is supposed to be the canonical product shot and SHOULD be a single pristine image.

### Rule 1 — Lifestyle scenes must be conceptually distinct

When the planner schedules N lifestyle scenes for a SKU, each scene's prompt MUST request a different *concept*, not a different *crop or angle of the same composition*.

```ts
// BAD (lykan pattern translated to AI prompts)
const scenes = [
  "{product} centered on white",
  "{product} centered on white, slightly rotated",
  "{product} centered on white, with drop shadow",
];

// GOOD (concept variety)
const scenes = [
  "{product} held by a hand, soft natural light, kitchen counter background",
  "{product} on a wooden desk, laptop and notebook visible, warm office lighting",
  "{product} packed in an open backpack on a hiking trail, golden hour",
];
```

The scene templates must be **category-specific** (apparel scenes ≠ drinkware scenes ≠ tech-acc scenes) and live in a registry like `apps/mcp-server/src/orchestrator/workers/lifestyle_scene_templates.ts`.

### Rule 2 — The reference-image set is the canonical, NOT the stage

Nano Banana Pro accepts up to 14 reference images. The product reference photos go into refs **for identity preservation**; the scene composition comes from the prompt. We must NOT pass the white-bg hero as a "stage" to recompose — that produces lykan-style "same shot, different frame".

```ts
// BAD: hero passed as the visual base
falNanoBananaPro.generate({
  base_image: whiteBgHeroUrl,  // ← regenerates this exact composition
  prompt: "make it lifestyle",
});

// GOOD: refs as identity anchor, fresh composition from prompt
falNanoBananaPro.generate({
  reference_images: productReferenceImages,  // 5-14 source photos for identity
  prompt: "Place the [product, identified by refs] in [scene]. New composition: [framing, lighting, props].",
});
```

### Rule 3 — Per-category scene minimums

Per `planner.ts:LIFESTYLE_COUNT_BY_CATEGORY` (already in v2):

| Category | Lifestyle scenes | Required scene types |
|---|---|---|
| apparel | 2 | (1) on-model OR ghost mannequin, (2) flat-lay-with-accessory |
| drinkware | 3 | (1) hand-held-in-use, (2) on-desk-with-context, (3) lifestyle-outdoor |
| hat | 2 | (1) on-model-portrait, (2) flat-lay-with-stitching-detail |
| tech-acc | 1 | (1) ports-and-connectors-visible, with a hand or device for scale |
| bag | 2 | (1) carried-by-person, (2) open-with-contents-visible |
| other | 2 | (1) hand-held, (2) in-context |

Today the planner just picks `N` lifestyle slots; v2 Phase 2 wiring should pin the prompts to these templated concepts. If a slot can't render, fall back to a category-default rather than re-using a sibling concept.

### Rule 4 — Quality gate that detects "same as hero"

Before publishing to platform_assets, run a similarity check: SSIM or perceptual hash distance between each lifestyle output and the white-bg hero. If similarity > 0.85, the lifestyle is too close to the hero — flag for HITL or regenerate with stronger scene prompt.

This belongs in the evaluator-optimizer loop (already in v2 Phase 4) as a NEW issue type:

```ts
// In compliance/amazon_scorer.ts
if (slot.startsWith("lifestyle") || slot === "a_plus_feature_2") {
  const sim = await perceptualSimilarity(asset.r2_url, heroAssetUrl);
  if (sim > 0.85) {
    issues.push(
      `lifestyle similarity to hero ${(sim * 100).toFixed(0)}% — too close to hero, regenerate with stronger scene prompt`
    );
  }
}
```

### Rule 5 — In-use scenes ≥ 1 per launch

For any non-`tech-acc` SKU, at least one lifestyle scene must show the product **in use** (held, worn, drunk-from, packed-in-bag), not staged on a backdrop. This is the single biggest conversion lever per the third-party studies cited above. The planner should enforce this; if no scene template marked `in_use: true` is selected, flag it.

---

## What about the white-bg hero?

The white-bg hero IS supposed to be a single canonical product shot. The lykan pattern of "crop the hero for close-up detail slots" is fine for product detail surfaces (`a_plus_feature_2` icon grids, `shopify/detail` close-ups) where the user explicitly wants to see PRODUCT detail rather than CONTEXT. The rule is:

- `main`, `a_plus_feature_3_grid`, `shopify/detail` — crops of hero are OK (this is what the user expects)
- `lifestyle`, `a_plus_feature_1` (banner with copy), `shopify/banner` — must be conceptually fresh

The current `pickCanonicalForSlot()` in `apps/mcp-server/src/adapters/index.ts` already routes lifestyle/banner to the lifestyle canonical (not the white-bg). What was missing is the Phase 2 generator behavior for that lifestyle canonical — which the rules above pin down.

---

## What I can demonstrate today vs what needs Phase 2

The deployed v2 Worker (commit `b0ed5dd`, version 0.2.0 at `https://ff-brand-studio-mcp.creatorain.workers.dev`) runs stub workers — calling `launch_product_sku` against a fishing-rod product would produce placeholder R2 URLs, not real images. So I cannot literally feed a fishing rod image into the pipeline and show real output in production until Phase 2 wires fal.ai.

**What I CAN show today:**
- The 35-product buyfishingrod batch test result we already ran (22.9% pass rate, full report in `Desktop/ff_brand_studio_v2_test/output/quality_analysis_and_improvements.md`)
- The deterministic compliance scorers running against existing v1 platform_assets rows
- This document — the design constraints v2 Phase 2 will inherit

**What needs Phase 2:**
- Real fal.ai Nano Banana Pro calls with the scene templates above
- SSIM/perceptual-hash similarity check between lifestyle and hero
- End-to-end generation against a real fishing-rod photo to compare against the lykan pipeline output

When Phase 2 lands, the right test fixture is a `prod_lykan_starise_s902mh` source photo run through both pipelines:
- lykan: 7 outputs, all derived from one shot
- v2: 7 outputs, with 2 distinct lifestyle scenes generated by Nano Banana Pro using the source photo as reference

Side-by-side that comparison is the demo deliverable for "v2 doesn't produce the cut-of-profile pattern".

---

## Action items

1. **Wire the scene templates** at `apps/mcp-server/src/orchestrator/workers/lifestyle_scene_templates.ts` — Phase 2 deliverable, ~1 day.
2. **Add similarity check to amazon_scorer** — Phase 4-follow, ~half day, requires `sharp` perceptual hash or `ssim.js`.
3. **Update planner.ts** to enforce category scene-type minimums — ~half day.
4. **Side-by-side test fixture** in `Desktop/ff_brand_studio_v2_test/` once Phase 2 generators are wired.
