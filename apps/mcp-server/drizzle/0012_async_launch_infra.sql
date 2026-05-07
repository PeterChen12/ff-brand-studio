-- 0012_async_launch_infra.sql — Phase A foundations.
--
-- launch_runs.started_at: zombie sweeper needs a deadline (rows where
-- status='running' AND started_at < now-10m are dead worker invocations).
-- Idempotent: column add + backfill for any existing 'running' rows.
--
-- launch_runs.current_phase: surface granular pipeline progress
-- (cleanup, derive, refine_studio:iter2, lifestyle, etc) so polling
-- clients can render a progress bar.
--
-- launch_runs.async: marks a run as queue-dispatched vs sync; the
-- handler uses this for response shape decisions.
--
-- launch_runs.predicted_cents: snapshot of the pre-charge so the
-- zombie sweeper knows exactly how much to refund without needing the
-- original prediction inputs.

ALTER TABLE launch_runs
  ADD COLUMN IF NOT EXISTS started_at      timestamp,
  ADD COLUMN IF NOT EXISTS current_phase   text,
  ADD COLUMN IF NOT EXISTS async           boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS predicted_cents integer;

-- Idempotency keys (Stripe pattern). The (tenant_id, key_hash) unique
-- index lets the middleware fast-path a duplicate POST: same key →
-- replay the cached response instead of re-running the handler.
--
-- response_status / response_body capture the original handler output
-- so the replay is byte-for-byte identical (including run_id).
CREATE TABLE IF NOT EXISTS idempotency_keys (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  key_hash        text NOT NULL,
  request_hash    text NOT NULL,
  response_status integer,
  response_body   jsonb,
  created_at      timestamp DEFAULT NOW(),
  UNIQUE (tenant_id, key_hash)
);

-- TTL purge query: idempotency keys older than 24h are stale enough
-- that a "duplicate" is almost certainly a different intent. The
-- scheduled sweeper deletes them.
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_created
  ON idempotency_keys (created_at);

-- Sweeper deadline lookup: hot read during scheduled sweeps.
CREATE INDEX IF NOT EXISTS idx_launch_runs_running_started
  ON launch_runs (status, started_at)
  WHERE status = 'running';
