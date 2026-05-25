-- 0022 — Add created_at column to webhook_deliveries.
--
-- Why: listDeliveries() in apps/mcp-server/src/lib/webhooks.ts has to
-- order by id desc (random UUID) today because the table has no time
-- column. Operators viewing the Settings → Webhooks → Recent
-- deliveries pane see rows in arbitrary order, which makes the
-- "newest first" audit log a lie.
--
-- Backfill: for existing rows, set created_at to a safe lower bound
-- (the first row's id and now() will end up at the same instant —
-- that's fine since the operator never cared about ordering of these
-- legacy rows; future rows get accurate timestamps).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS guard; CREATE INDEX IF NOT EXISTS.

ALTER TABLE webhook_deliveries
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_webhook_deliv_created_at
  ON webhook_deliveries (created_at DESC);
