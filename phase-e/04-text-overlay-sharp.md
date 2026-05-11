# Phase E · Iteration 04 — Sharp-based text overlay (kill diffusion text artifacts)

**Problem:** #7 (line in text when generator adds text to images)
**Depends on:** none
**Blocks:** none
**Estimated session length:** medium (1 PR, ~half day)

## Why now
Today the A+ comparison grid + spec-table slots ask the diffusion
model to render text directly inside the image (product name,
feature labels, spec rows). Diffusion models cannot reliably render
legible text — line artifacts, garbled characters, and misspellings
are inherent to the model class. This is the most visually
embarrassing failure mode in our output: a product photo with
"GVALITY" instead of "QUALITY" written on it. The fix is
**chaining**: generate a clean base image with no text, then
composite the text on top with sharp using real fonts.

## Files to touch (all in `apps/mcp-server/src`)

### Identify text-bearing slots

The slots that today include text in the prompt:
- `a_plus_feature_1`, `a_plus_feature_2`, `a_plus_feature_3_grid`
- `comparison_grid`
- `spec_table`
- Any infographic-shaped slot

### Pipeline split

- `pipeline/text-overlay.ts` (NEW) — given
  `{ baseImageBuffer, textSpec }`, returns the composited buffer.
  `textSpec` has fields per overlay element:
  `{ text, anchor: "top-left"|"bottom-center"|..., fontFamily,
  fontSize, fontWeight, color, maxWidth, lineHeight, padding }`.
  Uses `sharp(...).composite([{ input: svgBuffer, blend: 'over' }])`
  where the SVG is generated from the textSpec
- `pipeline/derivers/index.ts` — for text-bearing slots, refinePrompt
  must explicitly say:
  ```
  Generate the image with NO text, NO labels, NO numbers, NO logos.
  Leave clean negative space at the [top-left | bottom | etc] where
  text will be overlaid programmatically.
  ```
- `orchestrator/workers/(or pipeline/index.ts)` — for text-bearing
  slots, chain the calls:
  1. Generate the base image without text (existing pipeline)
  2. Run OCR (Tesseract.js) on the result to verify NO accidental
     text appeared. If detected, regen once (one extra attempt) with
     stronger negative prompt
  3. Build the textSpec from the product's listing copy (e.g.,
     "FEATURE 1: 9 Bearings" for a_plus_feature_1)
  4. Composite text via `pipeline/text-overlay.ts`
  5. Persist the composite to R2 (NOT the bare base image)
- `lib/text-overlay-templates.ts` (NEW) — declarative templates per
  slot type:
  ```
  a_plus_feature_1: {
    textAnchor: "top-left",
    bg: { x: 0, y: 0, width: "100%", height: "30%", color: "#FFFFFF99" },
    title: { fontSize: 64, color: "#000", weight: 700 },
    body: { fontSize: 36, color: "#333", weight: 400, maxWidth: "60%" }
  }
  ```

### Fonts

- (new) `public/fonts/` (or R2-hosted) — ship 2–3 web fonts (Inter,
  Lora) baked into the worker bundle. License: Inter SIL OFL, Lora
  SIL OFL. ~150KB additional bundle size

## Acceptance criteria

- [ ] An a_plus_feature_1 slot produces an image where the text is
      crisp, legible, perfectly spelled (because it came from sharp,
      not the model)
- [ ] OCR check on the base image (pre-overlay) detects ZERO text;
      if any text is detected, one regen attempt fires
- [ ] The composite renders the same product image with the
      overlaid text matching the listing copy from `platform_listings`
- [ ] Font choice respects tenant `brand_hex` color for the
      title (defaults to black if brand_hex is white-ish)
- [ ] No regression on non-text slots (white-bg main, lifestyle, etc.)
      — those bypass the overlay pipeline entirely

## Implementation notes

- SVG-based text in sharp is faster + sharper than rasterizing
  externally. Build the SVG string per slot, sharp composites it
- Tesseract.js in a Worker is ~5MB bundle + 1s init. To stay under
  worker limits, lazy-import only when a text-bearing slot is in
  the pipeline. Or use a hosted OCR API (cheaper bundle, $0.001/img
  via Google Vision)
- Multi-language: Chinese listings need a CJK font. Bundle Noto Sans
  SC (~12MB raw, ~3MB subset). Subset by glyph if we know the text
  ahead of time
- The textSpec → SVG conversion is ~100 lines. Keep it pure /
  deterministic
- Don't apply this to lifestyle slots even though "no text" prompt
  is good there — the lifestyle pipeline already produces clean
  images, the text-overlay infra is overhead

## Out of scope (do NOT do this iteration)

- Animated overlays (the GIF / video variant) — separate work
- Auto-color extraction from product image for contrast-aware text
  color — defer to a polish pass
- Operator-editable text-overlay templates UI — JSON file edits only
  for v1
- Multi-overlay per image (image + headline + sub + price + badge)
  — start with single-headline + body, expand if needed
