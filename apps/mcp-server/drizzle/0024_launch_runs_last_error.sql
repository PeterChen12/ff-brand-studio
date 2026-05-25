-- 0024 — Add last_error column to launch_runs.
--
-- Why: today when a run ends `failed` or `hitl_blocked`, the reason
-- (which CLIP step exhausted iterations, which model call 5xx'd, which
-- crop got rejected by the dual-judge) lives in Langfuse traces +
-- audit_events.metadata blobs. Operators viewing the library page
-- see "Awaiting review" with no hint of why — they have to context-
-- switch to Langfuse or psql, neither of which most operators have
-- access to.
--
-- This column captures a short human-readable summary of the most
-- recent failure / block reason, written by the pipeline at the
-- moment it ends a run. Cap at 1000 chars in app code (no DB CHECK
-- since postgres TEXT is unbounded; the cap is enforced by the
-- writer for forward-compat with rows-as-jsonb).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE launch_runs
  ADD COLUMN IF NOT EXISTS last_error TEXT;
