# v2 Pre-deploy Optimization Plan

Drafted 2026-04-26 before final deployment to `creatorain.com/product-image-generation`. Reviews the codebase for scalability, reliability, and boundary cleanliness; sequences the work into 4 phases that can be executed in order.

---

## Decision 1 — Monorepo stays

**Verdict: keep the monorepo. Do NOT split frontend/backend into two repos at this scale.**

Tradeoff matrix:

| Factor | Monorepo (current) | Two repos |
|---|---|---|
| Type sharing (`@ff/types`) | workspace symlink, zero config | publish to npm or duplicate |
| Coordinated changes (new MCP tool + dashboard UI for it) | one PR | two coordinated PRs |
| Independent deploy cadence | turbo cache + per-app CI filters | natural |
| Cognitive overhead | one repo, two app folders | two repos, two CI configs, two `.env` chains |
| Team scale fit | 1–5 devs (current) | 5+ devs with split frontend/backend ownership |
| Repo permissions | uniform | can lock down backend separately |
| Cost | $0 | $0 |

The clean `/api/*` boundary already exists. Splitting now optimizes for a team scale we don't have. The right harden-the-boundary moves (API contract doc, Zod schemas pinning the response shape) work in monorepo without paying the duplication tax. **Revisit if and only if** (a) we hire a dedicated frontend designer who needs a smaller surface area, or (b) we open-source the dashboard separately from the proprietary Worker.

---

## Phase A — Code refactor (3 items, ~30 min total)

**A1. Strip dead deps from dashboard package.json**

Dashboard is `output: "export"` (static); imports `drizzle-orm` and `postgres` but never executes them in the browser bundle. They sit in deps for ~10MB of node_modules + slower installs.

```diff
// apps/dashboard/package.json
- "drizzle-orm": "^0.30.10",
- "postgres": "^3.4.4",
- "drizzle-kit": "^0.21.4",
```

Verify: `pnpm install --filter ff-dashboard` succeeds; `pnpm --filter ff-dashboard run build` produces same `out/` size. Worker keeps its own drizzle/postgres deps.

**A2. Split `workers.ts` per worker type**

Current `apps/mcp-server/src/orchestrator/workers.ts` (114 lines) bundles four worker stubs. Phase 2 will wire each to a different fal/OAI endpoint with different prompt templates. One file per worker keeps Phase 2 changes isolated.

```
src/orchestrator/workers/
  white_bg.ts      — generateWhiteBgWorker (FLUX Kontext Pro)
  lifestyle.ts     — generateLifestyleWorker (Nano Banana Pro)
  variant.ts       — generateVariantWorker (FLUX.2 Dev + LoRA)
  video.ts         — generateVideoWorker (Kling)
  index.ts         — re-export all + shared CanonicalAsset/WorkerFeedback types
```

No behavior change. evaluator_optimizer.ts and launch_pipeline.ts re-import from `./workers/index.js` — no callsite changes.

**A3. Tool registration helper**

`apps/mcp-server/src/tools/index.ts` (28 lines) lists 11 imports + 11 register calls. As tools grow this becomes error-prone (forgetting to register a new tool). Replace with a small array-based pattern:

```ts
const REGISTRARS = [
  registerGenerateBrandHero,
  registerGenerateBilingualInfographic,
  // ...
];
export function registerAllTools(server, env) {
  for (const r of REGISTRARS) r(server, env);
}
```

Trivial change, makes "did I remember to register this?" answerable by `grep REGISTRARS`.

---

## Phase B — Reliability (2 items, ~30 min total)

**B1. Tool-level error wrapper**

Every MCP tool currently does its own try/catch (or doesn't). A thrown error becomes an HTTP 500 with no JSON-RPC structure — dashboard sees a generic failure.

Add `withToolErrorBoundary(name, handler)` helper that:
- Wraps handler in try/catch
- On throw: returns `{ content: [{ type: "text", text: JSON.stringify({success:false, error: ..., tool: name}) }], isError: true }`
- Logs the error with tool name + input shape (no input values — could contain secrets)

Apply to all v2 tools (5 of them). Keep v1 tools as-is (don't churn unrelated code).

**B2. Health check enrichment**

Current `/health` returns `{status:"ok",server,version,environment}`. Production diagnosis is faster if it also pings the dependencies:

```json
{
  "status": "ok",
  "server": "ff-brand-studio-mcp",
  "version": "0.2.0",
  "environment": "production",
  "checks": {
    "db": "ok",          // SELECT 1 with 1s timeout
    "anthropic_key": "set",  // env var presence (not a real call)
    "fal_key": "set",
    "openai_key": "set",
    "r2_public_url": "set"
  },
  "timestamp": "..."
}
```

DB ping has a budget of 1s; if it times out, status becomes `degraded` not `error`. Enables a CI smoke test that "the deployed Worker can reach Postgres".

---

## Phase C — Boundary hardening (1 item, ~15 min)

**C1. API contract doc**

Dashboard reads three Worker endpoints: `/api/costs`, `/api/runs`, `/api/assets`. Today their response shapes are implicit. Pin them so accidental backend renames break loudly:

- Add `packages/types/src/api.ts` exporting `ApiCostsResponse`, `ApiRunsResponse`, `ApiAssetsResponse` Zod schemas.
- Worker `/api/*` handlers parse-validate their own response with the schema before returning (catches accidental mid-refactor drift).
- Dashboard `lib/config.ts` re-exports the types so `fetch().then(r => r.json() as ApiCostsResponse)` is type-checked.
- New file `docs/API_CONTRACT.md` lists the three endpoints with their response Zod schemas inline.

This is the minimum infrastructure for "two-repo split is one PR away if we ever want it" — the contract is the thing that would have to be a published package.

---

## Phase D — Production deploy (3 items, ~30 min including verification)

**D1. Worker deploy to production**

```bash
cd apps/mcp-server
npx wrangler deploy
```

Free, ~30s. Brings v2 tools (`launch_product_sku`, `score_amazon_compliance`, `score_shopify_compliance`, `flag_us_ad_content`, `transcreate_zh_to_en_us`) live at `https://ff-brand-studio-mcp.creatorain.workers.dev`. Also deploys the OpenAI/Langfuse/R2 secret updates (push those first — see D1a).

**D1a. Push secrets BEFORE deploy:**
```bash
cd apps/mcp-server
echo "<new openai project key>" | npx wrangler secret put OPENAI_API_KEY
echo "<langfuse public>" | npx wrangler secret put LANGFUSE_PUBLIC_KEY
echo "<langfuse secret>" | npx wrangler secret put LANGFUSE_SECRET_KEY
```

R2 access keys do NOT need to be Worker secrets (Worker uses the R2 binding from wrangler.toml).

**D2. Production v2 smoke test (free)**

Hit the deployed Worker with the new tools. Use the existing SSE session machinery — `scripts/test-phase4-scorers.ts` already exercises the deterministic compliance path. Adapt it to point at the prod URL instead of local:

- Verify `tools/list` includes the 5 new v2 tools
- Call `flag_us_ad_content` with a known-bad string → expect ≥2 flags
- Call `score_amazon_compliance` against an existing platform_assets row → expect rating + metrics
- Skip vision pass and any generation (cost discipline)

**D3. Configure `creatorain.com/product-image-generation` routing**

Three implementation options (decide in this step, don't pre-commit):

| Option | Pros | Cons |
|---|---|---|
| **(a) Amplify custom rule on creatorain landing** | Native, no new infra, ~5 min | Rewrites only work within same Amplify app — would need Cloudfront for cross-app, OR 301/302 redirect (URL changes) |
| **(b) Cloudflare Worker proxy on creatorain.com** | Path stays clean (`creatorain.com/product-image-generation/...`), cacheable | Adds a Cloudflare Worker dependency; needs DNS verification |
| **(c) Move ff-brand-studio dashboard build into creatorain landing repo** | Single Amplify deploy, clean URL | Couples the repos; defeats the boundary work in Phase C |

**Recommended: option (b)**. Set up a tiny Cloudflare Worker on `creatorain.com/product-image-generation/*` that fetches from the Amplify staging URL. ~20 lines of code. Keeps the staging app at its own subdomain for direct access too.

Verification:
```bash
curl -I https://creatorain.com/product-image-generation/
# expect 200, content-type text/html
curl -I https://creatorain.com/product-image-generation/costs.html
# expect 200
```

---

## What I deliberately did NOT include

These are real concerns but not the right fit for *this* iteration. Document and defer:

- **Per-seller rate limiting (KV-based daily SKU cap).** No real sellers yet; cost circuit breaker (Phase 5) covers per-launch. Add when first real seller signs up.
- **Auth on the MCP endpoint.** Currently the URL is public. Acceptable for staging; before real seller use, add `Authorization: Bearer` check against a `seller_api_keys` table.
- **Splitting `launch_pipeline.ts` (347 lines) into pipeline-core + persistence + result-shape.** It reads top-to-bottom as a procedural orchestrator — splitting would add file-jumping for no behavior win. Re-evaluate if it grows past 500 lines.
- **Splitting `adapters/index.ts` per platform.** Both adapters share 90% logic; splitting would add duplication. Revisit when a platform-specific adapter diverges meaningfully.
- **Splitting `packages/types/src/tools.ts` per tool.** 236 lines is fine in one file with good headers.
- **Extracting a scorer base class.** amazon_scorer (208 lines) and shopify_scorer (109 lines) share spec-loading but their rubrics diverge meaningfully — a base class would have to use template-method pattern that obscures the per-platform rules. Keep two flat files until divergence makes sharing painful.
- **Auto-rollback on deploy failure.** `wrangler rollback` is one command; documented in RUNBOOK §4.1. Auto-rollback wiring is overkill at this stage.
- **OpenAPI / JSON Schema spec generation from Zod.** Phase C's API_CONTRACT.md is enough; auto-generating with `zod-to-openapi` is a Phase 6 nice-to-have.

---

## Sequence + checkpoints

```
Phase A (refactor, ~30m)
  A1 strip dashboard deps    → pnpm type-check 8/8 + dashboard build same size
  A2 split workers per file  → pnpm type-check 8/8 + 29 unit tests still pass
  A3 tool registration array → pnpm type-check 8/8 + 4 integration tests still pass
  CHECKPOINT: commit + push

Phase B (reliability, ~30m)
  B1 error wrapper           → write 1 wrapper unit test, apply to 5 v2 tools
  B2 health check enrich     → curl /health locally returns new shape
  CHECKPOINT: commit + push

Phase C (boundary, ~15m)
  C1 API contract doc        → 3 Zod schemas + docs/API_CONTRACT.md + dashboard imports types
  CHECKPOINT: commit + push

Phase D (deploy, ~30m)
  D1a push 3 Worker secrets  → wrangler secret list confirms 11 secrets
  D1  wrangler deploy        → curl /health returns version 0.2.0
  D2  prod v2 smoke test     → tools/list includes 5 new tools; deterministic scorers pass
  D3  creatorain.com route   → curl creatorain.com/product-image-generation/ returns 200
  CHECKPOINT: smoke pass = production-live; tag git release v2.0.0
```

Total wall-clock estimate: **~2 hours** for the full sequence executed cleanly.

Cost: **$0** through Phase D2. Phase D3 routing setup is free if option (b) — a Cloudflare Worker on creatorain.com is in the free tier.

---

## Stop conditions (when to halt and ask)

- Any phase's type-check or test count regresses
- Worker deploy succeeds but `/health` fails or returns unexpected version
- Production smoke test surfaces an existing v1 tool returning a different response shape than before (would mean we broke something on the v1 path)
- creatorain.com routing requires DNS changes to a record I don't have authority to modify

In any of these cases: stop, document the breakage, ask before continuing.
