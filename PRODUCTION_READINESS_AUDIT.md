# Production Readiness Audit — what's missing for B2B SaaS

**Date:** 2026-05-13
**Scope:** ff-brand-studio (worker + dashboard) + buyfishingrod-admin integration

The audit categorizes problems only — no proposed fixes, no implementation
plans. Every claim is grounded in current code state (verified at commit
`9773e83` on master).

Severity legend:
- 🔴 **Blocking** — would gate an enterprise sale
- 🟠 **High** — visible in normal operation; embarrassing to expose
- 🟡 **Medium** — latent risk that hasn't bitten yet but will
- 🟢 **Hygiene** — accumulates technical debt

---

## 1. Backend code stability

### 1.1 Monolithic hot files (🟠 High)

- `apps/mcp-server/src/index.ts` is **3,174 lines** with 42 endpoints
  inline. One change to one endpoint requires scrolling past the other 41.
- `apps/mcp-server/src/orchestrator/launch_pipeline.ts` is **1,147 lines**
  doing tenant resolution, charge accounting, SEO pipeline orchestration,
  grounding loop, persistence, and audit emission in one function.
- `apps/mcp-server/src/db/schema.ts` is **544 lines** with ~20 tables,
  all in one module. Adding a new table risks merge conflicts.

### 1.2 Database connection floor (🔴 Blocking at scale)

`apps/mcp-server/src/db/client.ts:7` creates a `postgres()` client with
`max: 1`. **A single connection per worker invocation.** On Cloudflare's
multi-tenant runtime this is acceptable for a per-request workload but
collapses if anything inside the request needs concurrent queries
(grounding's parallel `Promise.all` over surfaces, for instance, can
all want database access). No connection pool, no PgBouncer in front.

### 1.3 No staging environment (🔴 Blocking)

There is one Cloudflare Worker deployment URL
(`ff-brand-studio-mcp.creatorain.workers.dev`) and one Postgres instance
(`170.9.252.93:5433/ff_brand_studio`). The .github/workflows/deploy.yml
ships directly to that target. **Any breaking change hits prod.** The
F1 safety pin "ship behind env var, wait one cycle" was only meaningful
because the env var was the staging proxy.

### 1.4 Single-region database (🔴 Blocking for enterprise)

Postgres is a single VM at `170.9.252.93` (US-East). No read replica, no
multi-region failover, no documented backup policy. The worker itself is
global; the database isn't. Worker invocations from Asia-Pacific pay
~250ms RTT to the database on every query. The webhook handler at BFR's
admin alone reads + writes 3 rows; that's 750ms of latency floor.

### 1.5 Manual deploys (🟠 High)

The CI workflows exist but the wrangler deploy step in this codebase
runs from `peter@creatorain.com`'s laptop with the global Cloudflare
API key. No deploy locks. No "deployed at commit X" tag emitted to a
status endpoint. Rolling back means `git reset --hard <prev>` + manual
re-deploy.

### 1.6 No transactional guarantees across pipeline + ledger (🟠 High)

`pipeline/index.ts` charges wallet at each step via `chargeAndAccount()`
which mutates a local `budget` counter, then a separate `wallet_ledger`
insert happens later. If the worker crashes mid-pipeline, the ledger is
out of sync with the actual state. There's a "zombie sweeper" cron
(`launch.refund_zombie` audit action) that tries to detect this, but it's
a 5-minute polling reconciler, not a transaction.

### 1.7 Cost cap halts AFTER charging, not before (🟠 High)

The audit doc (`BEARKING_UPLOAD_AUDIT.md` item 4.6) flagged this and the
F1 plan documented it as deferred polish (D9 #6). Today
`pipeline/index.ts:77-86` debits before checking budget headroom. A
launch can exceed its cap by one step's worth of cost before halting.

### 1.8 Secrets without rotation policy (🟠 High)

Production secrets — `ANTHROPIC_API_KEY`, `FAL_KEY`, `OPENAI_API_KEY`,
`STRIPE_SECRET_KEY`, `CREDENTIAL_KEK_HEX`, `FF_STUDIO_WEBHOOK_SECRET`,
`CLERK_SECRET_KEY` — are set via `wrangler secret put` once and never
rotated. The KEK protects `integration_credentials` rows; if it leaks,
re-encrypting requires the old KEK present. No rotation tooling exists.

### 1.9 Hand-rolled migrations (🟡 Medium)

Schema migrations are Node.js scripts in `apps/mcp-server/scripts/` (e.g.
`apply-migration.mjs`). No transactional wrapping, no down-migration
support, no schema-version table. Migrations 0001–0015 have been applied
chronologically; if one fails halfway, the schema is in an undefined state.

### 1.10 Per-tenant data isolation relies on developer discipline (🟠 High)

Every endpoint that reads tenant-scoped data must call
`visibleTenantIds(tenant)` and `WHERE tenant_id IN (...)`. There's no
row-level security at the database, no Drizzle middleware enforcing this.
A new endpoint that forgets the filter can exfiltrate cross-tenant data
silently. Has happened before in similar codebases.

### 1.11 `tenant.features` is a free-form jsonb bag (🟡 Medium)

15+ keys (`production_pipeline`, `default_platforms`, `feedback_regen`,
`adapter_stage_enabled`, `regulated_category`, `passthrough_enabled`,
`amazon_a_plus_grid`, `rate_limit_per_min`, `default_output_langs`,
`default_quality_preset`, `publish_destinations`, `language_display`,
`brand_hex`, `developer_mode`, `agentic_upload_enabled`...). No
centralized typed schema. The dashboard's `TenantFeatures` interface and
the worker's view drift independently. A typo on a flag name silently
disables the feature.

### 1.12 No automated rollback (🟡 Medium)

If a deploy regresses production, recovery is: `git revert` the bad
commit, `wrangler deploy` again from peter's laptop. That's a 5-minute
operator-in-the-loop window. Cloudflare Workers supports versioned
deploys but no shortcut is wired.

### 1.13 Worker bundle approaching the 10MB cap (🟡 Medium)

Most recent deploy reports `Total Upload: ~3.5 MiB`. F7 considered
bundling fonts and would have added ~3MB. Cloudflare's free-tier cap is
10MB. There's runway but every new SDK we pull in (Tesseract, fast-check,
property-based test libs, Stripe SDK additions) eats into it. No
bundle-size tracking in CI.

### 1.14 Static category enum (🟡 Medium)

`PRODUCT_CATEGORIES` is a TypeScript const tuple in
`lib/derive-product-metadata.ts`. Adding "outdoor-fishing" or
"camping-gear" requires a code change + redeploy. The agentic classifier
output is bounded by this list.

### 1.15 `Math.random` in QA sampling (🟢 Hygiene)

BEARKING audit issue 4.9 documented this. `forceWhiteBackground`'s
corner sampling uses `Math.random()` — re-running QA on the same image
produces different pass/fail outcomes. Reproducibility broken.

---

## 2. Product-image performance

### 2.1 Synchronous request floor of 90-120 seconds (🔴 Blocking)

A full-pipeline launch (cleanup → derive → 4 refines → lifestyle → 3
composites → banner + SEO + grounding) takes 90-120 seconds wall-clock.
The Cloudflare Workers request cap is 5 minutes; we're at 30-40% of that
budget every launch. There's no async/queue mode. The client (dashboard)
holds an open connection the entire time. Mobile clients on flaky
networks can't reliably complete a launch.

### 2.2 $6.20 per launch is steep (🔴 Blocking for catalog-scale)

12 image slots × $0.50 + 2 listing surfaces × $0.10 = $6.20. For a
100-SKU catalog onboard, that's $620 in image-gen alone, before any
regen iterations. The "best-of-input passthrough" (F3) can save $0.50
per launch when the input is clean, but most vendor batches aren't clean.

### 2.3 Serial pipeline stages (🟠 High)

`pipeline/index.ts` runs cleanup → derive → refine_all_crops →
lifestyle → composites → banner sequentially. Only the 4 refines fire
in parallel. Cleanup + derive are each ~5-15s and could overlap with
nothing. Lifestyle + composites + banner could all run after refine.
The runtime is the sum of stage times, not the max.

### 2.4 Single-reference bottleneck (🟠 High)

`pipeline/index.ts:104` does `referenceR2Keys[0]` and discards N−1
vendor angles. If the operator drops 8 reference images, only the first
one informs every downstream worker. When the first happens to be an
awkward angle (back of the package, watermark, low fill), the generated
assets silently inherit the bad framing. BEARKING audit issue 4.1; D6
plan deferred.

### 2.5 Stub workers still return fake R2 paths (🟠 High)

`apps/mcp-server/src/orchestrator/workers/{white_bg,lifestyle,variant,video}.ts`
are placeholder stubs returning fake R2 paths. The real production work
happens via `runProductionPipeline`. BEARKING audit issue 4.2; D7 plan
deferred. Two callers + two code paths = drift.

### 2.6 No input-quality fail-fast (🟠 High)

The pipeline runs cleanup → derive → refine on a 400×400 watermarked
vendor thumbnail just as eagerly as on a 4000×4000 studio shot. We
charge the wallet, run FAL, produce something that'll inevitably fail
QA → retry up to 3× → still fail → land in HITL. That's $1.50–$3.00 of
wallet burned on a launch that was never going to succeed. BEARKING
audit issue 4.3; D8 plan deferred.

### 2.7 `measureProductFill` is O(W·H) JS pixel walk (🟡 Medium)

`apps/mcp-server/src/lib/image_post.ts:115-151`: 27M raw-pixel reads
per QA pass on a 3000×3000 buffer in pure JS. Sharp's native `stats()`
+ `trim()` would do this in ~50ms. Today it's ~600ms per call. BEARKING
audit issue 4.4; D9 plan deferred.

### 2.8 No cross-slot image dedup (🟡 Medium)

Amazon-main and Shopify-main are visually near-identical (white
background, product centered) but generate separately. ~$0.50 wasted per
launch when both marketplaces are picked.

### 2.9 No FAL retry-with-backoff distinction (🟡 Medium)

`pipeline/iterate.ts` counts a FAL 5xx as one of the 3 iterations,
identical to a "vision rejected the output" failure. Transient infra
failures should retry without consuming the budget. BEARKING audit
issue 4.7; deferred.

### 2.10 No refine-call dedup (🟡 Medium)

Each `(platform, slot)` calls FAL refine independently even when input
+ crop oracle + prompt are bit-identical. No hash → cached-result table.
BEARKING audit issue 4.10; deferred.

### 2.11 CLIP threshold hardcoded per kind (🟡 Medium)

All non-multi product kinds use 0.78. No per-product override. Some
product classes (fine jewelry, watches) need stricter; some (apparel
flat-lay) need looser. BEARKING audit issue 4.5; deferred.

### 2.12 `forceWhiteBackground` tolerance hardcoded (🟢 Hygiene)

`lib/image_post.ts:29` uses 8 as the tolerance. No per-tenant config.
Brands with non-white pack shots fail. BEARKING audit issue 4.8.

### 2.13 Lifestyle scene library is curated finite (🟢 Hygiene)

`pipeline/scene-library.ts` ships ~30 scene strings across 10 groups.
No semantic search over a larger pool, no per-tenant scene library, no
LLM-generated freshness. Two products in the same (group, kind, seed
modulo) get identical scenes.

---

## 3. Missing orchestration / chaining / routing / parallelization / LLM-as-judge structure

### 3.1 No formal queue or async-launch system (🔴 Blocking for catalog ops)

Cloudflare Queues was identified as the path forward and never adopted.
Every launch is a synchronous request. There's no "submit 50 products
and walk away" mode. Phase D iter 01 added a client-side launch queue
in the dashboard, but the worker side still processes one launch per
HTTP request.

### 3.2 `iterate.ts` is a hand-rolled state machine (🟡 Medium)

130 lines of inline while-loop with best-key tracking, FAIR fallback,
first-iter-only dual-judge escalation, infra-failure differentiation,
prompt amendment. This was attempted twice for migration to the
`runQualityGate` abstraction and rejected both times because the shape
genuinely doesn't fit. The trade-off is paid: any future maintainer
must understand the full state machine.

### 3.3 No circuit breaker (🟠 High)

If FAL or Anthropic or OpenAI or DataForSEO goes down, every in-flight
launch retries 3× and eats the full timeout budget. No "stop calling
this provider for 60s after 5 consecutive failures" pattern. A 30-minute
provider outage drains thousands of wallet cents per tenant.

### 3.4 No DAG-based orchestration (🟠 High)

The pipeline's actual data flow is a DAG: cleanup feeds derive, derive
feeds refine, refine feeds composite + lifestyle + banner, etc. Today
this is encoded as a sequential async function. There's no first-class
DAG executor. Re-running a single stage (e.g., "just re-do the lifestyle")
isn't possible without re-running everything upstream.

### 3.5 No durable state for in-flight pipelines (🟠 High)

If a worker process dies mid-pipeline (Cloudflare's 5-minute cap,
restart, deploy), the launch_runs row is left in `running` state. The
zombie sweeper eventually marks it failed and refunds, but partial R2
artifacts stay (no GC), and the operator sees a "succeeded with errors"
status. No checkpointing.

### 3.6 Single-judge claims-grounding for most tenants (🟠 High)

Phase F iter 06 added the dual-judge ensemble but gated it behind
`tenant.features.regulated_category`. For non-regulated tenants, every
listing's claims pass through one Haiku call. A model false-negative
(judge says GROUNDED on a hallucinated claim) ships the bad copy.

### 3.7 Defect router only routes the PROMPT, not the MODEL (🟡 Medium)

`pipeline/defect-router.ts` (F4) picks a specialist prompt based on
defect category. But the FAL model used (gemini-3-pro-image-preview)
stays the same. There's no "if this is a text-stripping task, use a
different model better at compositing" routing.

### 3.8 No model A/B testing infrastructure (🟡 Medium)

Quality presets (budget/balanced/premium) hardcode model choices. No
canary deployment of model versions. No measurement of compliance-pass
rate per model. No automated routing-table tuning.

### 3.9 No prompt versioning or A/B test (🟡 Medium)

System prompts (claims-grounding, SEO surfaces, defect specialist) are
inline TypeScript constants. Changing one means a code deploy. Two
parallel prompts can't be tested. No prompt-effectiveness telemetry.

### 3.10 Grounding parallelizes across surfaces, not across products (🟡 Medium)

Within one launch, the N surfaces grade in parallel (E5 Opportunity E).
Across launches in a vendor batch, each launch is its own sequential
chain. The agentic-upload manifest creates N launches that each go
through the same pipeline serially.

### 3.11 No structured event bus (🟡 Medium)

Webhook fan-out via `WEBHOOK_FAN_OUT` set is the only async path.
Internal events (a tenant changed features, an asset got approved,
wallet hit threshold) have no subscriber model. Adding a "notify
operator when wallet < $5" feature requires polling.

### 3.12 No saga / compensation pattern (🟡 Medium)

If grounding fails after image generation succeeded, the images are in
R2, the wallet is debited, but the listing copy is "pending HITL." No
saga rolls back to "draft" state cleanly. Partial success states leak.

### 3.13 No LLM-as-judge for image content beyond compliance (🟡 Medium)

`compliance/dual_judge.ts` judges *similarity* and *framing*. No judge
checks "does this image actually depict the product the listing claims?"
(claim-image grounding). A hallucinated wrong-product image with a
correct listing description ships if it passes the framing judge.

### 3.14 No multi-judge ensemble for image rejection (🟡 Medium)

The dual judge is "similarity + framing" — both must approve. Real
ensemble would be N independent judges with majority vote. Today's
"both" rule is closer to a unanimous-2 pattern than a real ensemble.

### 3.15 Agentic classifier doesn't iterate (🟡 Medium)

`lib/agentic-folder-classifier.ts` is a single Sonnet call. No
chain-of-thought, no self-critique, no operator-override-then-re-classify
loop. Operator either accepts the manifest or starts over.

### 3.16 No batch operations on the worker (🟡 Medium)

`POST /v1/inbox/bulk-approve` is the only bulk endpoint. Bulk-launch,
bulk-regen, bulk-publish, bulk-stage don't exist. A vendor batch
operation is N sequential API calls from the client.

### 3.17 Stub workers in `orchestrator/workers/` (🟡 Medium)

Re-flagging from §2.5 because it's also an orchestration concern:
two different code paths produce nominally the same output. Stale
caller could be invoking the stubs and silently getting garbage.

---

## 4. B2B SaaS gaps

### 4.1 No SSO beyond Clerk defaults (🔴 Blocking enterprise sales)

Clerk supports SAML/OIDC connectors on its Business plan but they're not
configured here. Enterprise IT requires SSO via Okta / Azure AD / etc.
"We log in via email + password" is a deal-breaker for buyers above ~500
seats.

### 4.2 No DPA / SOC2 / ISO27001 posture (🔴 Blocking enterprise)

There's no Data Processing Agreement template. No SOC2 audit trail.
No ISO27001 control documentation. Enterprise legal won't sign without.

### 4.3 No team / permission model (🔴 Blocking)

`tenant.clerk_org_id` is one Clerk org per tenant. Within that org,
Clerk's default role set is `admin` / `member`. There's no concept of
"reviewer-only" (can approve but not regenerate), "billing-only" (can
top up but not launch), "operator" (can launch but not edit brand
settings). One role does everything.

### 4.4 No customer-facing usage analytics (🟠 High)

Operators see `/costs` page with raw numbers. There's no time-series
of launches/month, no per-SKU cost attribution chart, no cost-per-revenue
metric (we don't even track revenue from listings the customer publishes).

### 4.5 No billing portal / invoice history (🟠 High)

Stripe top-up is one-shot: "give me $25 of credit." No invoice download.
No auto-replenish ("top up when balance < $10"). No "set monthly
spending cap." No PO-based invoicing for enterprise customers who can't
pay with credit card.

### 4.6 No status page (🟠 High)

When the worker errors, customers see HTTP 500 with no context. No
public status page (statuspage.io equivalent). No "we're aware of an
issue with FAL, retrying" banner in the dashboard. No incident
communication channel.

### 4.7 No customer SDK in any language (🟠 High)

Direct API consumers (like BFR) hand-write fetch calls with HMAC
signing. No npm package, no Python package, no example code. Onboarding
a new integration partner is a documentation-and-pray exercise.

### 4.8 No GDPR data-delete flow (🟠 High)

A tenant can `/v1/tenant/export` their data but can't trigger a delete.
GDPR Article 17 ("right to erasure") would require either a manual ops
ticket or a UI button — neither exists.

### 4.9 No API rate-limit headers (🟡 Medium)

`rateLimitMiddleware` exists but doesn't emit `X-RateLimit-Remaining`
/ `X-RateLimit-Reset` headers per the conventional API design. Clients
can't gracefully back off; they hit the limit and get rejected.

### 4.10 No webhook signature rotation flow (🟡 Medium)

`FF_STUDIO_WEBHOOK_SECRET` is one secret per tenant. If it leaks,
rotation requires (a) generate new, (b) tell customer, (c) both deploy
the new value, (d) flip atomically — no tooling for this. Customers
who care about security will ask for it.

### 4.11 No webhook delivery dashboard (🟡 Medium)

When BFR's listener returns 5xx, the studio retries via the existing
schedule (1m, 5m, 30m, 2h, 12h). Customers have no UI to see "delivery
attempt 3 failed with body X." Debugging integration issues = ask
peter to query `webhook_deliveries` table.

### 4.12 No SLA documentation (🟡 Medium)

What uptime do we promise? What's the support response time? What's
the per-request latency P99? None of this is written down. Enterprise
buyers will ask.

### 4.13 No on-call runbook (🟡 Medium)

If the worker errors at 3am, what does the operator do? No documented
runbook. The wrangler deploy creds + Cloudflare dashboard access are on
one laptop.

### 4.14 No public docs site (🟡 Medium)

The repo has a README and inline JSDoc. There's no developer.ff-brand-studio.com
or similar. The OpenAPI spec at `/v1/openapi.yaml` exists but no consumer-
friendly rendering.

### 4.15 PII handling not documented (🟡 Medium)

Product descriptions could contain customer info (e.g., a vendor
includes a contact email in the description). No documented policy on
PII redaction, retention, or where it propagates (audit_events, R2
captures, Sentry envelopes).

### 4.16 No DR plan (🟡 Medium)

If the Postgres VM at `170.9.252.93` fails: there's no documented
recovery plan. No backups schedule. No tested restore procedure.

### 4.17 No multi-currency (🟢 Hygiene)

Wallet ledger is in cents (USD). A European customer paying in EUR or a
Japanese customer paying in JPY would need currency conversion, FX
handling, multi-currency reporting. None exists.

---

## 5. Code organization / maintainability

### 5.1 Tests cover the easy bits, not the hot bits (🟠 High)

141 tests across ~5,500 LoC of source. By value:
- Quality-gate abstraction: 7 tests (good)
- Defect router: 23 tests (good)
- Claims grounding (with golden masters): 13 tests (good)
- Best-of-input: 12 tests (good)
- Agentic classifier: 6 tests (acceptable)
- Sharp text overlay: 9 tests (good)
- The 1,147-line launch_pipeline.ts: **2 indirect tests** via grounding-snapshot

The orchestrator that runs every customer launch has near-zero
direct coverage. Refactoring it is high-risk because regressions
won't surface in CI.

### 5.2 No E2E browser tests of the dashboard (🟠 High)

Playwright/Cypress are not configured. The 4 mode-tabs (Launch wizard,
inbox, library, agentic upload) have only unit-level coverage. A
visual regression in Pages auto-deploy won't be caught.

### 5.3 No contract tests between studio + BFR (🟠 High)

The studio adapter posts to BFR's `/api/integrations/ff-brand-studio/stage-product`
endpoint. The envelope shape is documented in code comments. There's no
schema test that fails CI when one side changes the contract without
the other side knowing.

### 5.4 OpenAPI spec may be stale (🟡 Medium)

`/v1/openapi.yaml` is served by the worker but I don't see automated
generation from the Zod schemas. Drift between actual endpoint behavior
and documented spec is silent.

### 5.5 No precommit hooks (🟡 Medium)

Typecheck runs in CI but not locally. Devs (or me) ship code that
breaks typecheck and only learn after push.

### 5.6 No fuzz testing on Zod schemas (🟢 Hygiene)

The 30+ Zod schemas in `index.ts` define API surface. No property-based
test fuzzes them to ensure malicious-shaped payloads don't crash.

### 5.7 Many magic numbers (🟢 Hygiene)

`PRODUCT_ONBOARD_CENTS = 50`, `REFINE_COST_CENTS = 30`,
`LIFESTYLE_COST_CENTS = 30`, `MAX_ITERS = 3`, `PASSTHROUGH_FILL_MIN = 0.55`,
threshold 0.78, etc. Each in its own file. No central pricing /
configuration registry.

### 5.8 Duplicate types across apps (🟢 Hygiene)

`TenantFeatures` is defined in 3 places (worker `pipeline/types.ts`,
worker `lib/tenant-context.tsx` via the dashboard, BFR's own copy).
Same fields, three drift surfaces.

---

## 6. Observability gaps

### 6.1 No structured logging (🟠 High)

`console.warn` and `console.error` litter the codebase. Cloudflare
Workers logs flow to wrangler tail. No structured fields (level,
tenant_id, request_id), no log aggregation (Datadog/CloudWatch). Sentry
captures errors but not warnings.

### 6.2 No metrics on per-provider performance (🟡 Medium)

We don't track: FAL P50/P99 latency per slot type, Sonnet token spend
per surface, Haiku reject rate over time, CLIP score distribution.
Without this, we can't tell when a provider's quality drifts.

### 6.3 No alerting beyond Sentry (🟡 Medium)

Sentry catches uncaught exceptions. There's no alert on "error rate >
5% over 5 min", no alert on "wallet ledger imbalance detected", no alert
on "FAL spend > daily cap." Page-the-engineer doesn't exist.

### 6.4 No load test results (🟡 Medium)

We don't know what the worker handles. 10 concurrent launches per
tenant? 100 across all tenants? Could a single bad actor saturate the
DB connection floor of 1? Unknown.

---

## 7. The most consequential single problems

Filtering by what an enterprise prospect would actually ask:

1. **No staging environment** (§1.3) — every change is one bad deploy from a customer outage.
2. **No SSO / DPA / SOC2** (§4.1, §4.2) — gates any enterprise sale above ~$50K ACV.
3. **DB single-connection-per-request + single-region single-instance** (§1.2, §1.4) — performance and DR floor.
4. **90-120s synchronous launches with no queue** (§2.1, §3.1) — customers must keep a browser tab open for 2 minutes. Mobile-hostile.
5. **`tenant.features` jsonb without typed schema** (§1.11) — feature flag drift between worker + dashboard already happens; a flag-name typo silently disables a paid feature.
6. **Per-tenant data isolation by developer discipline only** (§1.10) — one forgotten WHERE clause and a customer sees another customer's data.
7. **Hot files (3,174 + 1,147 lines) with near-zero direct test coverage** (§1.1, §5.1) — refactoring is high-risk because regressions hide.
8. **No saga / compensation pattern** (§3.12) — partial pipeline failures leak wallet + R2 state.
9. **Stub workers still in tree** (§2.5, §3.17) — two execution paths, one is fake; subtle bugs from caller drift.
10. **No customer SDK** (§4.7) — every new integration partner is a one-off pairing session.

The other ~50 items are real but downstream of these 10.
