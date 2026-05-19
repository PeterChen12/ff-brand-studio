-- P0 — webhook idempotency. Mirrors the BFR-side table so both
-- inbound and outbound receivers can dedupe identically.
CREATE TABLE IF NOT EXISTS webhook_inbox (
  event_id text PRIMARY KEY,
  source text NOT NULL,
  event_type text NOT NULL,
  tenant_id uuid,
  received_at timestamp NOT NULL DEFAULT now(),
  processed_at timestamp,
  result text
);

CREATE INDEX IF NOT EXISTS webhook_inbox_source_received_idx
  ON webhook_inbox (source, received_at DESC);
