# Session State — 2026-04-27 (Frontend UX iteration F1-F5 done)

A compact catch-up doc so the next session can resume in <5 min. For deeper context read in this order: HANDOFF.md → V2_STATUS.md → V2_FINAL_AUDIT.md → V2_OPTIMIZATION_PLAN.md → docs/RUNBOOK.md.

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
