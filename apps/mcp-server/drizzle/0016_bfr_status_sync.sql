-- 0016_bfr_status_sync.sql — bidirectional product status with
-- BFR admin (and any future customer admin that adopts the same
-- /v1/external/bfr-status-update webhook contract).
--
-- After the operator clicks Stage in the FF Studio library, the
-- bulk-approve handler sets bfr_status='staged' inline so the UI flips
-- without waiting for the round-trip. Whenever the BFR admin operator
-- transitions the product through STAGING → ACTIVE → ARCHIVED, BFR
-- POSTs to /v1/external/bfr-status-update; that handler refreshes
-- bfr_status + bfr_url + bfr_synced_at on the matching product row.
--
-- All three columns are nullable / additive — products created before
-- this migration just show no status pill in the library, which is
-- correct (they were never staged).

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS bfr_status     text,
  ADD COLUMN IF NOT EXISTS bfr_url        text,
  ADD COLUMN IF NOT EXISTS bfr_synced_at  timestamp;

-- Lookup index for the inbound webhook's "find the product by
-- external_id" query. external_source='ff-brand-studio' on the BFR
-- side, so we filter to that to avoid scanning ingested rows from
-- other origins.
CREATE INDEX IF NOT EXISTS idx_products_bfr_status
  ON products (tenant_id, bfr_status)
  WHERE bfr_status IS NOT NULL;
