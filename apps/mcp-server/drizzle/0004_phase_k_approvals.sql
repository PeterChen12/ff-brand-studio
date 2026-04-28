-- Phase K3 — approval state machine.
-- Adds approved_at to platform_listings + platform_assets so a SKU can be
-- locked + exported. Reversible: unapprove sets back to NULL.
-- Idempotent via IF NOT EXISTS.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'platform_listings' AND column_name = 'approved_at'
  ) THEN
    ALTER TABLE platform_listings ADD COLUMN approved_at timestamp;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'platform_assets' AND column_name = 'approved_at'
  ) THEN
    ALTER TABLE platform_assets ADD COLUMN approved_at timestamp;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_platform_listings_approved
  ON platform_listings(approved_at);
CREATE INDEX IF NOT EXISTS idx_platform_assets_approved
  ON platform_assets(approved_at);
