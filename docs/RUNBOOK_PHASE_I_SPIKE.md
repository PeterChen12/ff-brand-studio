# Phase I Activation Runbook

> One-shot playbook to take Phase I's production image pipeline from
> "scaffolded behind feature flag" to "running on dogfood tenant + spike
> numbers logged in ADR-0003." Follow top-to-bottom.

## What's already shipped

- `apps/mcp-server/src/pipeline/*` — Worker orchestrator + 6-step pipeline
- `apps/image-sidecar/` — Node + sharp service ready to deploy
- `products.kind` migration applied; 8 kind Derivers wired
- `tenant.features.production_pipeline` gates dispatch; default OFF
- ADR-0003 (`docs/adr/0003-image-pipeline-runtime.md`) with empty
  spike-numbers table waiting for real data

## What you provide

1. **Hosting** for the sidecar (Render free tier or Fly $5/mo)
2. **One dogfood tenant** with at least one product + reference image
3. **~$10 of API budget** for the 3-SKU spike

---

## Step 1 — Deploy the sidecar to Render (free tier)

1. Push the monorepo to GitHub if not already (you have it on
   `github.com/PeterChen12/ff-brand-studio`). ✓
2. Sign in to https://render.com, "New" → "Web Service" → connect the
   repo.
3. Set:
   - **Root directory:** `apps/image-sidecar`
   - **Runtime:** Docker
   - **Plan:** Free
   - **Health check path:** `/healthz`
4. Add these environment variables (NOT as secrets — Render's free
   tier hides them in the dashboard):
   ```
   IMAGE_SIDECAR_SECRET=<generate one — `openssl rand -hex 32`>
   R2_ACCESS_KEY_ID=<same value the Worker uses>
   R2_SECRET_ACCESS_KEY=<same value the Worker uses>
   R2_ACCOUNT_ID=40595082727ca8581658c1f562d5f1ff
   R2_BUCKET=ff-brand-studio-assets
   ```
5. Deploy. First build takes ~3 min (Docker build + sharp compile).
6. After "live" status:
   ```
   curl https://<your-sidecar>.onrender.com/healthz
   # → {"ok":true,"ts":...}
   ```

Free tier sleeps after 15 min idle and takes ~30 s to spin up on the
first request — fine for a dogfood spike, not for production traffic.
Upgrade to Render's $7/mo Starter when you're ready to default-on.

## Step 2 — Set the matching Worker secrets

```
cd apps/mcp-server

echo "https://<your-sidecar>.onrender.com" | wrangler secret put IMAGE_SIDECAR_URL
echo "<the same secret you set on Render>" | wrangler secret put IMAGE_SIDECAR_SECRET
```

Verify with `wrangler secret list` — you should see both names listed.

## Step 3 — Enable the feature flag on a dogfood tenant

Pick one tenant (probably your own). From a psql shell:

```sql
-- Find the tenant
SELECT id, name, plan, features FROM tenants WHERE name LIKE '%dogfood%' OR clerk_org_id = '<your_clerk_org_id>';

-- Flip the flag
UPDATE tenants
SET features = features || '{"production_pipeline": true}'::jsonb
WHERE id = '<that tenant id>';
```

Or call the Worker (no UI for tenant features yet — it's a Phase M+
deferred item):

```
psql "$DATABASE_URL" -c "UPDATE tenants SET features = features || '{\"production_pipeline\": true}'::jsonb WHERE id = '<tid>';"
```

## Step 4 — Run the 3-SKU spike

Pre-flight: confirm the dogfood tenant has wallet ≥ $30 (cleanup +
4 refines + 3 vision + lifestyle = ~$2.70/SKU × 3 = ~$8 + headroom).
Top up via the dashboard's `/billing` page.

Three test SKUs (one per kind family):

| Test | Kind | Suggested SKU |
|---|---|---|
| 1 | `long_thin_vertical` | a fishing rod |
| 2 | `compact_square` | drinkware (mug, water bottle) |
| 3 | `compact_square` | a handbag |

For each:
1. Upload the reference via `/products/new` on the dashboard.
2. Make sure the Kind dropdown matches the table above.
3. Open `/launch?product_id=<id>`, untick `dry_run`, click Launch.
4. Wait for completion — check `audit_events` for the per-step
   cost rows.

```
curl -H "Authorization: Bearer ff_live_<your_key>" \
     https://ff-brand-studio-mcp.creatorain.workers.dev/v1/audit?actions=launch.start,launch.complete,launch.failed
```

## Step 5 — Visual review + ADR fill-in

For each SKU, open `/library` and inspect:
- Is the studio shot's white background true (#ffffff)?
- Do the 3 detail crops show the kind-correct framing?
- Does each refine preserve the supplier image's identity?
- Is the lifestyle image text-free + on-brand?
- Are the 3 composite spec slides visually distinct?

Fill in the spike-numbers table in `docs/adr/0003-image-pipeline-runtime.md`
with real cost + wall-time per SKU. Run:

```
node scripts/audit-wallet-integrity.mjs
```

It should still report 0¢ drift across all tenants.

## Step 6 — Decide rollout

- **FAIR rate ≤ 10% across the 3 spike SKUs?** Default-on for new
  tenants — `UPDATE tenants SET features = features || '{"production_pipeline": true}'::jsonb;` (omit the WHERE).
- **FAIR rate > 10%?** Tune the per-kind prompts in
  `apps/mcp-server/src/pipeline/derivers/index.ts`. The most
  common failure mode (per `lykan_upload`) is over-eager
  silhouette re-shaping in `compact_square`; tighten the
  negative prompts.

## Rollback at any point

```sql
UPDATE tenants SET features = features - 'production_pipeline';
```

Worker code falls back to the legacy stub pipeline within one
launch — no state migration needed.
