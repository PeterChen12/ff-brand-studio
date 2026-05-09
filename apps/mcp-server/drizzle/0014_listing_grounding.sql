-- Phase C · Iteration 01 — claims-grounding judge output storage.
--
-- Adds a nullable jsonb column to platform_listings (and its versions
-- mirror) carrying the structured output of the claims-grounding LLM
-- judge. Shape:
--   { rating: "GROUNDED"|"PARTIALLY_GROUNDED"|"UNGROUNDED",
--     ungrounded_claims: string[],
--     confidence: number,
--     source: "ai"|"fallback" }
--
-- NULL = grounding never ran (legacy rows or fallback path that
-- skipped the judge entirely). Empty array on UNGROUNDED is impossible
-- by construction; empty array on GROUNDED is the happy path.

ALTER TABLE platform_listings
  ADD COLUMN IF NOT EXISTS grounding jsonb;

ALTER TABLE platform_listings_versions
  ADD COLUMN IF NOT EXISTS grounding jsonb;

CREATE INDEX IF NOT EXISTS idx_listings_grounding_rating
  ON platform_listings ((grounding ->> 'rating'))
  WHERE grounding IS NOT NULL;
