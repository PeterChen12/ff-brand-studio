-- 0011_promo_codes.sql — testing promo codes for wallet top-up.
--
-- One row per promo (e.g. SPIKE100 = $100 top-up, 10 redemptions max).
-- promo_redemptions enforces "one redemption per tenant per code" via the
-- UNIQUE(promo_code_id, tenant_id) index. The global cap is enforced by
-- an atomic UPDATE...WHERE current_redemptions < max_redemptions guarded
-- inside a transaction in the redeem endpoint.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS promo_codes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                text NOT NULL UNIQUE,
  top_up_cents        integer NOT NULL,
  max_redemptions     integer NOT NULL,
  current_redemptions integer NOT NULL DEFAULT 0,
  expires_at          timestamp,
  created_at          timestamp DEFAULT NOW(),
  CHECK (top_up_cents > 0),
  CHECK (max_redemptions > 0),
  CHECK (current_redemptions >= 0 AND current_redemptions <= max_redemptions)
);

CREATE TABLE IF NOT EXISTS promo_redemptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_code_id   uuid NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  redeemed_at     timestamp DEFAULT NOW(),
  UNIQUE (promo_code_id, tenant_id)
);

-- Audit query: list redemptions for one promo, newest first.
CREATE INDEX IF NOT EXISTS idx_promo_redemptions_promo_redeemed
  ON promo_redemptions (promo_code_id, redeemed_at DESC);

-- Seed the testing promo: SPIKE100 = $100 top-up, 10 redemptions total.
INSERT INTO promo_codes (code, top_up_cents, max_redemptions)
VALUES ('SPIKE100', 10000, 10)
ON CONFLICT (code) DO NOTHING;
