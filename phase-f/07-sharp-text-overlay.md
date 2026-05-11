# Phase F · Iteration 07 — Sharp text-overlay pipeline (E4.1)

**Closes:** E4 plan's full sharp-overlay path — generate clean base
image with NO text, OCR-verify, then composite real-font text on top
**Depends on:** none (E4's judge-strengthened path already shipped;
F7 is the "belt and suspenders" upgrade)
**Blocks:** none
**Risk:** 🟠 medium — bundle size (fonts add ~3MB), feature-flag
gated rollout
**Estimated session length:** medium (1 PR, ~half day)

## Why now
E4 shipped the judge-strengthened anti-text path (extended dual-
judge, stronger regen prompts). That catches most diffusion text
hallucinations via retries. But for slots where text IS intentional
(A+ comparison grid, infographic detail slots), the existing sidecar
composite already uses sharp + SVG.

What's still missing: slots where text is BOTH intentional AND
inline with the generated image (e.g. lifestyle slots with brand
overlay, banner with tagline). For these, F7 chains:
1. Generate the base image with NO text
2. OCR-verify nothing snuck in
3. Sharp-composite intentional text from a slot template

## Files to touch (all in `apps/mcp-server/src`)

- (new) `pipeline/text-overlay.ts` — exports
  `compositeTextOnImage({ baseR2Key, textSpec, outputR2Key }) → R2Key`.
  Uses sharp + SVG. Wraps the existing sidecar pattern from
  `composite.ts` but accepts arbitrary textSpec instead of fixed
  3-spec composite
- (new) `lib/text-overlay-templates.ts` — declarative per-slot
  templates: `{ banner: { anchor: "bottom-left", title: { font, size,
  color } }, ... }`
- (new) `lib/ocr-text-detector.ts` — wraps either Tesseract.js (heavy,
  bundled) OR Workers AI's `@cf/microsoft/resnet-50`-style models
  (lighter). Decision deferred to implementation time
- `pipeline/index.ts` — for slots where `slot.requires_text_overlay`,
  add the chain: generate base → OCR check → composite text
- Feature-flag gated by `USE_SHARP_TEXT_OVERLAY` env var, default off

## Acceptance criteria

- [ ] When enabled, a banner slot produces a clean base image (FAL
      generated with explicit "no text" prompt) followed by a sharp-
      composited brand tagline (e.g. "Premium Camping Gear · Since
      2018") in a clean font on a flat color block at the bottom
- [ ] OCR check on the base (pre-overlay) detects zero text; if any
      detected, one retry attempt fires
- [ ] Text rendered via sharp is crisp, perfectly spelled, no line
      artifacts — the literal failure mode E4 was designed against
- [ ] No regression on slots that DON'T need overlay (default off)
- [ ] Bundle size impact documented in PR — fonts add ~3MB; if it
      pushes the worker over the 10MB unbundled cap, lazy-import the
      sharp text path
- [ ] Feature gated by `USE_SHARP_TEXT_OVERLAY` env var; flip on for
      one slot type at a time

## Safety practices

- **Pin #2 — Branch-by-abstraction**: APPLIES via env var
- **Bundle size watch**: the worker has a hard 10MB unbundled cap
  on the free tier. Inter + Lora at ~150KB subset each is fine;
  Noto Sans SC at ~3MB is heavy. Lazy-import the CJK font only when
  the slot needs Chinese text
- **OCR confidence threshold**: if OCR confidence < 0.5, treat as
  "no text detected" to avoid false-positive retries on noisy
  product textures

## Implementation notes

- SVG-based text in sharp is faster + sharper than rasterizing
  externally. Build the SVG string per slot via a small template
- Tesseract.js: ~5MB bundle, ~1s init. Lazy-import only when needed
- Alternative: hosted OCR via Workers AI or Google Vision — $0.001
  per image. Decision at implementation time based on bundle limits
- Fonts: Inter + Lora (~150KB subset combined). License: SIL OFL
- CJK support: Noto Sans SC. Subset by glyph if we know the text
  ahead of time (we do — it comes from the listing copy)
- The textSpec → SVG conversion is ~100 lines. Keep it pure
  (no FS / no network) so it's deterministic

## Rollback plan

If text overlays render with positioning bugs or break specific
slots:
1. Set `USE_SHARP_TEXT_OVERLAY=false` on the worker → reverts to
   E4's judge-strengthened path
2. If only a specific slot template is broken, mark that slot type
   as `requires_text_overlay: false` in the planner_matrix
3. Last resort: revert F7 commit; E4 path stays as the safety net

## Out of scope (do NOT do this iteration)

- Animated overlays (GIF / video) — separate work
- Operator-editable text-overlay templates UI — JSON file edits only
- Auto-color extraction from product image for contrast-aware text
  color — defer to polish iteration
- Multi-overlay per image (multiple text blocks) — start with one
  block per slot template
