-- Phase L4 — webhook subscriptions + deliveries.
-- Idempotent.

CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  url           text NOT NULL,
  events        text[] NOT NULL,
  secret        text NOT NULL,
  created_at    timestamp DEFAULT now(),
  disabled_at   timestamp
);

CREATE INDEX IF NOT EXISTS idx_webhook_subs_tenant ON webhook_subscriptions(tenant_id);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
  event_id        uuid NOT NULL,
  event_type      text NOT NULL,
  payload         jsonb NOT NULL,
  status_code     integer,
  response_body   text,
  attempt         integer NOT NULL DEFAULT 1,
  delivered_at    timestamp,
  next_attempt_at timestamp
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliv_sub ON webhook_deliveries(subscription_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliv_pending ON webhook_deliveries(next_attempt_at)
  WHERE delivered_at IS NULL;
