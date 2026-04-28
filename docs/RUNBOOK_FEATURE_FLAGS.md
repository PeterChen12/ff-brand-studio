# Feature Flag Activation Playbook

> Every dark-shipping feature in the SaaS iteration G–M with the
> precise activation steps. Each section is independent — you can flip
> any one without touching the others.

## Phase K2 — feedback-driven regen

**What it does:** Right-click any library asset → modal with feedback
chips + free text → 30¢ regenerate via FAL Nano Banana Pro. Wallet
debits up-front, refunds on failure. Per-tenant 200/month cap (1000
ceiling).

**Pre-reqs:** `FAL_KEY` Worker secret (already set).

**Activation (per tenant):**
```sql
UPDATE tenants
SET features = features || '{"feedback_regen": true}'::jsonb
WHERE id = '<tid>';
```

**Optional cap override:**
```sql
UPDATE tenants
SET features = features || '{"max_regens_per_month": 500}'::jsonb
WHERE id = '<tid>';
```

**Smoke:** open `/library`, click Regenerate on any tile — modal
should appear with cap status `0/200`. Submit with one chip selected.
Wallet ledger gets a `-30` row with `reference_type=regenerate`.

**Rollback:** `UPDATE tenants SET features = features - 'feedback_regen' WHERE id = '<tid>';`

---

## Phase M1 — rate limiting

**What it does:** Sliding 60-second counter per tenant. Plan-aware
defaults (free 60 rpm, pro 600, enterprise 6000). Returns
`X-RateLimit-Limit/Remaining/Reset` on every request, 429 +
`Retry-After` when exhausted. Fail-open if Upstash is unreachable.

**Pre-reqs:**
1. Sign in to https://upstash.com → "Create Database" → "Redis"
   → pick a region near `us-east-1` (your Postgres region).
2. From the database overview, copy the REST URL + REST Token.

**Activation:**
```
cd apps/mcp-server
echo "https://<...>.upstash.io" | wrangler secret put UPSTASH_REDIS_REST_URL
echo "<token>" | wrangler secret put UPSTASH_REDIS_REST_TOKEN
```

That's it — no per-tenant action needed; defaults activate as soon
as both secrets are set.

**Per-tenant override:**
```sql
-- give this tenant 1200 rpm
UPDATE tenants
SET features = features || '{"rate_limit_per_min": 1200}'::jsonb
WHERE id = '<tid>';

-- disable rate limiting entirely (e.g. internal admin tooling)
UPDATE tenants
SET features = features || '{"rate_limit_disabled": true}'::jsonb
WHERE id = '<tid>';
```

**Smoke:**
```
for i in $(seq 1 70); do
  curl -s -o /dev/null -w "%{http_code} " \
    -H "Authorization: Bearer <jwt>" \
    https://ff-brand-studio-mcp.creatorain.workers.dev/v1/me/state
done
```
First ~60 requests return 200; subsequent return 429 with
`Retry-After`. Counter resets at the next minute boundary.

**Rollback:** unset the secrets — middleware fails open and serves
all requests unmetered.

---

## Phase M3 — Sentry

**What it does:** Worker errors emit a Sentry envelope; the synthetic
Playwright check (every 30 min in CI) also reports failures.

**Pre-reqs:**
1. Create a project at https://sentry.io. Pick "JavaScript" platform
   (envelope format works fine; we don't use the SDK).
2. Copy the DSN.

**Activation:**
```
echo "https://<key>@<host>/<project_id>" | wrangler secret put SENTRY_DSN
```

For the synthetic workflow:
- Add `SENTRY_DSN` as a GitHub Actions repo secret
  (Settings → Secrets and variables → Actions → New repository secret).

**Smoke:**
```
# trigger a synthetic run manually
gh workflow run synthetic --repo <your/repo>
```

If you want to confirm Worker error capture, briefly set
`captureError(env, new Error("test"))` somewhere reachable, deploy,
hit it, then revert.

**Rollback:** unset the secret. captureError() becomes a no-op.

---

## Phase I — production image pipeline

See `docs/RUNBOOK_PHASE_I_SPIKE.md` — separate doc because it has
more steps + an external service dependency (sidecar).

---

## Phase L1 — API key issuance (machine clients)

**Already on by default** for every tenant. To issue your first key:

```
curl -X POST https://ff-brand-studio-mcp.creatorain.workers.dev/v1/api-keys \
     -H "Authorization: Bearer <your_clerk_jwt>" \
     -H "Content-Type: application/json" \
     -d '{"name":"agency CI"}'
```

The response includes the full `ff_live_*` secret exactly once. Save
it; you cannot retrieve it again. Use as `Authorization: Bearer ff_live_*`
on subsequent API calls.

**Revoke:** `DELETE /v1/api-keys/<id>` with your Clerk JWT.

---

## Phase L4 — webhooks

**Already on by default.** Subscribe a URL:

```
curl -X POST https://ff-brand-studio-mcp.creatorain.workers.dev/v1/webhooks \
     -H "Authorization: Bearer <ff_live_or_clerk_jwt>" \
     -H "Content-Type: application/json" \
     -d '{"url":"https://your-receiver/hook","events":["launch.complete","listing.publish"]}'
```

The response includes the HMAC secret exactly once. Verify deliveries:

```python
# Python receiver verification
import hmac, hashlib

def verify(secret, body, sig_header):
    parts = dict(p.split("=") for p in sig_header.split(","))
    expected = hmac.new(secret.encode(), f"{parts['t']}.{body}".encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(parts["v1"], expected)
```

Failed deliveries land in the `webhook_deliveries` table with
`next_attempt_at` populated for the future cron-driven retry
(scheduler ships in Phase M+).
