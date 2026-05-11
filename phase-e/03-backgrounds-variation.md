# Phase E · Iteration 03 — Context-aware backgrounds + variation seeding

**Problems:** #3 (outdoor products on coffee tables) + #5 (duplicate
lifestyle images)
**Depends on:** none
**Blocks:** none
**Estimated session length:** medium (1 PR, ~half day)

## Why now
Today `pipeline/derivers/index.ts` maps `kind → lifestylePrompt`,
which means fishing reels (classified as `compact_square`) get the
"marble surface with coffee cup and notebook" scene. Every lifestyle
slot in the same launch hits the same prompt, so we generate 3
near-identical images. Two issues, one shared fix: build a
`category × kind → scene[]` matrix and rotate through scenes
per-slot with seeded variation.

## Files to touch (all in `apps/mcp-server/src`)

### Scene library

- `pipeline/scene-library.ts` (NEW) — declarative matrix:
  ```
  {
    "outdoor-fishing": {
      compact_square: [
        "at the edge of a dock at sunrise, lake mist behind",
        "mounted on a fishing rod against rocky shoreline, golden hour",
        "in a tackle box surrounded by lures and line"
      ],
      long_thin_vertical: [...]
    },
    "outdoor-camping": { ... },
    "drinkware": { ... },
    "handbag": { ... },
    "default": {
      compact_square: ["clean marble surface, daylight"]
    }
  }
  ```
  Plus a `pickScene(category, kind, slotIndex, seed)` helper that
  hashes (productId, slotIndex) to deterministically pick a scene
  without random drift

### Routing

- `lib/category-router.ts` (NEW) — maps the existing
  `PRODUCT_CATEGORIES` enum (fishing-rod, drinkware, handbag, watch,
  shoe, apparel, accessory, other) PLUS new categories
  (outdoor-fishing, outdoor-camping, kitchenware, fitness) onto
  scene library keys. For "other" + an LLM-derived sub-category from
  the product description, route to the best match using Haiku 4.5
  (single one-shot classification with the scene-library keys as the
  valid output set)

### Pipeline integration

- `pipeline/derivers/index.ts` — keep the per-kind deriver structure
  but inject a `sceneOverride` arg into `LifestylePromptArgs`. When
  the orchestrator provides one, the deriver uses it; when not, falls
  back to today's hardcoded scene (backwards compat)
- `orchestrator/launch_pipeline.ts` — for each lifestyle slot:
  1. Call `categoryRouter.routeToSceneKey(product.category,
     product.description)` once per launch (cached)
  2. Call `sceneLibrary.pickScene(sceneKey, kind, slotIndex,
     productId)` per slot — different slot index → different scene
  3. Pass the picked scene into the deriver as `sceneOverride`

### Variation seeding (problem #5)

The scene library already provides scene-level variation. Add prompt-
level variation on top:

- `lib/prompt-variation.ts` (NEW) — small list of stylistic mods that
  per-slot append/prepend:
  - lighting: "soft daylight" / "golden hour" / "overcast diffuse"
  - angle: "three-quarter view" / "straight-on" / "slight top-down"
  - depth: "shallow depth of field" / "everything sharp"
  Pick deterministically by `hash(productId, slotIndex) % N` so
  re-runs are stable but slots within a launch differ

## Acceptance criteria

- [ ] A fishing-reel product (category `fishing-rod` OR
      LLM-classified as outdoor-fishing) generates lifestyle images
      on water / dock / tackle box scenes, NOT marble + coffee cup
- [ ] A launch with 3 lifestyle slots produces 3 visually distinct
      images — different scene, lighting, or angle on each
- [ ] Re-running the same product gives identical outputs (seeded,
      not random — supports deterministic compliance scoring)
- [ ] A category not yet in the scene library falls back to the
      `default` group + Haiku LLM picks the best match from the
      library keys (logged in `notes[]` for audit)
- [ ] Operators can add new scenes to the library without changing
      code — the library is a JSON file the next iteration can load
      from KV / DB

## Implementation notes

- The Haiku call for unknown categories should cost <$0.01 per launch
  and is cached for 24h keyed on `(category, description_hash)` to
  avoid re-classifying the same product
- The deterministic seeding pattern (`hash(productId, slotIndex)`)
  is critical: if we use `Math.random`, regen runs get different
  scenes which breaks QA reproducibility
- Don't change the per-kind framing prompts (whitebg etc) — those
  stay product-photo-shaped. Only the lifestyle prompts get the
  scene + variation overlay
- Scene library starts with ~6 categories × ~3 kinds × ~3 scenes =
  ~54 scene strings. Easy to maintain in JSON

## Out of scope (do NOT do this iteration)

- Generating scenes from a vector store / RAG over a styled-image
  database — overkill for v1
- Per-tenant brand-styled scenes (operator uploads custom scene
  prompts) — defer
- A/B testing scenes for conversion lift — analytics work, not
  pipeline
- Routing variation via image-to-image (passing the same product
  into different scene templates) — that's a generation pattern
  choice, separate iteration
