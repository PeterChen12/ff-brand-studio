# Session State — 2026-04-27 (SaaS iteration G–M ✅ complete)

> The platform is production-ready. Phases G (auth), H (billing), I
> (image pipeline scaffold, behind feature flag), J (library SaaS),
> K (iterate + publish), L (public API + webhooks), M (scale
> hardening + DR + observability) all shipped this session.

---

## Phase M — Scale hardening — ✅ shipped 2026-04-27

| Iter | What ships |
|---|---|
| M1 | Hand-rolled Upstash REST rate-limit middleware (sliding 60s window, plan-aware: free 60 rpm, pro 600, enterprise 6000; per-tenant override via `tenant.features.rate_limit_per_min`); X-RateLimit-* headers + Retry-After on 429; fail-open when Upstash unconfigured. Applied to every `/v1/*` + `/api/*` route after auth. |
| M2 | `GET /v1/audit?format=csv` streams a tenant audit CSV with proper Content-Disposition. |
| M3 | `src/lib/sentry.ts` envelope helper (no-op without SENTRY_DSN) + `.github/workflows/synthetic.yml` Playwright check every 30 min hitting /health, /docs, /v1/openapi.yaml, dashboard /sign-in. Failures POST to Sentry envelope endpoint. |
| M4 | `docs/RUNBOOK_SECRET_ROTATION.md` per-secret cadence + steps + rollback for all 16 tracked secrets. |
| M5 | `GET /v1/tenant/export` builds an in-Worker ZIP across 12 domain tables (sellers, products, variants, refs, assets, listings, runs, ledger, audit, api_keys, webhook_subs + tenant.json). `.github/workflows/dump.yml` daily 05:23 UTC pg_dump → R2 `backups/db/<date>.sql.gz` with 30-day retention + auto-prune. |

**Deferred items documented in the plan:**
- Langfuse Hono-wide middleware (current per-tool emission still works)
- API key 90-day expiration (no agency has asked yet)
- `DELETE /v1/me` self-serve soft-delete (GDPR grace period UX needs design)

**Bundle impact:** Worker grew by ~6 kB (rate limiter + sentry helper +
tenant export). Sidecar unchanged.

---

# Session State — 2026-04-27 (Phase L shipped — public API)

A compact catch-up doc so the next session can resume in <5 min.

---

## Phase L — Public API — ✅ shipped 2026-04-27

Plan: `plans/active-plan-saas-L.md`. Four iterations land in this push.

| Iter | What ships |
|---|---|
| L1 | api_keys table + `ff_live_*` issuance/list/revoke + dual-auth middleware (Clerk JWT or API key Bearer). SHA-256 hash (not bcrypt; rationale in api-keys.ts header). 60s SESSION_KV cache by prefix → tenant. |
| L2 | OpenAPI 3.1 spec at `/v1/openapi.yaml` + Redoc renderer at `/docs` (no auth). Coverage gap fills: `GET /v1/products`, `GET /v1/products/:id`, `DELETE /v1/products/:id` (soft delete via sku tombstone), `GET /v1/launches`, `GET /v1/listings/:id`. Cursor pagination on products + launches. |
| L3 | MCP `/sse` accepts `?api_key=ff_live_*` query param; resolved tenant stored in `sessionTenants` map keyed by sessionId. Tools can call `getSessionTenant(sessionId)` to get a `{tenantId, apiKeyId}` binding. Without a key, sessions fall through to legacy read-only sample data. |
| L4 | webhook_subscriptions + webhook_deliveries tables. CRUD `POST/GET/DELETE /v1/webhooks`. HMAC-SHA256 signed deliveries (`X-FF-Signature: t=<ts>,v1=<hex>`, Stripe pattern). auditEvent fan-out for launch.complete/failed, listing.publish/unpublish, billing.stripe_topup. Failures land in webhook_deliveries with next_attempt_at populated for the future Phase M cron-driven retry (1m/5m/30m/2h/12h schedule). |

**Surface that's now machine-callable:**
```
curl -H "Authorization: Bearer ff_live_..." \
     https://ff-brand-studio-mcp.creatorain.workers.dev/v1/products
```

**Rate limits:** not yet active. The OpenAPI doc + announcement note
60 req/min/key default arrives in Phase M1.

**Deferred but documented:**
- `/settings/api-keys` dashboard page (use curl until first agency asks)
- `packages/api-client/` (generate locally with `openapi-typescript`)
- Cron-driven webhook retry loop (lands in Phase M alongside the queue)

---

## Phase K — Edit + Publish — ✅ shipped 2026-04-27

A compact catch-up doc so the next session can resume in <5 min.

---

## Phase K — Edit + Publish — ✅ shipped 2026-04-27

Plan: `plans/active-plan-saas-K.md`. Three iterations: `c62c1dd` (K1) →
`ebf0847` (K2) → K3 (this commit).

| Iter | What ships | Commit |
|---|---|---|
| K1 | Inline editor with per-surface brand-rule validation; PATCH /v1/listings/:id with version trail (platform_listings_versions row before each save); GET /v1/listings/:id/versions; word-level diff side panel | `c62c1dd` |
| K2 | POST /v1/assets/:id/regenerate (30¢ charge with refund-on-fail, behind tenant.features.feedback_regen); per-tenant monthly cap (default 200, ceiling 1000); GET /v1/assets/regen-cap; library tile gets Regenerate button + chip-palette modal | `ebf0847` |
| K3 | Migration adds platform_listings.approved_at + platform_assets.approved_at (applied to prod); approve/unapprove/publish endpoints; in-Worker ZIP builder produces tenant/<tid>/exports/<runId>/<sku>-bundle.zip with Amazon Inventory File CSV + Shopify Product CSV + manifest.json + per-slot image folders; Resend email with 7-day presigned link | this commit |

**Non-trivial implementation notes:**
- ZIP builder is hand-rolled store-only (no jszip dependency in the
  Worker — keeps cold-start lean). CRC-32 table precomputed at module
  load; supports up to ~16 image entries before memory pressure.
- presignGetUrl uses the same aws4fetch SigV4 pattern as Phase H1's PUT
  presign; reuses the R2 access keys.
- Email is opt-in: client passes `email` in the publish body or it's
  skipped. Free Resend tier (3K/mo) covers projected K+L volume.

---

## Phase I — Production image pipeline — 🟡 scaffolded behind feature flag 2026-04-27

A compact catch-up doc so the next session can resume in <5 min. For deeper context read in this order: HANDOFF.md → V2_STATUS.md → V2_FINAL_AUDIT.md → V2_OPTIMIZATION_PLAN.md → docs/RUNBOOK.md → plans/active-plan-saas-G.md.

---

## Phase I — Production image pipeline — 🟡 scaffolded behind feature flag 2026-04-27

Plan: `plans/active-plan-saas-I.md`. ADR-0003: `docs/adr/0003-image-pipeline-runtime.md`.

**Architectural correction before build:** ADR-0003 was rewritten — `sharp` cannot run inside a Cloudflare Worker (V8 isolate, no native modules, even with `nodejs_compat`). Phase I now runs as a **Worker orchestrator + Node sidecar** split. The Worker owns all HTTP-call steps + billing + audit; sharp ops (4 endpoints) live in `apps/image-sidecar/`, called via HMAC-SHA256(`${ts}.${sha256(body)}`) over `IMAGE_SIDECAR_SECRET`.

**Worker pipeline modules** at `apps/mcp-server/src/pipeline/`:
- `cleanup.ts` — gpt-image-2 image-edit, R2-cached
- `derive.ts` — calls sidecar `/derive` for kind-aware crops
- `refine.ts` — FAL Nano Banana Pro `[studio, crop]` dual-ref + parallel pool with retry
- `triage.ts` — Workers AI CLIP cosine, R2-cached embeddings
- `audit.ts` — Opus 4.7 vision JSON verdict against per-kind checklist
- `iterate.ts` — ≤3 iter loop with vision-feedback prompt amend; FAIR fallback
- `lifestyle.ts` — single FAL render reused across Amazon + Shopify
- `composite.ts` — sidecar `/composite-text` + `/banner-extend`
- `specs.ts` — metadata→3 specs, Sonnet fallback (R2-cached)
- `derivers/index.ts` — 8 Kind Derivers with refinePrompt + visionChecklist + lifestylePrompt + clipThreshold
- `planner_matrix.ts` — 6 Amazon + 5 Shopify slot matrix → PipelineSource
- `index.ts` — orchestrator, charges wallet once at end with reason=image_gen, runs the slot matrix to write platform_assets

**Sidecar** at `apps/image-sidecar/` — Hono+Node service, Dockerfile, Render-ready. Endpoints: `/derive`, `/composite-text`, `/banner-extend`, `/force-white`, `/healthz`. Reads/writes R2 via @aws-sdk/client-s3.

**Feature flag:** `tenant.features.production_pipeline` (default **OFF**). Existing tenants stay on the stubbed Phase 3 pipeline. `runLaunchPipeline` now accepts an optional `env: CloudflareBindings`; when present and the flag is on, it dispatches to `runProductionPipeline` and returns early.

**Schema:** `products.kind text NOT NULL DEFAULT 'compact_square'` migration applied to prod (5 existing products → all `compact_square`). New product create form has a Kind selector with category-driven auto-suggest (overridable).

**Tests:** 14 new unit tests (8 deriver coverage + 6 planner matrix) all green; existing 8 orchestrator tests still pass.

**What ships dark:**
- Pipeline does not run in production until per-tenant `production_pipeline=true` is set.
- Sidecar URL+secret not yet provisioned — `IMAGE_SIDECAR_URL` is optional in bindings; calls return `{kind: "config_missing"}` until set.

**To finish Phase I (next session):**
1. Deploy `apps/image-sidecar` to Render free tier (or Fly $5/mo). Set `IMAGE_SIDECAR_URL` + `IMAGE_SIDECAR_SECRET` as Worker secrets (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`, `R2_BUCKET` go on the sidecar host).
2. Enable `production_pipeline` on a dogfood tenant.
3. Run the 3-SKU spike (rod/drinkware/handbag). Record per-step costs in ADR-0003 spike-numbers table.
4. Tune deriver prompts based on visual review.
5. When FAIR rate ≤ 10% across 200 launches, default-on `production_pipeline` for new tenants.

---

## Phase J — Library SaaS — ✅ shipped 2026-04-27

Plan: `plans/active-plan-saas-J.md`. Four iterations land as `7b4a97a` →
`6b22c54` → `ce23938` → `f6695d2`.

| Iter | What ships | Commit |
|---|---|---|
| J1 | yet-another-react-lightbox + Zoom plugin; ZoomTile 250% magnifier (mouse-only via matchMedia(hover: none)) | `7b4a97a` |
| J2 | Per-asset download anchor; bundle ZIP via jszip + file-saver with manifest.csv (sku, platform, slot, w, h, rating, model, cost, generated_at). 200 MB cap; mobile confirm gate | `6b22c54` |
| J3 | FilterBar (debounced text + platform chips + slot/status selects + date-range presets) binds to URL via history.replaceState; new `GET /v1/audit` paginates audit_events; AuditTab on /library | `ce23938` |
| J4 | `@tanstack/react-virtual` virtualizes the SKU group list (measureElement, overscan 1, bypassed for ≤8 groups); /api/assets derives thumbUrl via cf-image-resizing path when R2_THUMB_HOST is set | `f6695d2` |

The library now looks like a real DAM (lightbox, magnifier, bulk
download, search, audit log, virtualized scroll) instead of a debug
inspector. Phase K (edit + publish) builds on top.

---

## Phase G — Foundation (auth + tenancy + persistence) — ✅ shipped 2026-04-27

Plan: `plans/active-plan-saas-G.md`.

**Schema:** migration `apps/mcp-server/drizzle/0002_phase_g_tenancy.sql`
applied to prod (170.9.252.93:5433). New tables: `tenants`,
`platform_listings`, `platform_listings_versions`, `wallet_ledger`,
`audit_events`. `tenant_id NOT NULL` added to all 8 domain tables.
Backfill assigned every existing row to the `legacy-demo` Sample
Catalog tenant (UUID `00000000-0000-0000-0000-000000000001`).

**Auth:** Clerk app `app_3CxVYIB6FbIopFz9CWga2j3inuq` (instance
`pro-cattle-88`) live in test mode. Three secrets pushed to the Worker:
`CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET`.
Webhook subscribed to `organization.*` + `user.*` +
`organizationMembership.*` events at `/v1/clerk-webhook`.

**Worker auth:** `requireTenant` Hono middleware (`src/lib/auth.ts`)
verifies the Clerk session JWT via `@clerk/backend.verifyToken`,
extracts `org_id`, calls `ensureTenantForOrg` (auto-creates tenant +
$5 signup-bonus ledger row + `tenant.created` audit event). Applied
to `/api/*`, `/v1/launches/*`, `/v1/listings/*`. `/health`, `/sse`,
`/messages`, `/v1/clerk-webhook`, `/demo/*` stay open.

**Visibility:** Sample Catalog visible to every signed-in tenant via
`tenant.features.has_sample_access` (default true). Read endpoints
filter `tenant_id IN (currentTenant, SAMPLE_TENANT)`.

**Dashboard:** `<ClerkProvider>` from `@clerk/clerk-react` (NOT
`@clerk/nextjs` — Server Actions break static export). Loaded
client-only via `next/dynamic({ ssr: false })` in
`components/layout/clerk-app-shell.tsx` so the Clerk bundle never
runs during the prerender pass. Each page is a thin
`"use client"` wrapper that dynamic-imports its `_client.tsx`
sibling for the same reason. Sign-in / sign-up at `/sign-in` and
`/sign-up`; Shell uses `useAuth().isSignedIn` to gate everything
else and falls back to `<RedirectToSignIn />`.

**SEO persistence:** `runLaunchPipeline` upserts one row per surface
into `platform_listings` keyed by `(variant_id, surface, language)`.
Read endpoint `GET /v1/listings?variant_id=...` or `?sku=...`.

**Wallet + audit:** helpers in `src/lib/wallet.ts` and
`src/lib/audit.ts`. Integrity script
`scripts/audit-wallet-integrity.mjs` runs clean (0 drift, 1 tenant).
Wiring into `runLaunchPipeline` deferred to Phase H1 (pairs with the
pre-flight cost prediction).

**Live URL:** sign-in flow at
`https://image-generation.buyfishingrod.com/sign-in` after the next
deploy lands.

---

## Production status — what's actually live

| Surface | URL | State |
|---|---|---|
| MCP Worker (v2) | https://ff-brand-studio-mcp.creatorain.workers.dev | ✅ live, v0.2.0, 11 secrets uploaded, all 5 dep checks green, db ping ~100ms |
| Dashboard custom domain | https://image-generation.buyfishingrod.com | ✅ M3 redesign live (commit `d473e92`); now served by Cloudflare Pages, NOT Amplify |
| Dashboard fallback | https://ff-brand-studio.pages.dev | identical content (same project) |
| GitHub Actions CI + auto-deploy | master | ✅ `.github/workflows/deploy.yml` ships Worker + Pages on every successful CI |
| Postgres | 170.9.252.93:5433/ff_brand_studio | ✅ v2 schema applied, 7 tables + 10 platform_specs |
| Amplify staging app | `d1a431ll6nyfk4` (us-east-1) | DEPRECATED — domain disassociated 2026-04-27. App still exists but no traffic |

**Deploy flow (current):** `git push origin master` → CI runs (`ci.yml`) → on success `deploy.yml` ships Worker (`wrangler deploy`) + Pages (`wrangler pages deploy ../dashboard/out`). Custom domain `image-generation.buyfishingrod.com` proxied through Cloudflare to Pages project `ff-brand-studio`. **No more manual Python-zipfile Amplify dance.**

**Microservice boundary:** ff-brand-studio shares ONLY the URL prefix with buyfishingrod. No shared code, no shared DB, no shared deploy pipeline. Rip-out cost: delete 1 CNAME on `buyfishingrod.com` zone + 1 Pages custom-domain ≈ 30 sec.

---

## Frontend UX iteration — F1-F5 ✅ complete (2026-04-27)

Plan at `plans/active-plan-frontend-ux.md`. Triggered by audit finding that
the dashboard still encoded v1 (FF social-content campaigns) while the
backend had been pivoted to v2 (multi-model launch_product_sku
orchestrator). Two visual refreshes never re-architected page purpose.

**Pitch (settled):** "High-quality product images and description generation
at scale — for marketing agencies serving Chinese sellers on Amazon US and
Shopify DTC."

| Phase | Commit | What landed |
|---|---|---|
| F1 — Vocabulary + IA cleanup | `8b5b769` | Drop 成 / atelier / bench decoration. Nav reordered: Overview → Launch → Library → Costs. Service Status footer collapsed to a 1-line dot. Score thresholds card demoted from peer-card to compact reference text. |
| F2 — Launch wizard | (this commit) | New /launch route replaces both /campaigns/new (v1 social) and /seo (parallel SEO panel). Single flow: pick product → pick platforms → launch. Result panel shows image plan + per-platform SEO copy + compliance badges. New backend endpoints: GET /api/products + POST /demo/launch-sku (wraps launch_product_sku with safe defaults). dry_run now still runs SEO. |
| F3 — Library (was /assets) | `c7be3fc` | /assets → /library. Backend /api/assets joins platform_assets → product_variants → products → seller_profiles. UI groups by SKU; tabs for "By SKU" (v2) and "Legacy" (v1 hero filenames). Smart titles: "FF-DEMO-ROD-12FT · category · seller" + product name. |
| F4 — Overview rebalance | `b0e6dd9` | Hero pivots from "Cumulative spend" to "Recent launches" list. KPI ribbon below holds spend/SKU-count/asset-count/avg-compliance compactly. Empty state has "Run your first launch" CTA. New endpoint: GET /api/launches. |
| F5 — Costs touch-up | `b0e6dd9` (same commit) | New "Recent launches by SKU" table sourced from launch_runs. Old v1 run_costs table relabeled "Legacy v1 ledger". Ribbon's "Campaigns" → "Legacy runs". |
| F6 — Verify + ship | (in progress) | Workspace type-check 7/7 green, dashboard build clean, push triggers deploy.yml. |

**Routes today:** `/`, `/launch`, `/library`, `/costs`. v1 routes deleted: `/campaigns/new`, `/seo` (404 if anyone hits the old URL — intentional, no redirect since the v1 social-content workflow is officially dead).

**New Worker endpoints:** `GET /api/products`, `GET /api/launches`, `POST /demo/launch-sku`. The old `/demo/run-campaign` and `/demo/seo-preview` are still present but unused by the dashboard — the cleanup-routine on 2026-05-11 (`trig_01Po58VRaMzHUp4YAvFVb52G`) will check whether to delete /demo/seo-preview.

---

## SEO Description Layer — D1-D8 ✅ complete (2026-04-27)

The plan at `plans/active-plan.md` is being executed. Old v1 bootstrap plan
preserved at `plans/active-plan-v1-bootstrap.md`.

| Task | Commit | State |
|---|---|---|
| D1 — DataForSEO client + research_keywords tool | `19fe77e` | ✅ |
| D2 — Free autocomplete (Amazon/Google/Tmall) + expand_seed | `19fe77e` | ✅ |
| D3 — OpenAI embeddings + clusterByCosine + cluster_keywords | `19fe77e` | ✅ |
| D4 — Bilingual SEO description generator (Sonnet 4.6, cached) | `872e8cb` | ✅ |
| D5 — Deterministic seo compliance scorer | `e4ba410` | ✅ |
| D6 — launch_product_sku v2 orchestrator integration | `1a8144a` | ✅ |
| D7 — Dashboard SEO panel + /demo/seo-preview Worker endpoint | `20f4b7a` | ✅ |
| D8 — Demo SKUs pre-seeded (3 fishing-rod SKUs in Postgres) | `2454f9b` | ✅ |

**New Worker secrets** (pushed 2026-04-26): `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`, `APIFY_TOKEN`. OpenAI project key already there.

**New MCP tools registered** (16 total, was 11): `research_keywords`, `expand_seed`, `cluster_keywords`, `generate_seo_description`, `score_seo_compliance`. Type-check 10/10, all 33 unit tests green. Deploy NOT yet pushed to Worker — single `wrangler deploy` lands the whole batch (tools + orchestrator) once D7 ships the panel that consumes the new return shape.

**D6 surface area:**
- New file `apps/mcp-server/src/orchestrator/seo_pipeline.ts` — `runSeoPipeline()` runs expand_seed → cluster_keywords → research_keywords (top reps only) → generate × score with 3-iter feedback regenerate. 50¢ default sub-cap.
- `runLaunchPipeline` calls it after image adapters, gated by `include_seo` (default true). Cost rolls into run total and respects `cost_cap_cents` retroactively.
- `LaunchProductSkuInput` adds `include_seo: boolean = true` and `seo_cost_cap_cents: number = 50`.
- Result shape adds `seo?: SeoPipelineResult` with per-surface `{copy, rating, issues, suggestions, iterations, cost_cents}`.

**D7 surface area:**
- New page `/seo` (rendered at build time, in static export) with sidebar nav entry "SEO Atelier · 文案工坊".
- New component `apps/dashboard/src/components/seo-atelier.tsx` — brief form (name EN/ZH, category, platforms) → POST /demo/seo-preview → per-surface result cards with rating badge, copy preview, issues, blocking-flag callouts, regenerate-disabled HITL gate on Publish to DAM.
- New Worker endpoint `POST /demo/seo-preview` — synthesizes a minimal `Product` from request body (no DB read), calls the same `runSeoPipeline` used by `launch_product_sku`. Lets the panel demo end-to-end before D8 SKUs are seeded.
- Worker redeployed (version `cf550922`); smoke-tested at 1.09¢ for a single Amazon-US listing returning EXCELLENT-rated copy.
- Dashboard auto-deploys to Cloudflare Pages via `.github/workflows/deploy.yml` (added in `96d593a`) — push to master, CI passes, Worker + Pages deploy in parallel. Lives at `https://ff-brand-studio.pages.dev` (and on master push the new SEO panel will be there). Amplify custom domain `image-generation.buyfishingrod.com` is still on the *manual* Python-zipfile deploy path (gotcha #1) — the auto-deploy targets Pages only, so the Amplify mirror lags until someone runs that script.

**D8 surface area:**
- New script `scripts/seed-demo-skus.mjs` — idempotent (ON CONFLICT DO UPDATE on `products.sku`, SELECT-then-INSERT on `seller_profiles.org_name_en`). Run with: `$env:PGPASSWORD='...'; node scripts/seed-demo-skus.mjs`.
- Already executed against production Postgres (170.9.252.93:5433/ff_brand_studio). Inserted seller `9dff9e3e-e1a8-49fa-a9af-d99170b2f607` "Demo · Tackle Atelier" + 3 products:
  - `FF-DEMO-ROD-12FT` → `27e0457a-71e7-4cc3-959c-1ff6fcce123f` (Carbon fiber telescopic 12ft, category=other)
  - `FF-DEMO-REEL-4000` → `827525ee-a9b0-44bd-8b46-b66530a0d03a` (Saltwater spinning reel 4000, category=tech-acc)
  - `FF-DEMO-BITE-LED4` → `74ed5a8c-3e63-43dd-897f-aa4c8285832a` (LED bite alarm 4-pack, category=tech-acc)
- Dashboard SEO Atelier gets a "Demo SKUs · 一键填充" preset row above the form — one-click fill for live demos.
- These product UUIDs are also valid `product_id` arguments to the full `launch_product_sku` MCP tool (D6 orchestrator), so an end-to-end image+SEO run is one MCP call away once you want to spend ~$0.30 on a live image render.

## Recent commits (last → first)

| SHA | Message | Notes |
|---|---|---|
| `d4f83d8` | ci: fix pnpm/action-setup@v4 double-version error | First green CI |
| `36ed3b8` | feat(v2): proxy-worker for creatorain.com routing | Code committed, never deployed (creatorain DNS is on a different CF account we don't have access to) |
| `b0ed5dd` | docs(v2): ADR-0002 cost routing fal.ai vs GPT Image 2 | OpenAI project key validated |
| `437043e` | refactor(v2): Phase C boundary — shared API contract Zod schemas | API_CONTRACT.md |
| `84fae5b` | refactor(v2): Phase B reliability — tool error wrapper + health enrichment | /health enriched |
| `99ea156` | refactor(v2): Phase A optimization | Strip dead deps, split workers, registry array |
| `ad77c65` | feat(v2): evaluator-optimizer + cost cap + provenance + CI + runbook | Includes the broken CI workflow that just got fixed |
| earlier | foundation, orchestrator, adapters, compliance scorers, Phase 2 image_post + Sonnet transcreation + vitest, Opus 4.7 vision scorer | See full git log |

---

## What's deferred / open follow-ups

### High-impact items not yet done

1. **Phase 2 real generators** — fal.ai Kontext + Nano Banana Pro + FLUX.2 LoRA wiring at `apps/mcp-server/src/orchestrator/workers/{white_bg,lifestyle,variant,video}.ts`. Currently all stubs returning placeholder R2 URLs. Estimate ~1.5 weeks. Blocks real image generation in production.

2. **Frontend redesign per playbook** — paused mid-flight when user pivoted to deploy audit. Aesthetic direction committed (cross-border atelier: Fraunces + Geist + JetBrains Mono, vermilion saffron + jade accents, hairline borders, customs-stamp motifs). Implementation halted before any files were written. References: `Desktop/FF_DASHBOARD_BUILD_PLAYBOOK.md`. Next step is invoking `frontend-design` skill again with the same brief.

3. **creatorain.com subdomain** — `creatorain.com` DNS zone is in a different Cloudflare account than the documented Global API Key covers. Two CNAMEs needed (cert verification + route to CloudFront). Currently parked: `proxy-worker` code committed at `apps/proxy-worker/` but NOT deployed; Amplify domain association on `buyfishingrod.com` works instead.

4. **Fishing-rod images through v2 production** — user requested side-by-side comparison vs lykan_upload pipeline. Blocked on Phase 2 generators.

### Lower-priority follow-ups

- Amplify app platform is `WEB_COMPUTE` (intended for SSR Next.js). For static export, `WEB` would be cleaner but isn't causing functional issues.
- Add Amplify rewrite rule mapping extensionless paths (`/assets`, `/campaigns/new`) to `*.html` for cleaner URLs.
- Cancel the dead Cloudflare Pages dashboard (https://ff-brand-studio.pages.dev) once Amplify is fully verified, OR keep both as redundancy.
- 5 open architecture questions in V2_FINAL_AUDIT.md §"Still gated on external inputs": LangGraph adoption, multi-tenancy depth, SP-API auto-publish, demo-data sourcing, GPT Image 2 OAuth sign-in flow.
- Frontend overlap rules (5 specific avoidance rules for v2 lifestyle worker) in `docs/BUYFISHINGROD_OVERLAP_FINDINGS.md` — apply when wiring Phase 2.

---

## Audits run this session — issues found and fix status

| Audit | Finding | Fix status |
|---|---|---|
| Dashboard 404s on production | PowerShell `Compress-Archive` writes ZIP entries with `\` path separators; Amplify stores literal-key files; URL `/` doesn't match | **FIXING NOW (job #5)** — used Python zipfile instead, forward slashes verified |
| GitHub CI 6 commits all red | `pnpm/action-setup@v4` config had `version: 10` AND `package.json#packageManager: pnpm@10.33.2` — action errors on double-source | ✅ Fixed in `d4f83d8`, run 24973268709 green |
| Cross-border subdomain DNS | `creatorain.com` zone NOT in our CF account | Pivoted to `image-generation.buyfishingrod.com` instead |
| OpenAI key | Service-account key 401-blocked per HANDOFF gotcha #1 | ✅ Project key validated; both pushed to Worker secrets |
| R2/Langfuse keys | Empty in `.env` | ✅ Populated locally + Worker secrets |

---

## Quick resume runbook

```bash
# 1. Verify production state
curl https://ff-brand-studio-mcp.creatorain.workers.dev/health
curl -I https://image-generation.buyfishingrod.com/_next/static/chunks/webpack-e5fcc9f9da1d11ed.js
# Expect both 200. If chunks 404, the deploy fix didn't stick — see "Audits" above.

# 2. Verify CI
gh run list --repo PeterChen12/ff-brand-studio --limit 3
# Expect green on master.

# 3. Local sanity
cd C:\Users\zihao\Desktop\ff-brand-studio
pnpm type-check                                  # 8/8 expected
cd apps/mcp-server && pnpm test                  # 33/33 unit
PGPASSWORD=P6vOhRSqKTHgHoNt pnpm test:integration  # 4/4 integration

# 4. Pick up where we left off
# Most likely next thing: frontend redesign — invoke `frontend-design` skill with
# the brief in V2_OPTIMIZATION_PLAN.md, applying playbook at
# Desktop/FF_DASHBOARD_BUILD_PLAYBOOK.md. Aesthetic already chosen
# (see "What's deferred" #2 above).
```

---

## How to redeploy the dashboard (correct way)

```bash
# Build
cd C:\Users\zihao\Desktop\ff-brand-studio
pnpm --filter ff-dashboard run build

# Re-zip with FORWARD SLASHES (Python — confirmed correct on Windows)
python -c "
import zipfile, os
src = r'apps\dashboard\out'
dst = r'C:\Users\zihao\AppData\Local\Temp\dashboard.zip'
if os.path.exists(dst): os.remove(dst)
with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, _, files in os.walk(src):
        for f in files:
            full = os.path.join(root, f)
            rel = os.path.relpath(full, src).replace(os.sep, '/')
            z.write(full, arcname=rel)
"

# DO NOT USE: PowerShell Compress-Archive (backslashes)
# DO NOT USE: tar -a -cf (writes tar disguised as zip)
# DO NOT USE: .NET ZipFile.CreateFromDirectory on Windows .NET Framework 4.x (also backslashes)

# Create deployment + upload + start (chain in single shell to keep upload URL in scope)
RESP=$(aws amplify create-deployment --app-id d1a431ll6nyfk4 --branch-name staging --region us-east-1)
JOB_ID=$(echo "$RESP" | python -c "import json,sys;print(json.load(sys.stdin)['jobId'])")
URL=$(echo "$RESP" | python -c "import json,sys;print(json.load(sys.stdin)['zipUploadUrl'])")
curl -sS -X PUT -H "Content-Type: application/zip" --data-binary "@/c/Users/zihao/AppData/Local/Temp/dashboard.zip" "$URL"
aws amplify start-deployment --app-id d1a431ll6nyfk4 --branch-name staging --job-id "$JOB_ID" --region us-east-1
```

---

## Key file locations

| File | Purpose |
|---|---|
| `HANDOFF.md` | Original v1→migration brief, env vars, deploy commands, gotchas |
| `V2_STATUS.md` | Live phase status (Phase 1-5) |
| `V2_FINAL_AUDIT.md` | Test surface + security audit + open questions |
| `V2_OPTIMIZATION_PLAN.md` | The 4-phase pre-deploy refactor plan executed today (Phases A,B,C done; D in flight) |
| `docs/RUNBOOK.md` | Operational reference |
| `docs/API_CONTRACT.md` | Dashboard ↔ Worker boundary |
| `docs/BUYFISHINGROD_OVERLAP_FINDINGS.md` | 5 rules to avoid the lykan "cut-of-profile" trap when Phase 2 lands |
| `docs/adr/0001-three-model-pipeline.md` | Architecture: FLUX Kontext + Nano Banana Pro + GPT Image 2 |
| `docs/adr/0002-cost-routing-fal-vs-gpt-image-2.md` | Per-job routing decision |
| `Desktop/FF_DASHBOARD_BUILD_PLAYBOOK.md` | Frontend rebuild reference (NOT in repo — local only) |
| `Desktop/ff_brand_studio_v2_test/` | Python prototype for white-bg compliance + buyfishingrod batch validator |
| `apps/mcp-server/src/orchestrator/workers/` | Phase 2 wiring target |
| `.github/workflows/ci.yml` | The CI workflow, now green |

---

## Non-obvious gotchas to remember

1. **Don't use PowerShell `Compress-Archive` for zip-to-S3/Amplify** — backslashes break everything. Use Python `zipfile`.
2. **OpenAI**: `OPENAI_API_KEY` is the project key (`sk-proj-`), validated against `/v1/models` on 2026-04-26. `OPENAI_API_KEY_SVCACCT_FALLBACK` is the original svcacct key kept for rotation.
3. **CF Global API Key** in `.env` only has 4 zones: `buyfishingrod.com`, `ceronfishing.com`, `ceronrod.com`, `electricalsafetyacademy.com`. NOT `creatorain.com` (different account).
4. **buyfishingrod.com had a leftover Amplify cert verification CNAME** that happened to match what the new staging Amplify domain needed — saved a manual DNS edit. Worth knowing for future buyfishingrod ACM cert work.
5. **CLAUDE.md DNS table updated** at `creatorain/CLAUDE.md` with verified DNS provider per domain (added 2026-04-26).
6. The original 4-page dashboard is the v1 (Faraday Future social-content tool); the v2 (Chinese-sellers ecommerce) UI doesn't exist yet — the redesign brief is for v1 visual upgrade only. v2 Phase 5 dashboard (`/launch/[productId]`) is a separate, larger deliverable.
7. **CI integration tests need `PGPASSWORD` secret** in repo settings if anyone wants the integration job to run; otherwise it skips with exit 0.
