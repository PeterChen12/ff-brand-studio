-- P1.5 — stable event_id per stage attempt. Without this, retries of
-- the same stage push generate fresh event_ids and bypass the BFR-side
-- webhook_inbox dedupe entirely (HIGH severity finding from P0+P1 review).
-- Set on the FIRST attempt, reused on every retry, cleared when
-- bfr_status resets to NULL (re-stage from scratch).
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS bfr_stage_event_id text;
