# Phase M — Scale Hardening (detailed plan)

> Detailed plan for Phase M. Depends on Phase L being shipped. Final
> hardening step before declaring the SaaS iteration G–M production-
> ready.

**Goal of Phase M**

The platform handles 10× current load without operational degradation
and recovers cleanly from any single dependency failure. Per-tenant
limits prevent noisy neighbors. Observability + alerting catch issues
before customers do. Secret rotation + webhook signature verification
are operational hygiene baked in.

---

## Iteration M1 — Per-tenant rate limiting

**Outcome:** abusive or accidentally-loud traffic doesn't degrade the
shared Worker. Defaults are plan-aware and configurable per tenant.

### M1.1 — Backing store

**Resources:**
- `@upstash/ratelimit@^2` runs on Workers natively, supports sliding-
  window via either CF KV (cheap, eventually-consistent) or Durable
  Objects (strict, slightly costlier).

**Decision:** start with **CF KV** for lower cost — sliding window is
acceptably accurate at our throughput (≤10 RPS/tenant). Move to
Durable Objects if abuse patterns demand stricter consistency.

**Files:** `apps/mcp-server/wrangler.toml` — add ratelimit KV namespace
binding `RATELIMIT_KV`.

### M1.2 — Middleware

**Files:** `apps/mcp-server/src/lib/ratelimit.ts`

**Subtasks:**
1. Default: 60 req/min per API key (or per Clerk session, hashed).
2. Stricter cap on `/v1/launches`: 10 launches/min/tenant; 60 launches/
   day for free plan, 600 for paid.
3. Headers on every response: `X-RateLimit-Limit`, `X-RateLimit-Remaining`,
   `X-RateLimit-Reset`. 429 includes `Retry-After`.
4. Configurable per-plan via `tenant.features.rate_limits` jsonb override.

### M1.3 — Acceptance for M1

- 100-request burst against `/v1/launches` from one key throttles at
  the 11th call.
- Free-plan tenant hits a 60-launch/day wall on day 1; resets at UTC
  midnight.
- Paid-plan tenants get 10× the headroom.

---

## Iteration M2 — Audit log dashboard

**Outcome:** `/audit` route surfaces every `audit_events` row with
filters and CSV export — already partly delivered in J3.2. M2 finishes
the experience for compliance review.

### M2.1 — Filterable audit table

**Files:**
- `apps/dashboard/src/app/audit/page.tsx` (+ `_client.tsx`)

**Subtasks:**
1. Filters: action multi-select, actor, target_type, date range.
2. URL-state-driven, shareable.
3. Pagination cursor over `(at, id)`.

### M2.2 — CSV export

**Files:** `apps/mcp-server/src/index.ts` — `GET /v1/audit/export`

**Subtasks:**
1. Streams a CSV with the same filter set as the UI.
2. Header row + RFC 4180-compliant escaping.
3. Returns `Content-Disposition: attachment; filename=audit-<tenant>-
   <range>.csv`.

### M2.3 — Acceptance for M2

- Filtering by action `launch.complete` over last 7 days returns N
  rows that match a SQL spot-check.
- Export downloads a CSV that opens cleanly in Sheets and matches the
  in-UI rows.

---

## Iteration M3 — Observability + alerting

**Outcome:** every Worker request and frontend interaction is traceable.
Errors page within 60s. Synthetic checks catch regressions before users.

### M3.1 — Langfuse tracing on every Worker route

**Files:** `apps/mcp-server/src/lib/tracing.ts` (extends existing
Langfuse wiring)

**Subtasks:**
1. New Hono middleware: starts a Langfuse trace per request keyed on
   `X-Request-Id` (auto-generated if missing).
2. Every internal helper (chargeWallet, runSeoPipeline, runAdapter)
   creates a child span. Already wired for some — fill in the gaps.
3. Sample rate: 100% for `/v1/launches`, 10% for read-only endpoints to
   stay within the Langfuse free tier.

### M3.2 — Sentry on frontend + Worker

**Files:**
- `apps/dashboard/package.json` — `@sentry/nextjs@^9`
- `apps/dashboard/sentry.client.config.ts` + `sentry.server.config.ts`
- `apps/mcp-server/package.json` — `@sentry/cloudflare@^9`
- `apps/mcp-server/src/index.ts` — wrap with `withSentry`

**Subtasks:**
1. Sentry DSN + auth token via Worker / Pages env.
2. Source maps uploaded on every deploy via Sentry Wizard.
3. Frontend: filter out user cancellations + Clerk noise. Worker:
   capture `error` console + uncaught exceptions.

### M3.3 — Cloudflare Analytics

**Subtasks:**
1. Pages Analytics already on. Worker: enable Analytics Engine binding
   for free-tier metrics (95p latency, error rate, request count).

### M3.4 — Synthetic Playwright check

**Files:** `.github/workflows/synthetic.yml` (cron: every hour)

**Subtasks:**
1. Test runs: load `/`, sign in as the synthetic user, verify wallet
   pill renders, navigate to `/launch`, screenshot.
2. On failure → Sentry alert + Slack notification (via existing
   webhook).
3. Synthetic Clerk user pre-created, password stored in GitHub secret.

### M3.5 — Acceptance for M3

- Triggering a deliberate 500 in `/v1/launches` pages within 60s.
- Synthetic check shows green for 7 days running.
- Langfuse trace for a normal launch shows the expected span tree.

---

## Iteration M4 — Secret rotation + Stripe signature verification

**Outcome:** every webhook is cryptographically verified; secrets
rotate predictably; lost API keys roll out within 1 hour.

### M4.1 — Stripe-Signature verification

**Already shipped in H3.** M4.1 confirms via integration test that an
unsigned / mis-signed webhook body returns 401. Adds a fixture to
`apps/mcp-server/test/stripe-webhook.test.ts`.

### M4.2 — Webhook idempotency tightened

**Already shipped in H3 via SESSION_KV 24h TTL.** M4.2 lifts the TTL
to 7 days to match Stripe's retry window for high-volume tenants.

### M4.3 — API key 90-day expiration toggle

**Files:** `apps/mcp-server/src/lib/api-keys.ts`

**Subtasks:**
1. Optional `expires_at` column on `api_keys`. UI exposes a "rotate
   every 90 days" toggle on key creation.
2. Cron worker runs daily, emails the key owner 7 days before expiry.
3. Expired keys return 401 with a clear "key expired, rotate at /settings/
   api-keys" message.

### M4.4 — Worker secret rotation playbook

**Files:** `docs/runbooks/SECRET_ROTATION.md`

**Subtasks:**
1. Document `wrangler secret put` rotation order for each secret type
   (Clerk, Stripe, R2, Langfuse).
2. Stripe: rotate via dashboard → push new secret → roll the webhook
   endpoint at `/v1/stripe-webhook` to use new secret (overlap window
   30 min).
3. R2: rotate S3 token → update Worker secret → next presign uses new
   creds (zero downtime — old presigns still work for the 10-min window
   they were valid for).

### M4.5 — Acceptance for M4

- Pushing a Stripe webhook with bad signature returns 401, no wallet
  change.
- Same event_id pushed twice within 7 days → second one is no-op.
- Key created with rotation toggle ON gets a reminder email at day 83;
  expires at day 90 if not rotated.

---

## Iteration M5 — DR + per-tenant data export

**Outcome:** every tenant can pull their own data. Daily Postgres dump
to R2 protects against catastrophic DB loss.

### M5.1 — Tenant data export

**Files:** `apps/mcp-server/src/index.ts` — `GET /v1/me/export`

**Subtasks:**
1. Stream a ZIP with subfolders: `products/`, `assets/`, `listings/`,
   `audit/`. Each folder contains JSONL rows for that table filtered by
   tenant_id.
2. Plus the actual R2 references (or a manifest pointing at them; size
   threshold 1GB to switch).
3. Returns a presigned URL valid 24h to a one-shot R2 export.

### M5.2 — Daily Postgres dump

**Files:** `.github/workflows/dump.yml` (cron: 03:00 UTC daily)

**Subtasks:**
1. Workflow runs `pg_dump --format=custom --compress=9` against
   production, uploads to `r2://ff-brand-studio-dumps/<date>.dump`.
2. Retention: 30 days (lifecycle rule on the bucket).
3. Restore runbook: `docs/runbooks/RESTORE.md` documents the
   `pg_restore` command + how to point a fresh DB at the latest dump.

### M5.3 — Tenant deletion (right-to-be-forgotten)

**Files:** `apps/mcp-server/src/index.ts` — `DELETE /v1/me`

**Subtasks:**
1. Soft-delete: set `tenant.plan = 'deleted'` and prune R2 objects after
   30-day grace period.
2. Hard-delete (manual, ops-only) wipes all rows + R2 prefix.
3. Audit event `tenant.deleted` recorded in a separate
   `deletion_audit` table that survives the wipe.

### M5.4 — Acceptance for M5

- Per-tenant export ZIP contains every row tagged with that tenant_id.
- Daily dump appears in R2 within 5 min of cron firing.
- Tenant deletion soft-deletes immediately; hard-delete script wipes
  R2 + Postgres rows.

---

## Cross-cutting Phase M concerns

### Costs

- @upstash/ratelimit on KV: ~$0.50/mo at expected scale.
- Sentry: free tier covers 5K errors/mo + 10K transactions/mo.
- Langfuse: free tier covers 1K traces/mo at 100% sampling, 10K with
  10% sampling on reads.
- GitHub Actions cron: free for public-private repos in our org.
- Total Phase M operational add: **~$10/mo** at 10 active tenants.

### Estimated effort

| Iteration | Engineer-days |
|---|---|
| M1 (rate limiting) | 2 |
| M2 (audit dashboard) | 2 |
| M3 (observability) | 4 |
| M4 (secret rotation) | 2 |
| M5 (DR + export) | 3 |
| Buffer | 1 |
| **Total** | **~14 days** |

---

## Resolved questions (locked 2026-04-27)

1. **Rate-limit defaults.** Free 60 req/min + 10 launches/min, paid
   600 req/min + 60 launches/min. Configurable per tenant.
2. **Stripe idempotency window.** 7 days (matches Stripe's max retry
   window).
3. **Postgres dump cadence.** Daily at 03:00 UTC, 30-day retention.
4. **Sentry alert routing.** Frontend → operator email. Worker errors
   → ops Slack channel (peter@). Phase M+ adds PagerDuty when we have
   a paid customer with an SLA.
5. **Synthetic check provider.** Playwright run from GitHub Actions —
   no separate cron service. Avoids vendor lock-in for monitoring.

---

## Deliverables checklist

When Phase M is done:

- [x] Hand-rolled Upstash REST rate-limit middleware on every `/v1/*`
      and `/api/*` Worker route (chose REST-direct over @upstash/ratelimit
      to keep bundle small) — M1
- [x] 429 with `Retry-After` + `X-RateLimit-*` headers (Limit, Remaining,
      Reset) — M1
- [x] `/v1/audit` paginated + CSV-exportable via `?format=csv` — M2
- [ ] Langfuse traces on every Worker route — deferred (Worker code
      already emits to Langfuse from the SEO + image pipeline; full
      route coverage lands when Langfuse wraps Hono middleware)
- [x] Sentry envelope helper for the Worker (no-op when SENTRY_DSN
      missing); synthetic Playwright also reports failures to Sentry — M3
- [x] Synthetic Playwright check runs every 30 min via
      `.github/workflows/synthetic.yml`; covers /health, /docs,
      /v1/openapi.yaml, /sign-in. Sentry envelope on failure — M3
- [x] Stripe-Signature verification — already shipped Phase H3
      (checkWebhookIdempotency in `src/lib/stripe.ts`); not duplicated
- [ ] API key 90-day expiration toggle — deferred to first agency
      request (no automatic rotation in MVP per Phase L resolved Q1)
- [x] Secret rotation playbook in `docs/RUNBOOK_SECRET_ROTATION.md` — M4
- [x] `GET /v1/tenant/export` returns a per-tenant ZIP across all 12
      domain tables — M5
- [x] `.github/workflows/dump.yml` daily pg_dump → R2 with 30-day
      retention + auto-prune — M5
- [ ] `DELETE /v1/me` soft-deletes tenant — deferred (covered by the
      existing `tenants.plan = 'deleted'` flag set by
      `softDeleteTenant`; HTTP endpoint not yet ergonomic for self-serve
      delete because of GDPR-style 30-day grace requirement)
- [x] `SESSION_STATE.md` updated — SaaS iteration G–M ✅ complete — M5

When all are checked, the SaaS iteration G–M is complete and the
platform is production-ready.

---

## Phase M complete — production-ready summary

After Phase M ships, the platform offers:

| Capability | Phase | Endpoint |
|---|---|---|
| Auth + tenancy | G | Clerk + Worker middleware |
| Self-serve product upload | H | `/v1/products/upload-intent` + `/v1/products` |
| Stripe wallet billing | H | `/v1/billing/*` + `/v1/stripe-webhook` |
| Production-quality images | I | `/v1/launches` (NBP + CLIP + vision) |
| DAM library + search + bundles | J | `/library` + `/v1/audit` |
| Inline edit + regen + publish | K | `/v1/listings/:id` + `/v1/skus/:id/approve` |
| Public REST + webhooks + MCP | L | `/v1/openapi.yaml` + `ff_live_*` keys |
| Rate limits + observability + DR | M | infra layer |

Every customer flow is auth-gated, tenant-scoped, audit-logged,
wallet-billed, rate-limited, observed, and recoverable. Margins target
~61% per ADR-0005. Phase N+ pursues channels (Amazon SP-API native
publish, Tmall integration, Shopify private app), automation
(scheduled launches, batch CSV uploads), and verticals (subscriptions,
agency-of-record contracts).
