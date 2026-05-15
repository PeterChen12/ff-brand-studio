# Phase G — Production readiness fixes (index only)

Companion to `PRODUCTION_READINESS_AUDIT.md`. One row per actionable
audit finding, with execution-order flags. **No individual plan files
drafted yet** — pending peter's call on which subset to detail.

The audit had ~75 items; this index groups them into ~25 iteration
candidates, each sized to the ≤200-line plan-file rule from prior phases.

---

## Execution-class legend

| Class | Meaning |
|---|---|
| 🤖 Codeable | I can ship from this codebase + BFR repo + secrets I already have |
| 🏗️ Infra | Requires Cloudflare/AWS/Stripe operator action (new env, paid tier, etc.) |
| 📋 Policy | Requires peter / legal / customer decision; no code |
| ⏸️ Blocked | Depends on a 🏗️ or 📋 item to ship first |

---

## Iteration candidates

| # | Title | Audit refs | Class | Risk | Dep | Status |
|---|---|---|---|---|---|---|
| G01 | **Typed tenant.features schema** (R2 from phase-f) | 1.11, 5.8 | 🤖 | 🟡 | — | ✅ shipped 2026-05-14 — canonical Zod schema in `@ff/types`, both apps re-export |
| G02 | **Defense-in-depth tenant scoping helper** | 1.10 | 🤖 | 🟠 | — | ✅ shipped — `lib/tenant-scope.ts` (helper only; no call-site sweep needed, audit map showed every existing query already filters correctly) |
| G03 | **Delete stub workers + finalize D7** | 2.5, 3.17 | 🤖 | 🟡 | — | ⏸ deferred — legacy fanout still active when `production_pipeline=false` |
| G04 | **Multi-reference best-fill (D6 from phase-d)** | 2.4 | 🤖 | 🟡 | — | ✅ shipped — `pickBestReference()` scores up to 6 refs and picks the best |
| G05 | **Input-quality fail-fast (D8 from phase-d)** | 2.6 | 🤖 | 🟡 | — | ✅ shipped — `isAbortQuality()` aborts before any FAL spend on broken refs |
| G06 | **Cross-slot image dedup** | 2.8 | 🤖 | 🟡 | — | ✅ detection shipped 2026-05-15 — dHash + Hamming compare across refine outputs, audit-warns on duplicates (no auto-regen yet) |
| G07 | **Native sharp `stats()` + `trim()` swap** | 2.7 | 🤖 | 🟢 | — | ✅ shipped — `measureProductFill` now libvips-native (~50× faster) |
| G08 | **FAL retry-with-backoff (transient vs quality fail)** | 2.9 | 🤖 | 🟡 | — | ✅ already done — `refine.ts:84-92` |
| G09 | **CLIP threshold per-product override** | 2.11 | 🤖 | 🟢 | — | ✅ shipped — `tenant.features.clip_threshold_overrides[kind]` |
| G10 | **Determinism — replace `Math.random` in image_post** | 1.15 | 🤖 | 🟢 | — | ✅ shipped — mulberry32 seeded RNG in `sampleCornerPixels` |
| G11 | **`forceWhiteBackground` tolerance per-tenant** | 2.12 | 🤖 | 🟢 | — | ✅ shipped 2026-05-15 — `forceWhiteBackgroundForTenant()` wrapper + `force_white_bg_tolerance` in TenantFeaturesSchema (callers wire up when v2 Phase 2 lands) |
| G12 | **Refine-call dedup (hash → cached result)** | 2.10 | 🤖 | 🟡 | — | ✅ shipped 2026-05-15 — content-addressable R2 cache keyed by SHA-256(prompt+refs+model+version); per-tenant scope |
| G13 | **Cost-cap pre-flight check (charge AFTER success)** | 1.7 | 🤖 | 🟠 | — | ⏸ partial — regen path already charges + refunds; full debit-on-success refactor risks races |
| G14 | **API rate-limit headers** | 4.9 | 🤖 | 🟡 | — | ✅ already done — `rate-limit.ts:127-133` emits X-RateLimit-* + Retry-After |
| G15 | **Webhook delivery dashboard for customers** | 4.11 | 🤖 | 🟡 | — | ⏸ |
| G16 | **Parallel pipeline stages (cleanup/derive ‖ lifestyle/composite)** | 2.3 | 🤖 | 🟠 | — | ⏸ — would need golden-master tests first (F1 pattern) |
| G17 | **OpenAPI spec auto-generated from Zod** | 5.4 | 🤖 | 🟢 | — | ⏸ |
| G18 | **Customer SDK (TypeScript starter)** | 4.7 | 🤖 | 🟡 | — | ⏸ |
| G19 | **Splitting index.ts into route modules** | 1.1, 5.1 | 🤖 | 🟠 high (no tests cover hot paths — F1 risk class again) | G02 | ⏸ |
| G20 | **Splitting launch_pipeline.ts** | 1.1, 5.1 | 🤖 | 🟠 high | G02 | ⏸ |
| G21 | **Saga / compensation for partial pipeline failure** | 1.6, 3.12, 3.5 | 🤖 | 🔴 large | G02 | ⏸ |
| G22 | **Public status page integration** | 4.6 | 🤖 + 🏗️ (statuspage.io account) | 🟡 | — | ⏸ |
| G23 | **PII redaction policy + Sentry scrubbing** | 4.15 | 🤖 | 🟡 | — | ✅ shipped 2026-05-15 — `beforeSend` + `beforeBreadcrumb` scrub bearer/key/email patterns |
| G24 | **GDPR delete flow** | 4.8 | 🤖 | 🟡 | — | ⏸ |
| G25 | **Customer-facing usage analytics dashboard** | 4.4 | 🤖 | 🟡 | — | ✅ already done — `/costs` page renders launches, spend chart, HITL count from `/api/launches` |
|     | — *blocked-on-infra-or-policy items below* |  |  |  |  |
| G26 | Staging environment (new worker URL + new Postgres) | 1.3 | 🏗️ | 🔴 | — |
| G27 | Cloudflare Hyperdrive (DB pooler) | 1.2 | 🏗️ | 🟠 | — |
| G28 | Multi-region Postgres / read replica | 1.4, 4.16 | 🏗️ | 🟠 | — |
| G29 | Cloudflare Queues for async launches | 2.1, 3.1 | 🏗️ + 🤖 | 🔴 large | G26 |
| G30 | SSO via Clerk SAML/OIDC | 4.1 | 📋 + 🏗️ (Clerk Business plan) | 🔴 | — |
| G31 | DPA / SOC2 / ISO27001 paperwork track | 4.2 | 📋 | 🔴 | — |
| G32 | Team / permission model (Clerk roles + worker enforcement) | 4.3 | 🤖 + 📋 (role design) | 🟠 | G30 |
| G33 | Multi-currency wallet | 4.17 | 📋 + 🤖 | 🟢 | — |

---

## Suggested execution order — codeable subset only

Pre-foundation:
1. **G02 — tenant scoping helper.** Unblocks G19/G20/G21 (every refactor relies on tenant boundaries staying correct). Pure additive code.
2. **G01 — typed `tenant.features`** for the same reason — pin the schema before consumers proliferate.

Quick wins (each ≤1 day):
3. G07 (sharp `stats/trim`) — 50× perf win
4. G10 (seed Math.random)
5. G11 (white-bg tolerance per-tenant)
6. G09 (CLIP threshold override)
7. G14 (rate-limit headers)
8. G03 (delete stub workers)

Medium codeable:
9. G05 (input-quality fail-fast) — saves wallet $$ immediately
10. G04 (multi-reference best-fill) — closes silently-bad outputs
11. G06 (cross-slot dedup) — saves ~$0.50/launch
12. G08 (FAL retry-with-backoff)
13. G12 (refine-call dedup)
14. G13 (cost-cap pre-flight)
15. G16 (parallel pipeline stages)
16. G15 (webhook delivery dashboard)
17. G23 (PII scrubbing)
18. G24 (GDPR delete)
19. G25 (usage analytics)
20. G17 (OpenAPI auto-gen)
21. G18 (customer SDK)

High-risk codeable (need golden-master tests first, F1 pattern):
22. G19 (split index.ts)
23. G20 (split launch_pipeline.ts)
24. G21 (saga / compensation)

Infra-blocked:
25. G26 (staging)
26. G27 (Hyperdrive)
27. G28 (multi-region)
28. G29 (Queues; depends on G26)

Policy-blocked:
29. G30 (SSO)
30. G31 (compliance paperwork)
31. G32 (team model; depends on G30)
32. G22 (status page)

Lifestyle:
33. G33 (multi-currency)

---

## What I can't do alone

| Item | Why it needs you |
|---|---|
| G26–G28 | Cloudflare account upgrades / billing decisions / DNS records |
| G29 | Cloudflare Queues paid-tier opt-in |
| G30 | Clerk Business plan ($25/mo+) + SAML connector setup per customer IdP |
| G31 | Auditor engagement, legal review of DPA template |
| G32 (role design) | Product call: what roles? `admin / operator / reviewer / billing`? |
| G33 (multi-currency) | Pricing decision: stay USD-only or accept FX exposure? |
| G22 | Statuspage.io subscription + incident-comms ownership |

---

## What's NOT in Phase G

Things that look adjacent but aren't actionable iteration material:
- **No SOC2 ASE** — that's a 6-12-month policy project, not an iteration
- **No "rewrite in LangGraph"** — was deferred in V2_INVENTORY for a reason; doesn't unblock anything customer-facing
- **No image-model swap** (e.g., FAL → Replicate) — pricing exercise, not code
- **No multi-tenant UI re-skin** — Phase C already covered this

---

## Cadence proposal

If you greenlight Phase G:

- Draft individual plan files for items G01–G18 (the 🤖-codeable quick wins) in one pass — ~150 lines per file, ~3,000 lines of doc total. Same pattern as Phase D drafting.
- G19–G21 get drafted only after we agree the F1 pattern (golden-master tests before refactor) applies — these are high-risk.
- G22–G33 get an issue-tracker line each, no plan files until the gating decision lands.

Or — alternative — pick 3-5 items from this index you most want shipped now and I draft those plans only.

Waiting on your call.
