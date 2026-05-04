-- 0010_image_qa_judgments.sql — Image QA Layer 1 (dual judge) + Layer 3
-- (client iteration). Persists every per-image verdict so we can audit
-- which judges flag which failure modes, tune prompts, and enforce the
-- per-asset client-instruction cap.
--
-- Idempotent: CREATE IF NOT EXISTS; the index uses IF NOT EXISTS too.

CREATE TABLE IF NOT EXISTS image_qa_judgments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  asset_id        uuid NOT NULL REFERENCES platform_assets(id) ON DELETE CASCADE,
  -- 'similarity' | 'framing' | 'consistency' | 'client'
  judge_id        text NOT NULL,
  -- 'approve' | 'reject' | 'rework' (client-only)
  verdict         text NOT NULL,
  reason          text,
  model           text,
  cost_cents      integer NOT NULL DEFAULT 0,
  -- which evaluator-optimizer iteration this verdict belongs to (1-3
  -- for model judges; per-asset client iteration counter for client)
  iteration       integer NOT NULL DEFAULT 1,
  meta            jsonb,
  created_at      timestamp DEFAULT NOW()
);

-- Hot read pattern: list judgments for one asset, newest first.
CREATE INDEX IF NOT EXISTS idx_image_qa_asset_created
  ON image_qa_judgments (asset_id, created_at DESC);

-- L3 cap query: count client iterations for one asset.
CREATE INDEX IF NOT EXISTS idx_image_qa_asset_judge
  ON image_qa_judgments (asset_id, judge_id);

-- Tenant-scoped audit query.
CREATE INDEX IF NOT EXISTS idx_image_qa_tenant_created
  ON image_qa_judgments (tenant_id, created_at DESC);
