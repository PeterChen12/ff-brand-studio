# Phase B Iteration — Ecommerce Integration & Onboarding Polish

**Status:** Plan only. Do not start executing until reviewed.
**Date:** 2026-05-08
**Scope:** Frontend cleanup of unfinished surfaces + backend integration so a customer admin (e.g. `buyfishingrod-admin`) can push drafts in and receive published assets back.

---

## 0. Direct answer to "can I just include an API to connect to any ecommerce admin page and auto-upload products?"

**Today: no.** Pipeline is one-way (reference images → generated R2 assets returned in response + via `launch.complete` webhook). What's missing for the workflow you described:

1. **Inbound** — no `POST /v1/products/ingest` that accepts a draft from a customer admin (no SKU mirroring, no external-id mapping).
2. **Outbound to ecommerce platforms** — no Amazon SP-API or Shopify Admin push exists. Channels panel shows them as locked "Enterprise feature" cards (`channels-panel.tsx:74–122`); the launch wizard hardcodes `platforms = ["amazon", "shopify"]` (`launch-wizard.tsx:154–157`) but only renders compliance-targeted assets — it doesn't actually publish anywhere.
3. **Credentials storage** — no `integration_credentials` / `amazon_sp_credentials` / `shopify_oauth_tokens` tables. There's only an unused `seller_profiles.amazonSellerId` text column.

What we *do* have working: Phase A robustness primitives (idempotency, async launch infra in schema, zombie sweeper, webhook delivery with HMAC + retries, phase visibility). So the foundation is good — Phase B is the integration layer on top.

There's a **pragmatic middle path** that ships in days instead of weeks: customer's admin listens to our `launch.complete` webhook and pulls R2 URLs into their own image table via their own `/api/products/[id]/images` endpoint. No marketplace OAuth required. We do this first, then marketplace push as Phase B-2.

---

## 1. Customer journey (target end-state)

```
Customer (e.g. BFR team) lands on ff-brand-studio
  → Sees ONE call-to-action: "Set up enterprise account → Schedule onboarding"
  → Books a 30-min slot via Google Calendar (already wired)
  → On the call we (manual operator):
      • create Clerk org + tenant
      • mint a tenant-scoped ff_live_ API key
      • optionally provision marketplace credentials (Phase B-2)
      • optionally install a webhook subscription pointing back at customer admin
  → Customer's admin (their existing UI, e.g. buyfishingrod-admin)
      gets a new "Send to FF Brand Studio" button on the product edit page
      → calls POST /v1/products/ingest with { external_id, sku, name, references[] }
      → calls POST /v1/launches with the returned product_id
      → polls or receives webhook on launch.complete
      → pulls r2_url assets back into their own catalog
      → ships to ecommerce site through their existing pipeline (or we push via SP-API/Shopify in B-2)
```

The existing dashboard at image-generation.buyfishingrod.com remains as the **operator console** (us) and as the **review surface** for HITL gates. Most customer interaction lives in their admin, not ours.

---

## 2. Frontend iteration

### F1. Unify "Set up enterprise account" + "Schedule meeting" → ONE button

**Why this matters:** today the dashboard shows Amazon/Shopify as if they're available, but Connect buttons are disabled with no path forward except a small "Schedule onboarding call →" link tucked inside Channels tab. The header should make the gating explicit.

**Changes:**
- `apps/dashboard/src/components/settings/channels-panel.tsx:128` — current `<a href={CALENDLY_URL}>Schedule onboarding call →</a>` becomes the **primary** CTA in the panel, not a footer link. Replace the two locked cards' "Connect — Enterprise feature" buttons with the single Calendly link directly on each card. Remove the duplicate footer.
- `apps/dashboard/src/components/launch-wizard.tsx:516–541` — the locked "Push to Seller Central" / "Push to Shopify Admin" panel should change copy from "Schedule onboarding call →" (which currently routes to `/settings?tab=channels` then bounces) to a direct Calendly link. One hop, not two.
- Add a top-bar callout for tenants without `enterprise=true` feature flag: **"Set up enterprise account · Schedule onboarding →"** as a single pill button, visible until the feature flag flips. Place it in `apps/dashboard/src/components/site-header.tsx` (or equivalent shell).

**Feature flag plumbing:**
- Add `tenants.features.enterprise: boolean` (already JSONB, just convention)
- Operator flips it server-side when integration is provisioned
- Dashboard reads it from `/v1/tenant` and conditionally renders gates

### F2. Hide / soften unfinished surfaces in the launch wizard

**Problem:** `platforms = ["amazon", "shopify"]` is hardcoded and presented as a fait accompli even though no actual Amazon/Shopify push happens. Users assume publishing is automatic; it's not.

**Changes (in priority order):**
1. Rename the "✓ Amazon US (7 image slots)" / "✓ Shopify DTC (5 image slots)" chips to **"Optimize for: Amazon US — 7 image specs"** etc. — make it explicit these are *compliance targets*, not destinations.
2. Below the chips, add a small note: *"Generated assets are returned to your dashboard. Direct push to Seller Central / Shopify Admin is an enterprise feature → Schedule onboarding."*
3. Once enterprise is provisioned, the locked panel at `launch-wizard.tsx:516–541` becomes a real toggle: **"Auto-publish on approval"** — if checked, on HITL approval we POST to the configured marketplace adapter.

### F3. Settings → Channels page reorganization

**New structure:**
- **Section 1 — API access** (already exists at `/settings?tab=api-keys`): keep
- **Section 2 — Webhook subscriptions** (already exists at `/settings?tab=webhooks`): keep
- **Section 3 — Ecommerce destinations** (rebuild from current channels panel):
  - For non-enterprise tenants: single big "Schedule onboarding →" Calendly card. Hide the Amazon/Shopify cards entirely. Don't bait users with locked OAuth flows that don't exist.
  - For enterprise tenants: actual integration cards with status badges (connected / disconnected / token expired) + reconnect buttons. **This needs the credentials backend to ship first (B6 below).**
- **Section 4 — Tenant** (already exists at `/settings?tab=tenant`): keep

### F4. Operator console for HITL review

The dashboard today is missing the customer-facing review flow. When a launch returns `hitl_blocked`, the customer's admin or our operator console needs a queue.

- New page `/inbox` (or rename `/library` to `/inbox`): list runs with `status='hitl_blocked'`, filter by tenant, click into per-asset compliance issue list
- For each FAIR asset: show original ref + generated + thumbs of refinement_history; Approve / Reject buttons
- Approve → flips `platform_assets.status='approved'`; if enterprise has auto-publish on, fire marketplace adapter
- Reject → triggers `regenerate` with operator notes

This is independent of the marketplace push and unblocks the current `hitl_blocked → ?` dead-end.

---

## 3. Backend iteration

### B1. Inbound ingest API (`POST /v1/products/ingest`)

Today products are created via `POST /v1/products` after a separate `/v1/products/upload-intent` round-trip — designed for the dashboard form, not for an external admin that already has the data + image URLs.

**New endpoint:**
```
POST /v1/products/ingest
Headers: Authorization: Bearer ff_live_..., Idempotency-Key: <uuid>
Body: {
  external_id: string,        // customer's product ID, e.g. cuid from buyfishingrod-admin Product.id
  external_source: string,    // "buyfishingrod-admin" | "shopify-app" | etc.
  sku: string,
  name_en: string,
  name_zh?: string,
  category: string,
  kind: string,
  description?: string,
  references: [
    { url: string, kind: "hero" | "lifestyle" | "detail", alt?: string }
    // we fetch + re-host to R2 server-side, no presigned-URL dance
  ],
  variants?: [{ sku, color?, pattern?, attributes? }],
  tags?: string[]
}
Response: 201 { product_id, sku, references_uploaded: N, billing: { onboard_charged_cents } }
```

**Behavior:**
- Tenant scoped via API key
- Idempotent on `(tenant_id, external_source, external_id)` — re-POST returns existing product_id
- Server fetches each reference URL, validates content-type + size (cap 20MB matches sidecar), uploads to R2, inserts product_references rows. Reuse existing R2 helper.
- Charges `PRODUCT_ONBOARD_CENTS` once per unique external_id
- Errors return Stripe-style `{ error: { code, message, param? } }` (start a typed error taxonomy here — see B7)

**New columns on products table:**
- `external_id text` (nullable; indexed with tenant_id)
- `external_source text` (nullable)
- Unique index on `(tenant_id, external_source, external_id)` where both not null

### B2. Marketplace adapter abstraction

Don't hardcode Amazon/Shopify into the pipeline. Extract a `MarketplaceAdapter` interface:

```ts
// apps/mcp-server/src/integrations/adapter.ts
export interface MarketplaceAdapter {
  platform: "amazon" | "shopify" | "buyfishingrod-admin" | string;
  publishAssets(args: {
    tenant: Tenant;
    productId: string;
    variantId: string;
    assets: Array<{ slot: string; r2Url: string; width: number; height: number }>;
    listing?: { title: string; bullets: string[]; description: string };
  }): Promise<{ external_listing_url?: string; external_listing_id?: string }>;
}
```

Implementations:
- `apps/mcp-server/src/integrations/buyfishingrod-admin.ts` — POSTs to customer's `/api/products/[id]/images` (their existing endpoint per buyfishingrod-admin schema). **Ship this first** — no marketplace OAuth, just a tenant-configured base URL + API key.
- `apps/mcp-server/src/integrations/amazon-sp-api.ts` — Phase B-2, requires LWA OAuth + Feeds API
- `apps/mcp-server/src/integrations/shopify-admin.ts` — Phase B-2, requires Shopify Partner app + product/productCreate GraphQL

Selection: `tenants.features.publish_destinations: string[]` — list of adapter names to invoke on approval.

### B3. Webhook event surface for customer admins

Already exists for `launch.complete` / `launch.failed`. Add:
- `product.ingested` — fires from B1 on successful create. Payload includes `product_id` + the customer's `external_id` so they can correlate
- `asset.approved` — fires when a `platform_assets.status` flips to `approved` in the operator console (F4)
- `asset.published` — fires when an adapter (B2) returns success; payload includes `external_listing_url`
- `asset.rejected` — fires when operator rejects an asset; includes reason

Customer admin can subscribe to any subset of these via existing `/v1/webhooks` CRUD.

### B4. Outbound webhook → buyfishingrod-admin auto-update

The minimum viable integration for the BFR case study, no marketplace OAuth needed:

1. buyfishingrod-admin gets a new endpoint: `POST /api/integrations/ff-brand-studio/webhook` (HMAC-verified using shared secret)
2. Listens for `asset.approved` events
3. Looks up Product by `payload.external_id` (which is buyfishingrod-admin's `Product.id`)
4. POSTs each asset's r2_url to its own `/api/products/[id]/images` endpoint (already exists per the inventory) — or adds a sortOrder-aware bulk variant
5. If `payload.listing` is present, updates `Product.metaTitle / metaDescription / longDescription`

This makes the loop close without us having to build SP-API. It also serves as the reference implementation for the customer-side adapter we'll document for other ecommerce admins.

### B5. "Send to FF Brand Studio" button in buyfishingrod-admin

- New file: `buyfishingrod-admin/app/(dashboard)/products/[id]/_components/send-to-studio-button.tsx`
- Visible only when `process.env.FF_STUDIO_API_KEY` is configured
- Click → `POST /api/products/[id]/send-to-studio` (new route in buyfishingrod-admin) → server-side calls ff-brand-studio's `POST /v1/products/ingest` with the product's S3 image URLs as references → stores `product.importJobId = <ff-studio run_id>` (importJobId column already exists on the Product schema!)
- Status badge on the product edit page: "FF Studio: pending / running / hitl_review / approved / published"
- Polling or webhook-driven update (B4)

### B6. Credentials storage tables (Phase B-2 prereq)

When marketplace push lands:

```sql
CREATE TABLE integration_credentials (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  provider text NOT NULL,                      -- "amazon-sp-api" | "shopify-admin" | "buyfishingrod-admin-webhook"
  account_label text,                          -- "Acme USA Seller"
  encrypted_credentials jsonb NOT NULL,        -- KMS-wrapped per-tenant
  scopes text[],
  expires_at timestamptz,
  status text NOT NULL DEFAULT 'active',       -- active | revoked | needs_reauth
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz,
  UNIQUE (tenant_id, provider, account_label)
);
```

Encryption strategy: separate KMS key per Cloudflare Worker, envelope-encrypt the per-tenant blob. Don't roll our own crypto — use `@noble/ciphers` AES-GCM with a Worker secret-bound key.

### B7. Typed error taxonomy (carry over from earlier Phase A wishlist)

Today errors are mostly free-form. Settle on:
```ts
{ error: { code: "..." , message: "...", param?: "...", request_id: "...", doc_url?: "..." } }
```

Codes to define now (used by B1 + adapters):
- `idempotency_conflict` (already exists)
- `idempotency_in_flight` (already exists)
- `wallet_insufficient`
- `validation_error` (with `param`)
- `rate_limited` (with Retry-After)
- `external_id_conflict`
- `reference_unreachable` (B1 fetch failure)
- `marketplace_credential_missing`
- `marketplace_token_expired`
- `internal_error` (with request_id)

Document at `/docs/api/errors` page.

### B8. Async launches (defer A1)

Cloudflare Queues opt-in is needed. Once enabled:
- `wrangler queues create launch-pipeline`
- Add binding + consumer
- `POST /v1/launches?async=true` returns 202 + run_id; queue handler runs the pipeline; `launch.complete` webhook fires on finalize
- For the buyfishingrod-admin integration, default to `async=true` since their UI doesn't need to block

This unblocks long pipelines beyond the 5-min sync cap (current parallelization keeps us at ~3 min so this is not urgent, but it's the proper architecture).

---

## 4. Sequencing and gates

```
Week 1 (frontend hygiene + minimum-viable inbound):
  ✓ F1  Unify "Schedule onboarding" CTA across dashboard      [1 day]
  ✓ F3  Settings/Channels reorg (hide unimplemented cards)    [1 day]
  ✓ B1  POST /v1/products/ingest endpoint                     [2 days]
  ✓ B7  Typed error taxonomy (apply to B1)                    [0.5 day]
  Gate: tenant can ingest a product via API key

Week 2 (outbound minimum-viable + BFR pilot):
  ✓ B3  Webhook event surface (asset.approved/published/etc.) [1 day]
  ✓ B4  buyfishingrod-admin webhook listener                  [1.5 days]
  ✓ B5  "Send to FF Brand Studio" button in BFR admin         [1 day]
  ✓ F4  Operator inbox / HITL review queue                    [2 days]
  Gate: BFR team can push a draft from their admin → review in our inbox → assets land back in their catalog. End-to-end demo.

Week 3 (polish + activate enterprise on BFR tenant):
  ✓ F2  Launch wizard copy fixes                              [0.5 day]
  ✓ B2  MarketplaceAdapter abstraction (refactor)             [1 day]
  ✓ B8  Async launches (Cloudflare Queues opt-in required)    [1 day]
  ✓ Provision BFR tenant with enterprise=true + webhook subscription pointing at their admin
  Gate: BFR pilot live in production

Week 4+ (Phase B-2: real marketplace push):
  ✓ B6  Credentials storage + envelope encryption             [2 days]
  ✓ Amazon SP-API adapter + LWA OAuth                         [5 days]
  ✓ Shopify Admin adapter + Partner app                       [3 days]
  Gate: tenants can self-serve OAuth-connect their seller account, and approved assets auto-push.
```

**Hard prerequisites that block the timeline:**
- Cloudflare Queues account opt-in (one-click in CF dashboard) — needed for B8
- Amazon Developer account + SP-API approval — needed for B-2 Amazon adapter (~1–2 weeks lead time, apply now)
- Shopify Partner account — needed for B-2 Shopify adapter (~1 day)

---

## 5. Out of scope (deliberately deferred)

- Multi-tenant self-serve OAuth flow for marketplaces (manual operator provisioning is fine until ~10 enterprise tenants)
- Sandbox tenant for API testing (use existing dry_run flag for now)
- SDK auto-generation — write hand-curated curl examples + a thin TypeScript wrapper for B1/B3/B5 first; only auto-gen when we have >3 endpoint additions/month
- CN marketplaces (Tmall/JD) — out of scope per the v2 pivot memo (Amazon US + Shopify DTC only)

---

## 6. Open questions for review

1. **HITL review surface** — should asset approval live in *our* dashboard (operator console) or in the *customer's* admin? F4 assumes ours. If customers want to review in their own UI, B3 needs an additional `asset.review_required` event with thumb URLs and the customer's admin renders the queue. Pick one before starting Week 1.
2. **External-id uniqueness scope** — `(tenant_id, external_source, external_id)` is what B1 proposes. Confirm we never want a single tenant ingesting the same external_id from two sources (e.g. same SKU from both buyfishingrod-admin and a Shopify import).
3. **Enterprise feature flag rollout** — is `tenants.features.enterprise` the right shape, or should it be `tenants.plan = 'enterprise'` (already exists)? Plan column is more discoverable but less granular.
4. **Webhook retry on customer side** — buyfishingrod-admin's listener (B4) needs to be idempotent (we retry up to 5x with exp backoff). Should we mandate a `Idempotency-Key`-style header on outbound webhooks, or rely on `event_id` already in the payload? Latter is simpler.
5. **Pricing** — does ingest charge `PRODUCT_ONBOARD_CENTS` on every successful B1 call (with idempotent re-POST being free), or is enterprise tier flat-rate? Affects wallet UX significantly.

Resolve these 5 before kicking off Week 1.
