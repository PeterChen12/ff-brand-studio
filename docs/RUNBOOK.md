# FF Brand Studio v2 — Production Runbook

Operational reference for deploying, monitoring, and recovering ff-brand-studio v2 in production. Read alongside `HANDOFF.md` (architecture, env, smoke tests) and `V2_FINAL_AUDIT.md` (test surface).

---

## 1. Pre-deploy verification

Run before any production deploy. All four must pass.

```bash
# 1. Type-check (8 packages)
pnpm type-check

# 2. Unit tests (28+ tests across 4 suites)
pnpm --filter ff-mcp-server test

# 3. Integration tests against live Postgres (4 tests)
PGPASSWORD=... pnpm --filter ff-mcp-server test:integration

# 4. Schema is in sync (idempotent — safe to re-run)
PGPASSWORD=... node scripts/apply-v2-schema.mjs
```

If any of the above fails, stop and investigate. **Do not deploy** with red tests.

---

## 2. Deploy procedure

### 2.1 Worker (apps/mcp-server)

```bash
# Set Cloudflare credentials (HANDOFF.md §"Deploy Commands")
$env:CLOUDFLARE_EMAIL="peter@creatorain.com"
$env:CLOUDFLARE_API_KEY="..."
$env:CLOUDFLARE_ACCOUNT_ID="40595082727ca8581658c1f562d5f1ff"

cd apps/mcp-server
npx wrangler deploy
```

Verify within 60s of deploy:
```bash
curl https://ff-brand-studio-mcp.creatorain.workers.dev/health
# expect {"status":"ok",...}
```

### 2.2 Dashboard (apps/dashboard)

```bash
cd apps/dashboard
pnpm run build
cd ../mcp-server
npx wrangler pages deploy ../dashboard/out --project-name ff-brand-studio --branch master --commit-dirty
```

Verify:
```bash
curl -I https://ff-brand-studio.pages.dev
# expect 200
```

### 2.3 Database schema

```bash
PGPASSWORD=... node scripts/apply-v2-schema.mjs
```

This is idempotent. Run after every schema-touching commit, before redeploying the Worker.

---

## 3. Smoke tests (run after every deploy)

```bash
# Health
curl https://ff-brand-studio-mcp.creatorain.workers.dev/health

# DB connectivity
curl https://ff-brand-studio-mcp.creatorain.workers.dev/api/costs

# v2 launch_product_sku dry-run (zero-cost, validates plumbing)
curl -X POST https://ff-brand-studio-mcp.creatorain.workers.dev/messages \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"launch_product_sku","arguments":{"product_id":"<existing UUID>","dry_run":true}}}'

# v2 ad-flagger sanity
curl -X POST https://ff-brand-studio-mcp.creatorain.workers.dev/messages \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"flag_us_ad_content","arguments":{"text":"Best #1 product, guaranteed!","surface":"amazon_title"}}}'
# expect flag_count >= 2 (best + guaranteed)
```

---

## 4. Rollback

### 4.1 Worker rollback

```bash
# List recent deployments
npx wrangler deployments list

# Roll back to a specific deployment ID
npx wrangler rollback --message "rollback to <reason>"
```

Worker rollbacks are atomic and take <30s.

### 4.2 Schema rollback

The v2 schema is **additive**. Rolling back a Worker deployment does NOT require a schema rollback — old code can coexist with the new tables (it just won't use them).

If a v2 schema change is destructive (e.g., DROP COLUMN), the rollback procedure is:
1. Stop traffic to the Worker.
2. Restore from the latest pg_dump backup.
3. Redeploy the Worker.

For Phase 1–4 changes, no destructive migrations have been written. If a future change is destructive, it should ship in a separate dedicated PR with an explicit rollback script committed alongside.

### 4.3 Dashboard rollback

```bash
# Find a previous deployment in the Cloudflare Pages dashboard
# Click "Promote to production" on the desired version
```

Or roll back via wrangler:
```bash
npx wrangler pages deployments list --project-name ff-brand-studio
```

---

## 5. Key rotation

### 5.1 Anthropic API key

```bash
cd apps/mcp-server
# Get new key from console.anthropic.com → API Keys
echo "sk-ant-api03-..." | npx wrangler secret put ANTHROPIC_API_KEY
```

The Worker picks up the new value within ~30s of the deploy. No restart required.

### 5.2 fal.ai key

```bash
cd apps/mcp-server
echo "..." | npx wrangler secret put FAL_KEY
```

### 5.3 OpenAI key (currently 401-blocked per HANDOFF gotcha #1)

```bash
cd apps/mcp-server
echo "sk-svcacct-..." | npx wrangler secret put OPENAI_API_KEY
```

### 5.4 Postgres password

If rotated, update in three places:
1. The Postgres server itself (`ALTER USER postgres WITH PASSWORD '...'`)
2. Wrangler secret: `echo "..." | npx wrangler secret put PGPASSWORD`
3. CreatoRain workspace `.env` (canonical source) — `creatorain/Claude_Code_Context/.env`

Update local dev clones via `cp creatorain/Claude_Code_Context/.env-derived-values .env` (manual).

---

## 6. Cost monitoring

### 6.1 Per-launch cost cap

The orchestrator accepts a `cost_cap_cents` parameter. Set this in the dashboard launch flow to prevent runaway spend:

```ts
launch_product_sku({
  product_id: "...",
  cost_cap_cents: 1000, // $10.00 max per launch
})
```

When exceeded, the launch halts at the current adapter target with `status: "cost_capped"` and the launch_runs row is updated. Remaining adapter targets do not run.

### 6.2 Aggregate cost dashboard

Query Postgres directly:
```sql
SELECT
  date_trunc('day', created_at) AS day,
  count(*) AS runs,
  sum(total_cost_cents) / 100.0 AS total_usd,
  sum(hitl_interventions) AS hitl_interventions
FROM launch_runs
WHERE created_at > now() - interval '30 days'
GROUP BY 1
ORDER BY 1 DESC;
```

Expected: ~$2.30 inference per SKU once Phase 2 generators are wired. Monthly target $300–700 for a 50-SKU catalog.

### 6.3 Per-model cost split

```sql
SELECT
  model_used,
  count(*) AS calls,
  sum(cost_cents) / 100.0 AS usd
FROM platform_assets
WHERE created_at > now() - interval '7 days'
GROUP BY 1
ORDER BY usd DESC;
```

Phase 3 currently shows `model_used = 'adapter:phase3'` because workers are stubbed at $0. Phase 2 wiring populates real model strings.

---

## 7. Common failure modes

### 7.1 Worker returns 500 on `/messages` calls

Likely causes (in order of probability):
1. **Anthropic key 401** — rotate per §5.1.
2. **Postgres connection refused** — server `170.9.252.93:5433` down. Check the host (it's shared with CreatoRain).
3. **R2 misconfigured** — `R2_PUBLIC_URL` env var wrong or bucket policy changed.

Check logs:
```bash
npx wrangler tail
```

### 7.2 OpenAI 401 (HANDOFF gotcha #1)

`generate_bilingual_infographic` and `generate_infographic_overlay` (Phase 4) will fail. Mitigation: rotate key OR pivot the infographic step to fal.ai's GPT Image 2 endpoint (per HANDOFF gotcha #1's note).

The deterministic compliance scorers do NOT depend on OpenAI; v2 launches still succeed for non-infographic slots.

### 7.3 Compliance scorer always rates POOR

Likely a `platform_specs` row drift. Re-seed:
```bash
PGPASSWORD=... node scripts/apply-v2-schema.mjs
```

The seed uses `ON CONFLICT DO UPDATE` so it'll bring rows back to the canonical values.

### 7.4 Integration test fails with `duplicate key value violates unique constraint platform_assets_uniq_variant_slot`

This was a real bug we fixed (V2_FINAL_AUDIT.md §2). The adapter now uses DELETE+INSERT for idempotency. If it recurs, check that `apps/mcp-server/src/adapters/index.ts` `runAdapter()` does the DELETE before INSERT — Drizzle's `onConflictDoUpdate` had a wire-format issue on v0.38 with the multi-column unique index.

### 7.5 Vision pass returns POOR with `vision_error`

The `vision_pass=true` Opus 4.7 call failed. Common causes:
- `ANTHROPIC_API_KEY` not set on the Worker (check `wrangler secret list`)
- Image URL not reachable from the Worker (check R2 public URL)
- Rate limit on Anthropic API (back off + retry)

The deterministic scorer still works without vision; the launch continues with the deterministic rating.

---

## 8. Provenance & EU AI Act Art. 50 (binding 2026-08)

Every v2-generated platform_assets row carries provenance metadata in `generation_params.provenance`:

```json
{
  "model": "flux-kontext-pro:stub",
  "canonical_kind": "white_bg",
  "canonical_url": "...",
  "canonical_dims": { "width": 3000, "height": 3000 },
  "adapter_version": "v2-phase3",
  "generated_at": "2026-04-25T...",
  "synthid_present": false,
  "c2pa_manifest_url": null
}
```

Phase 2 generators will set `synthid_present: true` for Nano Banana Pro outputs (which carry SynthID natively) and populate `c2pa_manifest_url` when upstream provides it.

Audit query:
```sql
SELECT id, platform, slot, generation_params->'provenance' AS provenance
FROM platform_assets
WHERE generation_params->'provenance'->>'synthid_present' = 'false'
LIMIT 100;
```

Use this to identify assets that may need re-generation through SynthID-emitting models before EU AI Act Art. 50 enforcement begins (binding 2026-08-02).

---

## 9. Deferred items (read V2_STATUS.md for live tracking)

Not yet built; document for whoever picks up next:

- **Phase 2 real generators** (~1.5–2 weeks). Replaces `apps/mcp-server/src/orchestrator/workers.ts` stubs with fal.ai calls. Requires R2 access keys (currently missing per `.env` TODOs).
- **Phase 5 dashboard launch flow** (~1 week). Next.js page at `apps/dashboard/app/launch/[productId]/page.tsx` with SSE streaming progress.
- **Demo LoRAs** (3 × $8 = $24). Train one each for hat/tumbler/hoodie via fal.
- **GitHub→Cloudflare Pages auto-deploy** (~1 hour). One-click in CF dashboard once GitHub repo is connected.

---

## 10. Contact / escalation

- **Owner:** Peter Chen — peter@creatorain.com
- **Repo:** https://github.com/PeterChen12/ff-brand-studio
- **Live URLs:** see `HANDOFF.md` §"Live Production URLs"
- **Postgres host:** `170.9.252.93:5433` (shared with CreatoRain workspace)
