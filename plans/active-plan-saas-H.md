# Phase H — Self-Serve Upload + Stripe Billing (detailed plan)

> Detailed plan for Phase H of the SaaS iteration. Depends on Phase G
> being complete (auth + tenant column + wallet helpers + audit log).
> See `plans/saas-iteration-plan.md` for the broader sequence (G–M).

**Goal of Phase H**

A new agency can sign up, complete onboarding in <3 minutes, upload
their first product (drag-drop reference images + a simple form), top
up their wallet via Stripe, and run their first paid launch — all
without anyone on our side touching a seed script.

This is the iteration that turns the platform from "internal demo" into
"a thing customers can actually use".

---

## ADR-0005 — Pricing schema + margin policy

### Decision

Pay-as-you-go credits, no subscription tier in MVP. Simple line-items
that a marketing professional can scan in 5 seconds:

| Charge | Price | Triggered by |
|---|---|---|
| **Onboard a product** | **$0.50** | One-time, on `POST /v1/products` |
| **Generate an image** | **$0.50** | Per platform_asset row written by the orchestrator (production-quality 7-view + iterations) |
| **Generate a listing** | **$0.10** | Per platform_listings row written (per surface × language) |
| **Regenerate with feedback** | **$0.30** | Per single-asset / single-field regen (Phase K) |
| **Free credit at signup** | **$5.00** | One-time, granted by Phase G G1.3 webhook |

### Cost-of-goods analysis (raw FAL + Anthropic numbers)

| Step | Provider | Unit cost | Per-launch cost |
|---|---|---|---|
| GPT Image 2 cleanup pass | OpenAI | ~$0.06/img | ~$0.42 (7 img) |
| Nano Banana Pro dual-ref refine | FAL | $0.30/call | ~$2.10 (7 img × 1 call) |
| CLIP triage | Workers AI / Replicate | ~$0.001/img | ~$0.01 |
| Sonnet 4.6 SEO listing (cached prompt) | Anthropic | ~$0.025/listing | ~$0.10 (4 surfaces) |
| Opus 4.7 vision adjudication (only when CLIP < 0.78) | Anthropic | ~$0.02/img | ~$0.04 (avg 2 escalations) |
| Storage + Worker compute + audit/billing overhead | CF | ~$0.02/SKU amortized | $0.02 |
| **Total raw cost / SKU full-pipeline** | | | **~$2.69** |

### Pricing applied to a typical full launch

A "full launch" = 1 product onboarded + 7 Amazon images + 5 Shopify
images + 4 SEO listings (Amazon-EN, Shopify-EN, Tmall-ZH, JD-ZH if the
agency targets all 4 surfaces — most won't).

| Item | Qty | Unit | Subtotal |
|---|---|---|---|
| Onboard product | 1 | $0.50 | $0.50 |
| Images | 12 | $0.50 | $6.00 |
| Listings | 4 | $0.10 | $0.40 |
| **Total billed** | | | **$6.90** |
| Cost of goods | | | ~$2.69 |
| **Gross margin** | | | **~61%** |

For a US-only agency targeting just Amazon (the typical case):
- 1 onboard + 7 images + 1 listing = $0.50 + $3.50 + $0.10 = **$4.10**
- Cost of goods ~$1.60 → **~61% margin**

### Why not subscriptions in MVP

- Marketing agencies are highly seasonal — they pulse-buy when they're
  onboarding a new client, then go quiet. Subscriptions over-charge
  during quiet months and under-charge during onboarding pushes.
- Per-action pricing maps cleanly to their internal billing of their
  end-clients ("we generated 12 images for ACME at $0.50 each = pass
  through $6.00 to their invoice").
- Subscriptions can be added in Phase M+ if a customer asks for them
  (Pro $49/mo with $60 credits + faster queue, etc.).

### Free-credit policy

- $5.00 on signup → covers ~1 single-platform launch ($4.10) end-to-end.
  Enough for a thorough "kick the tires" but not enough to abuse.
- No expiration on free credits. Wallet balance is permanent until used.
- No refunds on consumed credits except for orchestrator failures (where
  the wallet is automatically credited back per Phase G G4.4).

### Negative-balance / cost-cap policy

- Hard wall: tenant cannot fire a launch when balance would go below 0.
- Soft wall: pre-flight modal warns at <$1.00 balance with a top-up CTA.
- Per-launch cap: orchestrator clamps to `min(wallet_balance,
  tenant.max_per_launch_cents)`. Default `max_per_launch` = $10. Tenants
  can lower (never raise) via settings.
- Dunning is unnecessary because we charge before fulfillment.

### Consequences

- Every new signup costs us up to $5 in COGS if they spend the full
  credit. Acceptable customer-acquisition cost.
- Every launch needs accurate cost prediction up-front (G4 already
  handles refunds for over-charging; under-charging would let a launch
  exceed budget). Orchestrator must compute predicted cost from
  `(plan.lifestyles + plan.variants + plan.video) × per-image-rate +
  surfaces × per-listing-rate` before charging.
- Pricing is a `tenant.plan = 'free' | 'paid'` column, but the rates
  are the same across plans for now. Sets up the schema for
  subscriptions later.

### Alternatives considered

- **Cost-plus pricing (1.6× FAL)**: rejected because per-image costs
  fluctuate (Nano Banana Pro can be $0.20–$0.40 depending on the
  endpoint version). Marketing pros want to budget; "$0.50" beats
  "between $0.32 and $0.64 depending on FAL's daily mood".
- **Bundled SKU pricing ($5/SKU all-in)**: rejected because some SKUs
  don't need 7 images (a single accessory might want 2). Per-image
  scales with what you actually consume.
- **Subscription only**: rejected — see "why not subscriptions" above.

---

## Architecture sketch — upload flow

```
Browser                   Worker                    R2                   Postgres
   │                        │                        │                       │
   │ POST /v1/products      │                        │                       │
   │   /upload-intent       │                        │                       │
   │ { name, ext: 'jpg'×N } │                        │                       │
   ├───────────────────────▶│                        │                       │
   │                        │ generate N presigned   │                       │
   │                        │ PUT URLs               │                       │
   │                        │ valid 10 min           │                       │
   │ { intent_id, urls[] }  │                        │                       │
   │◀───────────────────────┤                        │                       │
   │                        │                        │                       │
   │ PUT each URL ──────────┼────────────────────────▶ store at              │
   │ (direct, no Worker)    │                        │ tenant/<tid>/...      │
   │                        │                        │                       │
   │ POST /v1/products      │                        │                       │
   │ { intent_id,           │                        │                       │
   │   metadata,            │                        │                       │
   │   uploaded_keys[] }    │                        │                       │
   ├───────────────────────▶│                        │                       │
   │                        │ HEAD each key (verify) │                       │
   │                        ├───────────────────────▶│                       │
   │                        │                        │                       │
   │                        │ chargeWallet $0.50     │                       │
   │                        │ INSERT product +       │                       │
   │                        │   variant + refs ──────┼──────────────────────▶│
   │                        │ audit.product.create   │                       │
   │ { product_id, ... }    │                        │                       │
   │◀───────────────────────┤                        │                       │
```

Direct-to-R2 PUT keeps Worker CPU + bandwidth out of the critical path
(uploads bypass the 10MB request limit). The intent → upload → finalize
pattern matches Stripe Checkout's `create-session → redirect → webhook`
shape, which is familiar to Stripe-aware engineers.

---

## Iteration H1 — Drag-drop product upload UI

**Outcome:** an authenticated operator can fill out a product form,
drop 1–10 reference images, and see the product appear in their library
within 30 seconds.

### H1.1 — Add upload + image-resize libraries

**Files:**
- `apps/dashboard/package.json` — add `react-dropzone@^14`,
  `browser-image-compression@^2`
- `apps/dashboard/src/lib/uploader.ts` — typed wrappers

**Resources:**
- [`react-dropzone` docs](https://react-dropzone.js.org/)
- [`browser-image-compression`](https://github.com/Donaldcwl/browser-image-compression)
  — MIT, ~13kB, downscales client-side before upload
- React 19 / Next 15 install: `pnpm add react-dropzone --legacy-peer-deps`

**Subtasks:**
1. Install both libraries; `--legacy-peer-deps` flag confirmed in lockfile.
2. `lib/uploader.ts`:
   - `compressImage(file, { maxSize: 2_000_000, maxWidthOrHeight: 2000 })`
     wrapper around `imageCompression`.
   - `uploadToR2(presignedUrl, file, onProgress)` → PUT with progress.
3. Types for upload state machine: `idle | compressing | uploading |
   verifying | done | error`.

### H1.2 — `/products/new` page + form

**Files / new files:**
- `apps/dashboard/src/app/products/new/page.tsx` — server component
  shell.
- `apps/dashboard/src/components/product-upload-form.tsx` — client
  component with the form + dropzone.
- `apps/dashboard/src/components/ui/dropzone.tsx` — themed wrapper
  around `react-dropzone` matching the M3 + FF accent system.
- `apps/dashboard/src/components/layout/shell.tsx` — add
  "Add product" CTA next to "Launch SKU" in the sidebar header (or
  promote to a primary FAB-style button on `/products`).

**Form fields:**
| Field | Type | Validation |
|---|---|---|
| Product name (EN) | text | 2–200 chars |
| Product name (ZH) | text | optional, ≤200 chars |
| Category | select | one of the 6 enum values |
| Object kind | select | rod / reel / handbag / watch / shoe / apparel / drinkware / other (auto-suggested from category) |
| Dimensions | freeform jsonb editor | optional |
| Materials | multi-tag input | optional |
| Colors | hex picker, multi | optional |
| Reference images | dropzone | 1–10 files, each ≤20MB raw, JPG / PNG / WEBP |

**Subtasks:**
1. Lay out as a 12-col grid: form on left (col-span-7), dropzone on
   right (col-span-5).
2. Dropzone shows thumbnail preview of each accepted file with a remove
   button; rejected files (wrong type, too large) get an inline error
   chip.
3. Object-kind auto-suggest: when category changes, default the kind
   field; user can override.
4. Submit button disabled until: name ≥ 2 chars, category set, ≥1 image.
5. Submit flow:
   - Compress all images client-side (parallel, max 4 at a time).
   - POST `/v1/products/upload-intent` → get presigned URLs.
   - PUT each compressed file to its presigned URL with progress bars.
   - POST `/v1/products` with metadata + uploaded keys.
   - On success: show "Product created · take me to launch" CTA →
     `/launch?product_id=...`.

### H1.3 — Worker: upload-intent + product-create endpoints

**Files:**
- `apps/mcp-server/src/index.ts` — two new routes
- `apps/mcp-server/src/lib/r2-presign.ts` — helper to mint presigned
  PUT URLs against the R2 bucket

**Resources:**
- [Cloudflare R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- AWS SDK SigV4 against R2's S3-compatible endpoint
  (`<account>.r2.cloudflarestorage.com`)
- New Worker secret: `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (created
  in CF dashboard with read/write scope to `ff-brand-studio-assets`)

**Endpoints:**

```
POST /v1/products/upload-intent
  body: { extensions: ('jpg'|'png'|'webp')[] }   // 1–10
  ⇒ 200: { intent_id, urls: [{ key, putUrl, expires_at }] }
```

- Auth required. Tenant from middleware.
- Generate `intent_id = nanoid(16)`.
- For each requested ext, build the R2 key:
  `tenant/<tenant_id>/uploads/<intent_id>/<i>.<ext>`.
- Sign a PUT URL valid for 10 minutes per key.
- Stash `{intent_id, tenant_id, expected_keys[]}` in `SESSION_KV` with
  10-minute TTL.

```
POST /v1/products
  body: {
    intent_id,
    sku: string,                    // user-supplied or auto-generated
    name_en, name_zh?, category, kind,
    dimensions?, materials[]?, colors_hex[]?,
    uploaded_keys: string[]         // subset of expected_keys
  }
  ⇒ 200: { product_id, sku, variant_id }
```

- Auth required.
- Look up intent in `SESSION_KV`; reject if missing / mismatched tenant.
- For each `uploaded_key`: HEAD against R2; reject if missing.
- Transaction:
  - `chargeWallet(tenant, 50, 'product_onboard', ...)`
  - INSERT `seller_profiles` if first product (auto-create from Clerk
    org name)
  - INSERT `products`
  - INSERT default `product_variants`
  - INSERT N rows in `product_references`, one per uploaded_key
  - `auditEvent(tenant, actor, 'product.create', ...)`
- Return `product_id` + `variant_id`.

### H1.4 — Update existing /launch wizard to consume `/v1/products`

**Files:** `apps/dashboard/src/components/launch-wizard.tsx`

**Subtasks:**
1. Replace the hardcoded preset list with `apiFetch('/v1/products')`.
2. Add a "+ New product" button in the picker that opens
   `/products/new` in a new tab (or dialog).
3. When the wizard mounts with `?product_id=...` query param, pre-select
   that product (the create-product flow uses this).

### H1.5 — Reference images surface in the launch wizard

**Subtasks:**
1. After picking a product, the right column shows a thumbnail strip of
   the reference images (small carousel).
2. Operator confirms references look right, then proceeds to launch.

### H1.6 — Acceptance for H1

- New tenant signs up → onboarding wizard sends them to `/products/new`
  → form takes ≤2 min to fill in → drop 5 phone-camera shots (~5MB raw
  each) → all 5 compressed to ≤2MB JPG client-side → uploaded directly
  to R2 → product appears at top of `/launch` SKU picker.
- Wallet balance debited by exactly 50¢; ledger row visible.
- Refresh page; product persists.
- Tenant B's `/v1/products` does NOT include Tenant A's product.

---

## Iteration H2 — Onboarding wizard

**Outcome:** a new tenant lands on `/` after Clerk signup and is walked
through 4 steps to their first launch in ≤3 minutes.

### H2.1 — Onboarding state machine

**Files:**
- `apps/dashboard/src/lib/onboarding.ts` — derive current step from
  tenant + product + launch counts via `apiFetch('/v1/me/state')`.
- `apps/mcp-server/src/index.ts` — new endpoint `GET /v1/me/state`
  returning `{ tenant, hasFirstProduct, hasFirstLaunch, walletCents }`.

**Steps:**
1. **Welcome / agency profile** — confirm agency name (defaults from
   Clerk org), set locale (en / zh / both), brand voice tone (optional
   single field).
2. **First product** — straight to `/products/new` with a banner
   "Step 2 of 4 · onboarding".
3. **Pick marketplaces** — select Amazon US + Shopify checkboxes.
4. **Run first launch** — pre-filled launch wizard, banner "Step 4 of
   4 · we'll use $4.10 of your $5.00 starter credit". Click → fire.

### H2.2 — UI affordances

**Files:**
- `apps/dashboard/src/components/onboarding-stepper.tsx` — compact
  4-dot stepper rendered above PageHeader on /, /products/new, /launch
  while onboarding is incomplete.
- `apps/dashboard/src/app/page.tsx` — show "Continue setup" hero card
  with the next step CTA when `hasFirstLaunch === false`.

**Subtasks:**
1. Stepper shows current step, completed steps as ✓, pending as ○.
2. Skip-button on every step: writes `tenant.features.skipped_onboarding
   = true` and dismisses the stepper everywhere.
3. After step 4 fires, success animation (M3 emphasized) → land on the
   launch result panel → "Welcome to FF Brand Studio · 总览" toast.

### H2.3 — Sample-tenant access for explore-before-onboard

**Files:** none new — relies on Phase G G2's `legacy-demo` Sample tenant.

**Subtasks:**
1. New tenants get `tenant.features.has_sample_access = true` by default.
2. Sidebar shows "Sample catalog" link (only when feature flag on) →
   `/library?tenant=sample` view (read-only, with watermark badge).
3. "Clone this SKU into my catalog" button on Sample SKU detail pages
   → creates a copy in the user's tenant (charges the $0.50 onboard).

### H2.4 — Acceptance for H2

- Brand-new sign-in flows to `/` → onboarding stepper visible at top.
- Clicking each step routes correctly.
- Skip button hides the stepper permanently.
- `tenant.features.skipped_onboarding` is reflected in DB.
- Sample catalog tab renders (G3 must be done so listings show).

---

## Iteration H3 — Stripe billing integration

**Outcome:** tenants can top up their wallet via Stripe Checkout in
under 30 seconds. Free credit at signup, paid credit on top-up. Webhook
reconciles every charge into `wallet_ledger`.

### H3.1 — Stripe account + customer sync

**Resources:**
- `stripe@^17` (server SDK) for the Worker
- `@stripe/stripe-js@^4` for the dashboard
- Embedded Checkout Components (Stripe Elements) keep checkout in-app

**Files:**
- `apps/mcp-server/wrangler.toml` — secrets:
  `STRIPE_SECRET_KEY` (live + test), `STRIPE_WEBHOOK_SECRET`,
  `STRIPE_PRICE_TOPUP_10`, `_25`, `_50`, `_100` (Stripe Price IDs for
  the four top-up tiers)
- `apps/dashboard/.env.local` — `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`

**Subtasks:**
1. Create Stripe account (test mode first); enable embedded Checkout.
2. Create 4 one-time products in Stripe: $10, $25, $50, $100 top-ups
   (currency USD). Save price IDs.
3. Update Phase G G1.3 webhook handler: on `organization.created`, also
   call `stripe.customers.create({ email, name, metadata: { tenant_id } })`
   and store `stripe_customer_id` on the tenant row.

### H3.2 — Top-up UI + Checkout session

**Files:**
- `apps/dashboard/src/app/billing/page.tsx` — main billing page
- `apps/dashboard/src/components/topup-modal.tsx` — quick-buttons +
  "custom amount" input
- `apps/mcp-server/src/index.ts` — `POST /v1/billing/checkout-session`

**Endpoint:**

```
POST /v1/billing/checkout-session
  body: { amount_cents: 1000 | 2500 | 5000 | 10000 | <custom> }
  ⇒ 200: { client_secret }   // for Stripe Embedded Checkout
```

- Auth required.
- Map `amount_cents` to the matching Stripe Price ID, or for custom
  amounts use `mode: 'payment'` with `line_items: [{
  price_data: { currency: 'usd', product_data: { name: 'FF wallet top-up' },
  unit_amount: amount_cents } }]`.
- Set `metadata: { tenant_id, top_up_cents }`.
- Return the embedded Checkout client secret.

**Dashboard UI:**
- Quick buttons: $10 / $25 / $50 / $100, plus a custom amount input
  (min $5, max $500).
- Click → fetch session → mount Stripe `<EmbeddedCheckout>` in a modal.
- On Stripe success → close modal, show success toast, refresh wallet
  balance.

### H3.3 — Webhook handler

**Files:**
- `apps/mcp-server/src/index.ts` — `POST /v1/stripe-webhook` (open route,
  signature-verified)

**Subtasks:**
1. Read raw body (Hono `c.req.text()`).
2. Verify signature: `stripe.webhooks.constructEventAsync(body,
   signature, env.STRIPE_WEBHOOK_SECRET)`.
3. On `checkout.session.completed`:
   - Look up tenant by `metadata.tenant_id`.
   - `creditWallet(tenant, metadata.top_up_cents, 'stripe_topup',
     'stripe_session', session.id)` — idempotent on session ID
     (insert-only-if-not-exists in `wallet_ledger`).
   - `auditEvent(tenant, system, 'wallet.credit', 'stripe_session',
     session.id, { amount_cents })`.
4. On `payment_intent.payment_failed`: log + `auditEvent` only (no
   wallet change).
5. On `customer.deleted`: mark tenant's `stripe_customer_id = NULL`.
6. Idempotency: every webhook event has `event.id`; store recent IDs
   in `SESSION_KV` (24h TTL) and reject duplicates.

### H3.4 — `/billing` page

**Layout:**
- Header: current wallet balance (large, vermilion), "Top up" CTA.
- Recent transactions table: paginated rows from `wallet_ledger` (date,
  reason, ±cents, balance after).
- Pricing reference card: links to ADR-0005 or a friendly version.
- Stripe-Customer-Portal embed for managing payment methods + receipts.

### H3.5 — Acceptance for H3

- New tenant has `stripe_customer_id` populated within 5s of signup.
- Click "Top up $25" → embedded Checkout → use Stripe test card →
  modal closes → balance increases by 2500c → ledger row visible.
- Webhook receives event → wallet incremented exactly once even if
  Stripe retries (idempotency).
- Failed webhook signature returns 400; no wallet change.

---

## Iteration H4 — Per-tenant cost gating in orchestrator

**Outcome:** every launch is wallet-aware. Operator sees predicted cost
before firing. Hard wall prevents negative balances. Refund path on
cost-cap.

### H4.1 — Cost prediction helper

**Files:** `apps/mcp-server/src/orchestrator/cost.ts`

**Subtasks:**
1. `predictLaunchCost(plan, includeSeo, surfaces)`:
   - white_bg: 1 image × $0.50
   - lifestyles: N × $0.50
   - variants: N × $0.50
   - video (if produced): $1.00
   - SEO: surfaces × $0.10
   - Returns `cents` (integer).
2. `chargeForLaunch(tenant, predicted, run_id)`:
   - Calls `chargeWallet(tenant, predicted, 'launch_run', 'launch_run', run_id)`.
   - Throws `InsufficientFundsError` if balance < predicted.

### H4.2 — Launch wizard pre-flight modal

**Files:** `apps/dashboard/src/components/launch-wizard.tsx`

**Subtasks:**
1. New `GET /v1/launches/preview` endpoint accepts the same body as
   `POST /demo/launch-sku` and returns the predicted cost without
   firing anything.
2. Submit button changes from "Launch →" to "Review & launch →".
3. Modal: shows
   - Predicted cost: `$X.YZ` (largest text)
   - Breakdown: N images × $0.50, M listings × $0.10
   - Wallet balance: `$A.BC`
   - Balance after: `$A.BC - $X.YZ = $D.EF`
   - If `D.EF < 0`: red error + "Top up" inline button instead of
     "Confirm".
   - Confirm → fires `POST /v1/launches`.

### H4.3 — Refund-on-cap path

**Files:** `apps/mcp-server/src/orchestrator/launch_pipeline.ts`

**Subtasks:**
1. When `costCapped = true` mid-pipeline, the wallet was already debited
   for the predicted total. Compute `refund = predicted - actual` and
   `creditWallet(tenant, refund, 'launch_refund', 'launch_run', run_id)`.
2. Same logic when actual < predicted on a normal success (under-runs).
3. When `actual > predicted` (rare, but possible if iterations exceed
   prediction), the run was already capped — no extra charge.

### H4.4 — `/v1/launches` versioned endpoint

**Files:** `apps/mcp-server/src/index.ts`

**Subtasks:**
1. Rename `POST /demo/launch-sku` to `POST /v1/launches`. Keep the old
   path as a temporary alias for one phase to avoid breaking tests.
2. Add `GET /v1/launches/:run_id` that returns the launch_runs row + a
   side-load of `platform_assets` + `platform_listings` produced.
3. Both endpoints are auth-required + tenant-scoped (G2 covers this).

### H4.5 — Wallet badge in the sidebar

**Files:** `apps/dashboard/src/components/layout/shell.tsx`

**Subtasks:**
1. Sidebar footer: small wallet pill (`$A.BC`), tooltip on hover shows
   "X launches remaining at avg cost".
2. Pill goes amber when balance < $1.00, red when balance < $0.50.
3. Click → `/billing`.

### H4.6 — Acceptance for H4

- Pre-flight modal shows correct predicted cost (matches actual ±5¢
  for typical 7-image launches).
- Tenant with $0.40 balance trying $4.10 launch sees "Top up first"
  state; cannot click Confirm.
- Tenant with $5.00 balance, full launch under-runs by 50¢: ledger
  shows `+50` refund row after completion.
- Wallet badge in sidebar live-updates after each launch.

---

## Cross-cutting Phase H concerns

### Stripe test vs live

- All Phase H development uses Stripe **test mode** secrets.
- Switching to live: rotate the secrets (Worker `wrangler secret put`),
  swap the Price IDs in env, manually verify $1 top-up via real card.
- Test → live cutover gated on a `tenant.features.live_billing` flag
  for the first 1-2 tenants, then default-on.

### Free-tier abuse mitigation

- Single Clerk user cannot create N orgs to farm $5×N. Mitigations:
  - Clerk's "Allow only one organization per user" setting (off by
    default; we leave OFF for the multi-org story).
  - On organization create webhook: if the same Clerk user_id has
    created another org in the past 30 days, grant only $1 (silent).
  - Audit log captures the chain so we can correlate later.
- Email-domain de-dupe: deferred to Phase M (anti-fraud).

### File-size limits

- Per upload: ≤20MB raw (compressed to ≤2MB before R2). Worker rejects
  uploaded keys whose HEAD content-length exceeds 5MB.
- Per product: ≤10 references.
- Per tenant: ≤500 products in MVP. Soft-cap (warn) at 400, hard-cap
  enforces at 500. Configurable via `tenant.features.max_products`.

### Costs (recurring) introduced by Phase H

| Item | Cost | Scale |
|---|---|---|
| Stripe transaction fee | 2.9% + $0.30 per top-up | Variable |
| R2 storage for references | $0.015/GB-month | ≤$1/mo at 100 tenants × 500MB each |
| R2 PUT operations | $4.50/M | Negligible |
| Clerk MAU on Free | $0 | Until 10K MAU |

Total fixed overhead Phase H adds: **~$5/mo** for 10 active tenants.

### Estimated effort

| Iteration | Engineer-days |
|---|---|
| H1 (upload UI + endpoints) | 4 |
| H2 (onboarding wizard) | 2 |
| H3 (Stripe integration) | 3 |
| H4 (cost gating + refund) | 2 |
| Stripe live cutover + smoke | 1 |
| Buffer | 1 |
| **Total** | **~13 days** (~3 weeks at half-time) |

Phase H + Phase G together = the MVP-of-SaaS milestone (~6 weeks).

---

## Resolved questions (locked 2026-04-27)

1. **Stripe Tax.** **Enable Stripe Tax** for US tenants in the embedded
   Checkout ($0/mo base + 0.5% on collected tax). Non-US tenants
   ignored in MVP — deferred to Phase M's multi-region work.
2. **Refund mechanics.** **Debit the wallet** by the refunded amount
   so the ledger remains source of truth. If wallet would go negative
   after refund, mark `tenant.plan = 'frozen'` until balance recovered.
3. **Bulk top-up via invoice.** **Deferred to Phase M.** All top-ups
   go through Checkout in MVP regardless of size.
4. **Currency display.** **Wallet always in cents-USD** with a `$`
   prefix. Stripe handles local-currency display at charge time, we
   credit USD.
5. **EU VAT / UK VAT.** **Out of scope for MVP** — `tenant.country`
   hard-coded to `'US'` until Phase M.
6. **Per-product onboarding charge timing.** **Charge on create.** The
   $0.50 product-onboard fee debits the wallet at the moment of
   `POST /v1/products`. Refundable if the tenant deletes the product
   within 24h (a one-line audit-driven cron in Phase M, manual until
   then).

---

## Deliverables checklist

When Phase H is done:

- [ ] `react-dropzone` + `browser-image-compression` integrated
- [ ] `/products/new` form with multi-image dropzone
- [ ] `POST /v1/products/upload-intent` + `POST /v1/products` live
- [ ] Direct-to-R2 upload via presigned URLs (uploads ≥10MB don't hit
      Worker)
- [ ] Onboarding stepper visible for new tenants; skip-button works
- [ ] Sample catalog accessible to new tenants (read-only)
- [ ] Stripe customer created on tenant create
- [ ] `/billing` page with top-up flow live
- [ ] Embedded Stripe Checkout works end-to-end with test card
- [ ] Stripe webhook handler verifies signatures, idempotent on event ID
- [ ] Wallet balance updates within 5s of test charge
- [ ] Pre-flight modal shows predicted cost on launch
- [ ] Insufficient balance blocks launch with clear "top up" CTA
- [ ] Wallet badge in sidebar live-updates
- [ ] Refund-on-cost-cap writes a `wallet_ledger` credit row
- [ ] ADR-0005 (pricing schema + margin policy) committed
- [ ] `SESSION_STATE.md` updated with the new self-serve flow + billing

When all are checked, the platform is open for paying customers.
Phase I (production-quality image pipeline) becomes the next priority
to make the product worth the $0.50/image charge.
