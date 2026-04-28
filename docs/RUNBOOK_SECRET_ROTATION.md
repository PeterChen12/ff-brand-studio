# Secret Rotation Runbook

> Phase M4. Per-secret cadence + rotation steps + rollback. Every secret
> the Worker reads from `wrangler secret put` lives in this document.

## Cadence cheatsheet

| Secret | Cadence | Risk if leaked | Auto-rotate? |
|---|---|---|---|
| `CLERK_SECRET_KEY` | 90 days | Tenant impersonation | Manual |
| `CLERK_WEBHOOK_SECRET` | 90 days | Webhook spoofing | Manual |
| `STRIPE_SECRET_KEY` | 180 days (or on incident) | Wallet drain | Manual |
| `STRIPE_WEBHOOK_SECRET` | Same as STRIPE_SECRET_KEY | Top-up replay | Manual |
| `STRIPE_PRICE_TOPUP_*` | Never (price ID, not a secret) | n/a | n/a |
| `OPENAI_API_KEY` | 90 days | $$ burn | Manual |
| `ANTHROPIC_API_KEY` | 90 days | $$ burn | Manual |
| `FAL_KEY` | 90 days | $$ burn | Manual |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | 180 days | R2 read/write | Manual |
| `IMAGE_SIDECAR_SECRET` | 90 days | Sidecar impersonation | Manual |
| `RESEND_API_KEY` | 90 days | Email spoofing | Manual |
| `UPSTASH_REDIS_REST_TOKEN` | 90 days | Rate-limit bypass | Manual |
| `SENTRY_DSN` | Never (DSN is meant to be public-ish) | n/a | n/a |
| `LANGFUSE_*` | 90 days | Trace exfiltration | Manual |
| `DATAFORSEO_PASSWORD` | 90 days | $$ burn | Manual |
| `APIFY_TOKEN` | 90 days | $$ burn | Manual |
| `PGPASSWORD` | 90 days | DB compromise | Manual |

The platform itself never rotates; rotation is a human-driven action.
Calendar reminders live in the team's shared calendar; this runbook
is the source of truth for the steps.

---

## Generic two-key flip (every secret follows this shape)

Most providers issue keys without invalidating the old one until you
explicitly revoke it. So the safe rotation pattern is:

1. **Issue new key** at the provider dashboard.
2. **Set new key as a secret** on the Worker:
   ```
   echo "<new key>" | wrangler secret put <NAME>
   ```
3. **Verify** the Worker is reading the new key:
   - Trigger an end-to-end flow that uses it (e.g. a paid launch
     after rotating FAL).
   - Confirm logs show success in `wrangler tail`.
4. **Revoke old key** at the provider dashboard.

Rollback if the new key fails verification: re-run step 2 with the
old key (it's still active until step 4).

---

## Per-secret notes

### `CLERK_SECRET_KEY` + `CLERK_WEBHOOK_SECRET`

- Rotate together. The webhook secret is independent of the secret
  key but rotating one without the other introduces a mid-window
  state where a webhook arrives for an org the new secret key
  doesn't recognize.
- After updating the Worker, also update the
  `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` on the dashboard's
  `.env.local` (publishable key isn't a secret but pairs with
  the rotated secret).

### `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`

- Stripe lets you have multiple restricted keys live at once. Issue
  the new key as **Restricted** with only the scopes the Worker
  needs (Customers:read, Checkout Sessions:write, Webhooks:read).
- After flipping, run `node scripts/audit-wallet-integrity.mjs` to
  confirm no ledger drift was introduced during the flip window.

### `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `FAL_KEY`

- Easy: dashboard issue → wrangler secret put → revoke old.
- Smoke-test with a `dry_run=false` launch on a test SKU after the
  flip. ~$2.70 raw cost; charge it to your own wallet.

### `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`

- The sidecar shares these credentials. After rotation, redeploy
  the sidecar (`apps/image-sidecar`) with the new env values.
- Existing presigned URLs will continue to work until they expire
  (Phase H1: 10 min; Phase K3: 7 days). Rotate during a low-traffic
  window if you want to minimize stale-presigned-URL surprises.

### `IMAGE_SIDECAR_SECRET`

- Two-step flip:
  1. Set the new value on the sidecar host first (so it accepts both
     until step 2). Sidecar code currently accepts only one secret;
     for a transition window, redeploy with both old and new values
     ORed in the verification check.
  2. Set on the Worker.
- Or, simpler: schedule a 30-second outage during a quiet window and
  rotate atomically. Phase I pipeline is feature-flagged so
  production tenants are not yet affected.

### `RESEND_API_KEY`

- Issued from Resend dashboard. Free tier has no rotation policy
  but we rotate as hygiene.

### `UPSTASH_REDIS_REST_TOKEN`

- Upstash issues a fresh REST token per request. Rotate by
  generating a new token + setting it as a Worker secret. Old token
  becomes invalid immediately, so do this during a low-traffic
  window — rate limiting will fail-open during the gap (counter
  reads will fail, requests pass through unmetered).

### `PGPASSWORD`

- Hot rotation requires a brief connection refresh. Procedure:
  1. `ALTER USER postgres WITH PASSWORD '<new>';`
  2. `wrangler secret put PGPASSWORD` with the new value.
  3. The next-fired Worker request opens a new postgres-js pool
     with the new credentials. In-flight requests using the old
     pool will fail and retry; the dashboard shows them as 500s
     for ~5 seconds.
- Before rotating: run `audit-wallet-integrity.mjs` clean.
  Drift introduced during the rotation window is hard to debug.

---

## On-call drill

Every quarter, walk through this runbook end-to-end on a single
non-critical secret (e.g. `DATAFORSEO_PASSWORD`). The drill
calibrates the team's confidence before a real incident requires it.

Record the drill in `docs/INCIDENTS.md` with the date + observed
behavior + any deltas you found.
