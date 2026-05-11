# Phase F · Iteration 02 — BFR adapter `stage(ctx)` completion (R5)

**Refactor target:** complete the `integrations/buyfishingrod-admin.ts`
adapter so it implements a real product-level `stage(ctx)` method
instead of throwing `notImplemented`
**Depends on:** none (but pairs naturally with F3)
**Blocks:** F3's cleanest form (E2.1 best-of-input would flow through
this method instead of bulk-approve)
**Risk:** 🟠 medium — cross-service coordination (studio repo +
buyfishingrod-admin repo)
**Estimated session length:** medium-large (1 PR per side; ~half day
total)

## Why now
E2 shipped Stage Product as a thin wrapper over the asset-level bulk-
approve endpoint. Functionally correct but couples "stage a product"
to the per-asset event model — N webhook deliveries, N BFR-side DB
writes, no atomicity. A product-level adapter method gives:
- Single envelope (product + all assets + listing copy) in one POST
- Single BFR handler invocation, one transactional DB write
- Cleaner ground for E2.1 (best-of-input passthrough)
- Pattern reuse for future Amazon SP-API / Shopify Admin adapters

## Files to touch

### BFR side (`creatorain/buyfishingrod-admin`) — ship FIRST, dormant

- (new) `app/api/integrations/ff-brand-studio/stage-product/route.ts`
  — POST endpoint, HMAC-verified, accepts envelope shape below
- (new) `app/api/integrations/ff-brand-studio/stage-product/STAGE_ENDPOINT_NOTES.md`
  — operator runbook for the endpoint

### Studio side (`ff-brand-studio`) — ship SECOND

- `apps/mcp-server/src/integrations/buyfishingrod-admin.ts` — replace
  the `notImplemented` throw with a real `publishAssets(ctx)` impl
  that POSTs to BFR with HMAC signing using
  `FF_STUDIO_WEBHOOK_SECRET`
- `apps/mcp-server/src/index.ts` — new endpoint
  `POST /v1/products/:id/stage` that loads product + assets +
  listings, calls the adapter, returns the result
- (new) `apps/mcp-server/test/integrations/buyfishingrod-admin.test.ts`
  — unit tests for envelope shape, HMAC signing, error mapping

### Studio dashboard (`apps/dashboard/src`)

- `components/library/stage-product-button.tsx` — when env var
  `USE_PRODUCT_STAGE=true`, call `/v1/products/:id/stage` instead
  of `/v1/inbox/bulk-approve`. Old path stays default

## Envelope shape (studio → BFR POST body)

```
{
  external_id: string,   // BFR's product UUID
  external_source: "ff-brand-studio",
  sku: string,
  name: { en?: string, zh?: string },
  copy: { amazon-us?: {...}, shopify?: {...} },
  images: [{ slot: string, r2_url: string, platform: string }],
  staged_at: string  // ISO timestamp
}
```

## Acceptance criteria

- [ ] BFR-side endpoint deployed and reachable; unsigned POST returns
      401, signed POST returns 200 with the row dedup'd by external_id
- [ ] Studio-side `POST /v1/products/:id/stage` deployed; returns
      `{ ok: true, staged_count: N, adapter: "buyfishingrod-admin" }`
- [ ] Dashboard `<StageProductButton>` with env var on uses the new
      endpoint; with env var off uses the old bulk-approve path
      (both paths still work)
- [ ] Re-staging an already-staged product is idempotent — BFR side
      dedups on (external_id, r2_url) and updates copy fields in place,
      no duplicate ProductImage rows
- [ ] Adapter test suite passes: envelope shape, HMAC signature
      correctness, error mapping (BFR 4xx/5xx → ApiError with
      reasonable status code)

## Safety practices

- **Pin #2 — Branch-by-abstraction**: APPLIES via env var
  `USE_PRODUCT_STAGE`. Default `false`; flip on for BFR tenant first
- **Cross-service contract — ship receiver first**: BFR-side endpoint
  ships in a dormant state (no caller yet) before studio-side caller
- **Pin #5 — Bug-for-bug compat**: the new path produces the SAME
  ProductImage rows + copy updates on BFR's side as the old bulk-
  approve fan-out. Verify by comparing DB state before/after both paths

## Implementation notes

- HMAC signature reuses the existing `whsec_…` (FF_STUDIO_WEBHOOK_SECRET)
  — same secret BFR's existing webhook receiver uses. New endpoint
  validates with the same `verifySignature` helper
- The BFR-side endpoint maps the envelope onto its existing DB
  shape: Product (matched by external_id), ProductImage rows (deduped
  by src URL), longDescription/bullets/title fields from copy
- Studio adapter implementation reads
  `integration_credentials` for `provider='buyfishingrod-admin-webhook'`
  to get the BFR base URL. Falls back to a hardcoded
  `https://admin.buyfishingrod.com` if no row exists (BFR-only deploy)
- The existing bulk-approve path stays — it's used by the operator
  inbox to approve individual assets, which fires per-asset webhooks.
  Different use case, both stay

## Rollback plan

If the new endpoint silently mis-handles a stage:
1. Set `USE_PRODUCT_STAGE=false` on the worker → button reverts to
   bulk-approve path
2. The BFR-side endpoint stays deployed (dormant) — no rollback
   needed there since no caller will hit it
3. If the BFR-side endpoint is the failure mode, the dormant state
   is itself the rollback — set the studio env var off and the
   endpoint is unused

## Out of scope (do NOT do this iteration)

- Real Amazon SP-API or Shopify Admin adapters — those are future
  iterations once the BFR adapter pattern is proven
- Auto-publishing to live Stripe / storefront — staging only
- Listing copy editor in BFR's admin UI — out of scope; BFR
  receives copy and renders it as-is
- Removing the bulk-approve endpoint — it's still used by the inbox
