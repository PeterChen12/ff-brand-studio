# Phase E · Iteration 02 — Stage Product workflow + best-of-input filter

**Problems:** #2 (one-click Stage Product button) + #8 (use the input
image directly if it's already good enough)
**Depends on:** E1 (regenerate working so review-then-stage works)
**Blocks:** none
**Estimated session length:** medium (1 PR, ~half day)

## Why now
The BFR client's mental model is: "I'm done reviewing this product —
push it to my admin." Today they have to Approve each asset
individually (which fires the asset.approved webhook) and trust that
BFR's listener glues them together. A product-level "Stage Product"
button is the natural one-click action. And per #8, if an input
reference is already publish-ready (high fill, white-bg, ≥2000px),
the wallet shouldn't burn $0.50 generating a near-duplicate — pass
the original through to the library directly.

## Files to touch

### Studio side (`apps/mcp-server/src`)

- `lib/best-of-input.ts` (NEW) — extends D6's `pickBestReference`:
  `isPublishReadyReference(score) → boolean` returns true when
  `fill ∈ [0.60, 0.75] && whiteness ≥ 0.95 && longestSide ≥ 2000`.
  Centralizes the threshold so the pipeline + the wizard agree
- `orchestrator/launch_pipeline.ts` — in the white-bg / main-hero
  loop, BEFORE invoking `runProductionPipeline`, check
  `isPublishReadyReference(...)` on the picked reference. If true:
  - Persist the original reference R2 URL into `platform_assets`
    with `slot = 'amazon-main' | 'shopify-hero'`, `costCents: 0`,
    `model_used: 'passthrough_original'`, `compliance_score:
    'EXCELLENT'`, `status: 'draft'`
  - Skip the worker invocation for that slot
  - Add a `notes[]` entry: "amazon-main passthrough — input quality
    exceeded threshold (skipped generation, saved $0.50)"
- `index.ts` — new endpoint `POST /v1/products/:id/stage` that:
  - Verifies the product belongs to the tenant
  - Verifies the tenant has `publish_destinations` containing a
    valid adapter (BFR has `["buyfishingrod-admin"]`)
  - Loads all `platform_assets` for this product with
    `status IN ('approved', 'draft')` plus the latest
    `platform_listings` row per surface
  - Calls the matching adapter's `stage(ctx)` method (new — see
    `integrations/buyfishingrod-admin.ts`)
  - Returns `{ ok: true, staged_count, listing_payload_summary }`
- `integrations/buyfishingrod-admin.ts` — extend the stub to
  implement `stage(ctx)`: POSTs to BFR's `/api/integrations/ff-brand-studio/stage-product`
  with `{ external_id, sku, name, copy, images: [{r2_url, slot}] }`
  HMAC-signed with `FF_STUDIO_WEBHOOK_SECRET`

### BFR side (`buyfishingrod-admin`)

- `app/api/integrations/ff-brand-studio/stage-product/route.ts` (NEW)
  — HMAC-verified inbound endpoint. Body: `{ external_id, sku, name,
  copy, images }`. Behavior: look up Product by external_id (created
  earlier via send-to-studio), set status=STAGING, insert
  ProductImage rows for all `images`, store the copy on
  `longDescription` / `bullets` / etc.

### Studio dashboard (`apps/dashboard/src`)

- `app/library/_client.tsx` — add `<StageProductButton>` next to the
  existing Download button on each product group. Disabled if the
  tenant has no publish_destinations or no approved assets yet
- `components/library/stage-product-button.tsx` (NEW) — for tenants
  with `publish_destinations: []` (non-enterprise), render a button
  styled identically but onClick navigates to
  `/settings?tab=channels` instead of POSTing. Shared component so
  the button looks consistent across tiers
- `app/launch/...` — also surface the button in the post-launch
  ResultPanel so the "happy path" (launch → review → stage) doesn't
  require navigating to /library

## Acceptance criteria

- [ ] BFR client launches a product → reviews assets → clicks "Stage
      Product" → BFR admin shows the product as STAGING with all
      images attached, within 5s
- [ ] A non-enterprise client (no `publish_destinations`) sees the
      same button but clicking it navigates to Settings → Channels
      where the Calendly CTA lives
- [ ] A launch whose hero reference scores ≥ threshold writes a
      passthrough `platform_assets` row with `costCents: 0` and
      `model_used: 'passthrough_original'`. The library renders it
      visually identical to a generated asset
- [ ] Cost preview in the launch wizard subtracts the
      passthrough-savings from the predicted total (line item:
      "Passthrough saved $0.50 — input was publish-ready")
- [ ] The new stage endpoint is HMAC-verified end-to-end (signed with
      the existing webhook secret; unsigned probe returns 401)

## Implementation notes

- The "stage" verb is distinct from "publish". Staging only places
  the product in BFR as DRAFT/STAGING for operator review. Publishing
  would push to live Stripe + storefront — out of scope here
- The adapter pattern at `integrations/buyfishingrod-admin.ts` was
  designed for this (publishAssets interface); we're just filling in
  the implementation
- Re-staging the same product (re-clicking Stage) should be
  idempotent: the BFR endpoint dedups images by r2_url, updates copy
  fields in place, doesn't duplicate ProductImage rows
- Passthrough threshold is per-slot — only applies to white-bg / main
  hero slots where a clean studio shot is the deliverable. Lifestyle
  + variant slots always generate (the model is doing real work
  there). Keep the threshold lookup in `lib/best-of-input.ts`'s
  `passthroughAllowedForSlot(slot) → boolean`

## Out of scope (do NOT do this iteration)

- Auto-publishing to live Stripe / storefront (that's enterprise
  Phase B-2 work)
- Staging to multiple destinations in one click (today only BFR
  destination is wired; pick adapter by tenant's first
  publish_destination)
- Per-image stage (granular "stage just this one image to BFR") —
  product-level only for v1
- Cross-tenant staging — privacy concern, tenant-scoped only
