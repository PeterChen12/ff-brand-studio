-- Phase 1 P1.1 (cross-system audit) — per-tenant brand profile.
--
-- Pre-fix, the brand guardian, hero-image prompt, infographic prompt,
-- and video prompt all hardcoded Faraday Future brand standards
-- (palette #1C3FAA / #00A8E8 / #C9A84C, "Maison Neue + Source Han Sans
-- SC", "investor-grade" tone, NO exclamation marks). BFR or Ceron
-- tenants sending products through the pipeline would get scored
-- against automotive luxury brand rules — wrong by construction.
--
-- This column holds the customizable shape that each tenant's prompts
-- and guardian rules read from. Shape (jsonb):
--
--   {
--     "name": "Faraday Future" | "Ceron Rod" | ...,
--     "palette": {
--       "primary":   { "name": "Brand Navy", "hex": "#1C3FAA" },
--       "secondary": { "name": "Electric",   "hex": "#00A8E8" },
--       "accent":    { "name": "Gold",       "hex": "#C9A84C" },
--       "neutrals":  [ { "name": "Carbon", "hex": "#0A0A0A" } ]
--     },
--     "typography": {
--       "heading":   { "family": "Maison Neue", "weights": [400, 600, 700] },
--       "body":      { "family": "Source Han Sans SC", "weights": [400, 500] }
--     },
--     "logo_rules": {
--       "min_height_px": 80,
--       "clear_space_px": 24,
--       "wordmark_text": "FARADAY FUTURE",
--       "do_not": ["stretch", "recolor outside palette", "place on busy bg"]
--     },
--     "tone": {
--       "descriptors":   ["aspirational", "investor-grade", "premium"],
--       "forbidden":     ["cheap", "affordable", "deal"],
--       "punctuation":   { "exclamations_allowed": false }
--     },
--     "guardian_weights": {
--       "color": 0.20, "typography": 0.20, "logo": 0.15,
--       "image_quality": 0.25, "copy_tone": 0.20
--     },
--     "pass_threshold": 70,
--     "sample_assets": [
--       { "kind": "hero",        "r2_url": "https://pub-…/sample-hero.jpg" },
--       { "kind": "infographic", "r2_url": "https://pub-…/sample-info.png" }
--     ]
--   }
--
-- NULL allowed for legacy rows; the prompt + guardian readers fall
-- back to the hardcoded FF defaults until a tenant defines its own
-- profile (decision P1-A: default fallback is "luxury automotive"
-- which is wrong for non-FF tenants — this is intentional so we
-- catch unmigrated tenants in the guardian output rather than silently
-- producing FF-flavored assets for them).

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS brand_profile jsonb;

-- Backfill the seed tenant (sample) so the demo stays consistent.
-- Other tenants must call POST /v1/tenants/me/brand-profile.
UPDATE tenants
SET brand_profile = jsonb_build_object(
  'name', 'Faraday Future',
  'palette', jsonb_build_object(
    'primary',   jsonb_build_object('name', 'Brand Navy', 'hex', '#1C3FAA'),
    'secondary', jsonb_build_object('name', 'Electric',   'hex', '#00A8E8'),
    'accent',    jsonb_build_object('name', 'Gold',       'hex', '#C9A84C'),
    'neutrals',  jsonb_build_array(jsonb_build_object('name', 'Carbon', 'hex', '#0A0A0A'))
  ),
  'typography', jsonb_build_object(
    'heading', jsonb_build_object('family', 'Maison Neue',         'weights', jsonb_build_array(400, 600, 700)),
    'body',    jsonb_build_object('family', 'Source Han Sans SC',  'weights', jsonb_build_array(400, 500))
  ),
  'logo_rules', jsonb_build_object(
    'min_height_px',  80,
    'clear_space_px', 24,
    'wordmark_text',  'FARADAY FUTURE',
    'do_not',         jsonb_build_array('stretch', 'recolor outside palette', 'place on busy bg')
  ),
  'tone', jsonb_build_object(
    'descriptors', jsonb_build_array('aspirational', 'investor-grade', 'premium'),
    'forbidden',   jsonb_build_array('cheap', 'affordable', 'deal'),
    'punctuation', jsonb_build_object('exclamations_allowed', false)
  ),
  'guardian_weights', jsonb_build_object(
    'color', 0.20, 'typography', 0.20, 'logo', 0.15,
    'image_quality', 0.25, 'copy_tone', 0.20
  ),
  'pass_threshold', 70,
  'sample_assets', jsonb_build_array()
)
WHERE brand_profile IS NULL
  AND name ILIKE '%faraday%';
