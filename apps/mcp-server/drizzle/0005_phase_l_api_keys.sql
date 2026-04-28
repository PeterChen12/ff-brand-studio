-- Phase L1 — API key issuance + auth.
-- Tenant-scoped api_keys with bcrypt-hashed secrets. Idempotent.

CREATE TABLE IF NOT EXISTS api_keys (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  prefix        text NOT NULL,
  hash          text NOT NULL,
  name          text NOT NULL,
  created_by    text,
  created_at    timestamp DEFAULT now(),
  last_used_at  timestamp,
  revoked_at    timestamp
);

CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(prefix);
CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys(tenant_id);
