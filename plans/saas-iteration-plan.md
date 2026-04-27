# FF Brand Studio — SaaS Iteration Plan (Phases G–M)

> **Status:** outlines only. Each section below is a self-contained
> development iteration that will be expanded into a detailed plan + tasks
> at the time it is picked up. Do not start implementation from this
> document; treat it as the table-of-contents for future plans.

---

## Decisions locked (from 2026-04-27 review)

1. **Image pipeline:** investigate best quality + cost-effective approach
   first; the buyfishingrod Python pipeline (`cleanup → derive → dual-ref
   Nano Banana Pro → CLIP+Vision audit → ≤3 iter`) is the production
   reference and lands at ~$1/SKU for a 7-view set.
2. **Object-kind dispatch:** generalize beyond fishing rods so agencies
   can launch handbags, watches, shoes, apparel, drinkware, etc.
3. **Multi-tenancy required.** Each agency = a tenant with isolated
   products, costs, listings.
4. **Self-billing via Stripe.** $5 free credit per new tenant. Pricing
   model presented to marketing professionals as "$X / product, $Y /
   image". Margin built into the per-image price (FAL/Anthropic cost ≤
   60% of charge).
5. **Image slots:** Amazon's standard slot set. Skip slots we cannot
   meaningfully produce (packaging, real-world scale photo). For "detail"
   slot, generate a **text-overlay composite** (key spec text on top of a
   product hero shot).
6. **Publish output:** generate **ZIP + CSV** ready for manual upload to
   Seller Central / Shopify Admin (no direct SP-API push for now).
7. **Inline edit for SEO + images.** Each surface (image or copy field)
   has an edit button + a feedback chatbox with preset buttons:
     - "Image not high quality enough"
     - "Image has hallucination, doesn't look like original product"
     - "Wrong angle / wrong shot type"
     - "Copy doesn't match my brand voice"
     - "Bullet too long / too short"
     - free-form text input
8. **Bulk = single-SKU per launch for now.** But the **public API is
   built now** with batch-friendly contracts so future scale is just an
   orchestration upgrade.
9. **Production runway.** Build for real paying customers, not the FF
   interview demo only. Auth, tenant isolation, billing, audit logs,
   rate limits all required.
10. **Reuse the `lykan_upload` Python pipeline** ONLY if it can scale to
    multi-tenant + non-fishing categories. If it can't, port the shape to
    TypeScript Workers or run it as a containerized FAL-compatible service.

---

## Architecture deltas (current → target)

| Concern | Current | Target |
|---|---|---|
| Auth | None | Tenant-scoped login (Clerk or Cloudflare Access) |
| Data isolation | All sellers share one DB; no `tenant_id` on rows | Every row carries `tenant_id`; every query filters |
| Product creation | Seed scripts only | Self-serve upload UI + REST API |
| Image pipeline | Stubbed Phase 2 generators | Full `cleanup → derive → dual-ref → audit → iter` flow ported to Workers (or external service) |
| Object kinds | 6 enum categories | Kind-aware dispatch table (rod / reel / compact-square / compact-round / horizontal-thin / multi-component) |
| SEO copy storage | Ephemeral (response only) | New `platform_listings` table |
| Library | Static thumbs | Lightbox + hover-zoom + download + bulk export |
| Edit flow | Read-only | Per-field inline edit + feedback chat |
| Publish | Theater button | Generates ZIP + CSV, marks `status='published'` |
| Billing | None | Wallet table + Stripe metered + $5 sign-up credit |
| API | Internal-only `/api/*` | Public versioned `/v1/*` with per-tenant API keys |
| Cost cap | Global per-run | Per-tenant wallet (hard halt when balance < threshold) |
| Audit log | None | Append-only `audit_events` table per tenant |

---

## Phase G — Foundation: Auth, Tenancy, Persistence

**Goal:** every row in the platform belongs to a tenant; every dashboard
request is authenticated; every API call is tenant-scoped. SEO copy is
persisted so it can be retrieved + edited later.

### G1 — Tenant + auth provider integration
**Resources:** Clerk (preferred — has free tier, B2B "Organizations"
primitive, drop-in `<SignIn />` for Next.js 15) OR Cloudflare Access
(zero-config but no native multi-org).
**Outline:**
- Create `tenants` table (`id`, `name`, `stripe_customer_id`, `created_at`,
  `wallet_balance_cents`, `plan`, `api_key_hash`).
- Wire Clerk into the dashboard root layout; gate everything except
  `/login` and `/signup` behind `<SignedIn>`.
- Worker middleware: validate Clerk JWT on every `/api/*` request, attach
  `c.var.tenant_id`. Return 401 on missing/invalid.
- New `/signup` flow: create tenant row + grant 500¢ ($5) credit + fire
  Stripe customer create (deferred to H4).
**Acceptance:** unauth'd browser hitting `/library` is redirected to
sign-in; tenant `A` cannot read tenant `B`'s products via the API.

### G2 — Tenant column on every domain table
**Resources:** Drizzle migrations.
**Outline:**
- Add `tenant_id UUID NOT NULL REFERENCES tenants(id)` to:
  `seller_profiles`, `products`, `product_variants`, `product_references`,
  `platform_assets`, `launch_runs`, `assets` (legacy).
- Backfill existing rows under a `legacy-demo` tenant so we don't lose
  the seeded demo data.
- Add the FK to every Worker query (`db.select().from(products).where(eq(products.tenantId, c.var.tenant_id))`).
- Document the row-level filter pattern as a project rule.
**Acceptance:** SQL audit script reports zero rows with NULL tenant_id;
zero queries in `apps/mcp-server/src/` that don't filter by tenant.

### G3 — `platform_listings` table for SEO copy persistence
**Resources:** none external.
**Outline:**
- New table `platform_listings` (`id`, `tenant_id`, `variant_id`,
  `surface` enum, `language` enum, `copy` jsonb, `flags` jsonb,
  `violations` jsonb, `rating` enum, `iterations` int, `cost_cents` int,
  `status` enum [draft|approved|published], `created_at`, `updated_at`).
- Update `runSeoPipeline` to INSERT a row per surface instead of just
  returning in memory.
- New endpoint `GET /v1/listings?variant_id=...` returns the persisted
  rows.
- Library + SKU detail page surface these rows alongside platform_assets.
**Acceptance:** every successful launch persists N copy rows where N =
surfaces × languages; refreshing the dashboard shows the same copy that
was generated yesterday.

### G4 — Wallet + audit log scaffolding
**Resources:** none external.
**Outline:**
- `wallet_ledger` table — append-only credits/debits per tenant.
- `audit_events` table — `tenant_id`, `actor`, `action`, `target`,
  `metadata`, `at`. Insert on every meaningful action (launch start,
  publish, copy edit, image regen).
- Helper `chargeWallet(tenant_id, cents, reason)` runs in a transaction
  to deduct from current balance and append a ledger row; throws if
  balance would go negative.
**Acceptance:** every launch_run is preceded by a wallet check + ledger
entry; balance never goes negative.

---

## Phase H — Self-Serve Upload + Stripe Billing

**Goal:** new agencies can sign up, upload their first product, and pay
for usage. Replaces the seed-script-only product creation flow.

### H1 — Drag-drop upload UI
**Resources:** `react-dropzone` (npm, install with `--legacy-peer-deps`
for Next 15 + React 19), client-side resize via `browser-image-compression`
(MIT, 13kB, downscales to 2000²max before upload).
**Outline:**
- New page `/products/new`: form with name (en/zh), category, dimensions
  (jsonb), materials, colors, plus a `<Dropzone>` accepting up to 10
  reference images.
- Client-side: resize each upload to ≤2000² JPEG ≤2MB before upload.
- Worker endpoint `POST /v1/products` accepts multipart, writes to
  Postgres + uploads images to R2 at `tenant/<tenant_id>/products/<sku>/refs/<n>.jpg`.
- New table column `product_references.r2_key` stays the source of truth
  for "before" images.
**Acceptance:** an agency can sign up, click "Add product", drop 5
phone-camera supplier shots, see them appear at `/library` under their
SKU within 30s.

### H2 — Onboarding wizard
**Resources:** none external.
**Outline:**
- First-time-user state on `/`: 4-step wizard
  (1) Tell us about your agency (name + locale)
  (2) Upload your first product
  (3) Pick target marketplaces
  (4) Run your first launch (use the $5 credit)
- Skip-button on every step; resumable via `?step=N` query.
**Acceptance:** new tenant lands on `/`, completes 4 steps in ≤3 min,
has 1 product + 1 launch in their library.

### H3 — Stripe billing integration
**Resources:** Stripe Node SDK (`stripe@latest`), Stripe Webhooks
(verify with `stripe.webhooks.constructEvent`), `@stripe/stripe-js` for
Checkout Embedded Components.
**Outline:**
- Pricing schema (initial — tweakable from admin):
  - **$0.99 / product onboard** (one-time per SKU created)
  - **$0.50 / generated image** (covers 7-view spec, capped at $3.50 for
    the full set)
  - **$0.10 / SEO listing** (per surface × language)
  - **$5 free credit** at signup, no expiration
- Stripe Customer Portal embedded at `/billing`.
- Top-up: `$10 / $25 / $50 / $100` quick buttons, one-click via Stripe
  Checkout.
- Webhook `/v1/stripe-webhook` credits the wallet on
  `checkout.session.completed`, sends invoice receipt.
**Acceptance:** wallet balance updates within 5s of a successful test
charge; refusing to top up + low balance blocks the next launch.

### H4 — Per-tenant cost gating in orchestrator
**Resources:** none external.
**Outline:**
- `runLaunchPipeline` reads `tenant.wallet_balance_cents` upfront and
  computes `min(remaining_balance, run-level cap)` as the effective hard
  cap.
- After each step, debit the wallet; if next step would exceed balance,
  halt and mark `status='wallet_capped'`.
- Pre-flight modal in the launch wizard: "This launch will cost ~Xc.
  Your balance is Yc. Continue / Top up first?"
**Acceptance:** tenant with $0 balance cannot fire a launch; tenant with
$0.50 cannot fire a $1.00 launch.

---

## Phase I — Production-Quality Image Pipeline

**Goal:** every launch produces a 7-view (or platform-spec'd subset)
catalog that meets Amazon main-image rules and looks B2C-grade.

### I1 — Pipeline approach decision (research spike)
**Resources:** existing Python pipeline at `C:\Users\zihao\lykan_upload\`,
FAL AI Workers (TypeScript SDK), Cloud Run / Modal Labs (containerized
Python), gpt-image-2, Nano Banana Pro
(`fal-ai/gemini-3-pro-image-preview/edit`), CLIP via `@xenova/transformers`
or hosted (Replicate).
**Outline:**
- **Compare three approaches:**
  - (a) Pure TS port — rewrite `derive_v2.py` + dual-ref calls in TS,
    runs in Worker. Pros: low ops; Cons: Pillow not in JS, OpenCV.js is
    heavy, CLIP via `@xenova/transformers` is 80MB.
  - (b) External Python service — deploy lykan_upload as a containerized
    service on Modal or Cloud Run, Worker calls via HTTP. Pros: 1:1 with
    production code. Cons: cold-start, dual deploy.
  - (c) Hybrid — TS for orchestration + cheap CLIP triage, Python service
    for the heavy generative steps. Best of both.
- Build a tiny side-by-side benchmark on 3 SKUs (rod, drinkware, handbag),
  measure cost/quality/latency.
- Pick one. Document the choice as ADR-0003.
**Acceptance:** ADR committed with concrete cost-per-SKU + latency
numbers. Prototype runs end-to-end on the three test SKUs.

### I2 — Object-kind dispatch generalized
**Resources:** existing `derive_v2.py` `DERIVERS` dict as reference.
**Outline:**
- New `kinds` enum + table:
  `long_thin_vertical` (rods, paddles)
  `long_thin_horizontal` (knives, fishing nets)
  `compact_square` (handbags, watches, candles, electronics)
  `compact_round` (plates, hats, balls)
  `horizontal_thin` (shoes, sunglasses, ties)
  `multi_component` (combos, kits, tackle boxes)
  `apparel_flat` (t-shirts laid flat, hoodies)
- Each kind defines: padding %, crop strategy (3 default crops per kind),
  prompt fragments specific to its key features.
- Product-creation form auto-detects kind from category but allows manual
  override.
- Pipeline reads the kind, picks the matching DERIVER + prompt template.
**Acceptance:** 7 sample SKUs across 7 kinds run through the pipeline
without slicing the product mid-body or applying rod-style geometry to a
handbag.

### I3 — CLIP triage + Claude-Vision adjudication
**Resources:** CLIP via Replicate hosted endpoint (~$0.0006/call) or
Cloudflare Workers AI `@cf/openai/clip-vit-base-patch16` (free tier).
**Outline:**
- After each generated image, run CLIP similarity vs the supplier
  reference image. Threshold 0.78 (per the production heuristic).
- Above 0.78 → ship. Below → escalate to Opus 4.7 vision adjudicator
  with "is this the same product? if no, what's wrong?" prompt.
- Vision verdict drives the regeneration prompt for next iteration.
- Cap at 3 iterations per slot per launch (cost ceiling).
**Acceptance:** 90% of generations clear CLIP triage at iter 1; vision
adjudication only burns when CLIP says POOR.

### I4 — Text-overlay "detail" composite slot
**Resources:** Sharp (already in package.json) for canvas compositing
on the Worker side, or Pillow if going Python-service route.
**Outline:**
- New slot generator: takes the cleaned product image + 3 spec strings
  (e.g. `"12 ft length"`, `"4-piece collapsible"`, `"285 g weight"`).
- Composites a 1:1 frame: product photo as background, spec strings in
  Fraunces serif at the top + bottom thirds, FF brand watermark in the
  bottom-right corner.
- Returns the composite as the `detail` platform slot.
**Acceptance:** `shopify · detail` and `amazon · a_plus_feature_*`
generate composites that read at thumbnail size + zoom cleanly.

### I5 — Slot generation matrix per platform
**Resources:** Amazon listing image guide (≤9 images, 1:1, 2000²),
Shopify product gallery (any aspect, 4:5 recommended for mobile).
**Outline:**
- Per-platform slot definition (drops the slots we can't meaningfully
  produce — packaging, real-world scale photo):
  - **Amazon:** main (white-bg studio) + lifestyle + 4 detail composites
    + 1 close-up = 7 images
  - **Shopify:** main + lifestyle + close + detail-composite + far = 5
    images
- Update `planSkuLaunch` to emit this matrix; update adapters to map the
  generated canonicals into the right slot via `platform_assets` rows.
- No more single-canonical-reused-everywhere.
**Acceptance:** a single launch produces 7 visually distinct Amazon
images + 5 Shopify images; no two slots return the same R2 URL.

---

## Phase J — Library SaaS Features

**Goal:** the library page works like a real DAM — agencies can preview,
zoom, download, search, and audit any asset in 2 clicks.

### J1 — Lightbox + hover-zoom magnifier
**Resources:** `yet-another-react-lightbox` + `yet-another-react-lightbox/plugins/zoom`
(MIT, ~12kB total), custom hover-magnifier per the production-workflow
note (CSS `backgroundImage` + `backgroundSize:'250%'` + cursor-tracked
`backgroundPosition`).
**Outline:**
- Asset tile gets a hover state: 250%-zoomed-on-cursor preview overlay.
- Click → opens YARL lightbox with full SKU's slot collection as
  navigable carousel; Zoom plugin renders at native R2 resolution
  (2000²).
- Keyboard: arrow keys to navigate slots, `+`/`-` for zoom, Esc to close.
**Acceptance:** clicking any tile opens a full-screen view at the
asset's native resolution; hovering shows a 250% magnifier without the
lightbox.

### J2 — Per-asset + bulk download
**Resources:** `jszip@^3` + `file-saver@^2` (both client-side, ~30kB
combined). Worker-side zipping via `gildas-lormeau/zip.js` is an option
for very-large bundles but not needed for typical 5-15-image SKU.
**Outline:**
- Per-asset download button on each tile (direct R2 URL with
  `Content-Disposition: attachment`).
- Per-SKU "Download all" button on each `SkuGroup` card → fetches every
  asset URL via JSZip, generates `<sku>-<timestamp>.zip` with images +
  the platform_listings copy.json + an Amazon-spec.csv.
- Library-wide "Bulk export" button with multi-select checkboxes →
  produces the same per-SKU bundles inside one zip-of-zips.
**Acceptance:** a 5-image SKU downloads as a clean ZIP < 5s; ZIP
contains images + JSON + CSV.

### J3 — Search + filter
**Resources:** `cmdk` (palette, MIT, 5kB) for keyboard-first power users,
or just Tailwind+native input for the dashboard pattern.
**Outline:**
- Filters: SKU search (substring), platform (Amazon / Shopify),
  slot (main / lifestyle / detail / etc.), compliance (EXCELLENT / GOOD
  / FAIR / POOR), date range.
- Cmd-K palette: jump to any SKU detail page by typing 3 chars.
- URL-encoded filter state so bookmarking works.
**Acceptance:** searching `rod` filters to 1 SKU in <100ms; filter combo
URLs are shareable.

### J4 — Per-SKU detail page
**Resources:** none external.
**Outline:**
- New route `/sku/[id]` (static export-friendly via fallback OR a
  `/sku?id=` query-string variant).
- Layout: hero (product name, sku, category, kind, references) + tabs
  for Images (per-platform grid), Listings (per-surface copy), History
  (launch_runs timeline + costs), Costs (per-launch + lifetime).
- Edit + regen buttons (J→K).
**Acceptance:** clicking a SKU anywhere lands on its detail page with
all assets, copy, history visible in 1 view.

---

## Phase K — Edit + Publish Flow

**Goal:** generated content is iterable. Agencies can edit a title,
swap an image, retry with feedback, then export the approved bundle.

### K1 — Inline copy edit per field
**Resources:** `@tanstack/react-form` (typed, schema-validated forms,
already-popular alt to react-hook-form), per-platform validators from
`packages/brand-rules`.
**Outline:**
- Each surface card (Amazon title, bullets, description, search_terms;
  Shopify h1, meta, description_md) gets an inline editor with a
  per-field rule check (`title.length ≤ 200`, `no word repeated > 2×`,
  etc.).
- "Save edits" persists to `platform_listings.copy` (jsonb, append a new
  version row in `platform_listings_versions` for audit).
- Validation errors render inline, save disabled until clean.
**Acceptance:** editing the Amazon title to 250 chars shows red error;
saving valid edits persists across page reloads.

### K2 — Feedback-driven image regen + chatbox
**Resources:** existing `runSeoPipeline` evaluator-optimizer pattern is
the precedent; replicate for images.
**Outline:**
- Each image tile + each copy field has a "Regenerate with feedback"
  button.
- Feedback panel: 5 preset chip buttons + free-form text:
  - "Image not high quality enough"
  - "Image has hallucination, doesn't look like original"
  - "Wrong angle / wrong shot type"
  - "Doesn't match my brand voice" (copy-only)
  - "Too long / wordy" (copy-only)
- On submit, fires a regen call: prepends the feedback to the original
  prompt, runs ≤3 iterations, replaces the asset in-place.
- Wallet check pre-flight.
**Acceptance:** clicking "image has hallucination" + "regenerate"
returns a new image within 30s, updates the tile, debits wallet.

### K3 — Approval workflow
**Resources:** none external.
**Outline:**
- States per asset / per listing: `draft → ready → approved → published`.
- Per-SKU approval gate: all surfaces must be `approved` before publish.
- Approve button on each tile / field (agency operator role).
- Audit log writes on every state transition.
**Acceptance:** clicking "Publish to DAM" on an SKU with any unapproved
asset is blocked with a clear inline message.

### K4 — ZIP + CSV export ready for Seller Central / Shopify
**Resources:** `csv-stringify` (MIT, tiny), Amazon Inventory File template
fields, Shopify product CSV format.
**Outline:**
- "Publish to DAM" generates the bundle:
  - `images/amazon/main.jpg`, `lifestyle.jpg`, etc.
  - `images/shopify/...`
  - `amazon-listing.csv` (matching Amazon Inventory File minimum fields)
  - `shopify-products.csv` (matching Shopify import format)
  - `manifest.json` (FF metadata: cost, iterations, audit hash)
- ZIP download + a "View in Library" link.
- Marks the SKU `status='published'` + writes audit row.
**Acceptance:** the resulting ZIP imports cleanly into Amazon Inventory
Loader sandbox + Shopify staging without manual fixup.

---

## Phase L — Public API

**Goal:** programmatic access for agencies that want to script their
catalog launches. Forward-compatible with future batch endpoints.

### L1 — API key issuance + auth
**Resources:** `nanoid` for key generation, bcrypt for hashing.
**Outline:**
- `/settings/api-keys` page lists / creates / revokes keys per tenant.
- Keys: `ff_live_<32 chars>` format, prefix is index, hash stored in DB.
- Worker middleware: accepts `Authorization: Bearer ff_live_...` OR
  Clerk session JWT. Either resolves to a tenant_id.
**Acceptance:** curl with a valid `ff_live_*` token can hit
`/v1/products` and gets only that tenant's data.

### L2 — Versioned REST API
**Resources:** OpenAPI 3.1 spec, Hono route definitions.
**Outline:**
- Endpoints (all tenant-scoped):
  - `POST /v1/products` — create with refs (multipart)
  - `GET /v1/products` — list with pagination
  - `GET /v1/products/:id` — full detail
  - `PATCH /v1/products/:id` — update metadata
  - `POST /v1/launches` — start a launch (single or batch)
  - `GET /v1/launches/:id` — status + result
  - `GET /v1/listings?variant_id=...` — fetch persisted SEO copy
  - `GET /v1/assets?sku=...` — fetch generated images
- Error shape per RFC 7807 (problem+json).
**Acceptance:** Postman collection runs all endpoints clean against the
prod Worker.

### L3 — Webhooks for launch completion
**Resources:** none external (HMAC sig with shared secret).
**Outline:**
- `webhook_endpoints` table per tenant.
- On launch terminal state: POST `{ launch_id, status, total_cost_cents, sku }`
  to every endpoint, signed with `X-FF-Signature: sha256=...`.
- Retry with exponential backoff on non-2xx (3 retries, capped 30 min).
**Acceptance:** a tenant's webhook receives a launch completion event
within 1s of the orchestrator finishing.

### L4 — API docs + playground
**Resources:** `swagger-ui-react` or `redoc-react`, OpenAPI spec from L2.
**Outline:**
- `/docs` route serves the spec rendered via Redoc (lighter, prettier).
- "Try it" panel uses the user's tenant key inline.
**Acceptance:** developer reading `/docs` can fire a real API call
without leaving the page.

---

## Phase M — Scale Hardening

**Goal:** production-ready. Handles 10× current load. Recovers cleanly
from any single dependency failure.

### M1 — Per-tenant rate limiting
**Resources:** `@upstash/ratelimit` + Cloudflare KV / Durable Objects
backend.
**Outline:**
- Default: 60 req/min per API key, 10 launches/min per tenant.
- 429 with `Retry-After` header when exceeded.
- Higher tiers configurable by tenant plan.
**Acceptance:** spamming `/v1/launches` from one key throttles at the
11th call.

### M2 — Audit log dashboard
**Resources:** `audit_events` table from G4.
**Outline:**
- `/audit` route lists every event for the tenant: paginated, filterable
  by actor / action / target.
- Export to CSV for compliance review.
**Acceptance:** every launch, edit, publish, top-up shows up in the
audit log within 1s.

### M3 — Observability + alerting
**Resources:** Langfuse (already wired for LLM traces), Sentry (errors
+ frontend), Cloudflare Analytics.
**Outline:**
- Every Worker route wrapped in a Langfuse span.
- Sentry catches frontend errors; alert on >1% error rate sustained 5min.
- Cloudflare Analytics for traffic + edge metrics.
- Synthetic check (Playwright run hourly) hits `/launch` flow end-to-end.
**Acceptance:** introducing a deliberate 500 in `/v1/launches` triggers
a Sentry alert + Slack notification within 60s.

### M4 — Secret rotation + Stripe webhook signature verification
**Resources:** Cloudflare secrets, Stripe webhook signing secret.
**Outline:**
- All secrets fetched via Wrangler env (already done); rotation runbook
  in `docs/RUNBOOK.md`.
- Stripe webhook handler verifies `Stripe-Signature` header, rejects
  unsigned/replayed events.
- API keys have a 90-day expiration toggle (off by default).
**Acceptance:** unsigned webhook calls return 400; expired API key
returns 401.

### M5 — Disaster-recovery + data export
**Resources:** Postgres dump on schedule, R2 lifecycle.
**Outline:**
- Daily Postgres dump → R2 archive (retain 30 days).
- Per-tenant data export endpoint `GET /v1/me/export` returns ZIP of
  every product, listing, image, audit event for compliance / churn.
**Acceptance:** restoring from yesterday's dump produces a working DB;
an export contains every row tagged with the tenant.

---

## Cross-cutting concerns

### Vocabulary glossary (kept in sync across UI + API)

- **Tenant** = an agency account (one billing entity, many operators).
- **Operator** = a human user inside a tenant (Clerk Organization member).
- **Seller** = an end-client of the agency (the brand whose products
  ship to Amazon). One tenant has many sellers; one seller has many
  products.
- **Product** = a SKU. One product has 1+ variants (color/pattern
  differences).
- **Variant** = the unit that platform_assets attach to.
- **Reference** = an agency-supplied "before" image (status='reference').
- **Generated** = an orchestrator-produced image (status='draft' →
  'approved' → 'published').
- **Listing** = the bilingual SEO copy bundle for a (variant, surface,
  language) tuple.
- **Launch** = one orchestrator run that produces N images + M listings
  for one variant.

### Schema migration strategy
Every Phase G–M adds tables / columns. Use Drizzle migrations checked
into `apps/mcp-server/drizzle/`. Apply via the existing `setup-db.mjs`
runner. Production migrations gated on a feature flag in tenants table
to stage rollout.

### Feature flags
New `tenant.features` jsonb column. Flags: `inline_edit`, `bulk_export`,
`public_api`, `webhooks`, `image_kind_dispatch`. Lets us ship phases
behind a flag, dogfood with one tenant before opening to all.

### Backward compatibility
Existing v1 social-content code path (`/demo/run-campaign`,
`run_campaign` workflow) is dead. Drop it entirely in Phase G (G2 is the
right time, since we're touching schemas anyway).

---

## Suggested execution order

1. **G1 + G2** — auth + tenant column. Blocks everything else; do first.
2. **G3 + G4** — listings persistence + wallet scaffolding.
3. **H1 + H2** — upload UI + onboarding (without billing). Lets us
   demo end-to-end self-serve.
4. **I1** — pipeline approach decision spike. Run in parallel with H.
5. **H3 + H4** — Stripe billing.
6. **I2 + I3 + I4 + I5** — full pipeline upgrade, gated behind a
   feature flag for one tenant first.
7. **J1 + J2 + J3 + J4** — library + SKU detail page.
8. **K1 + K2 + K3 + K4** — edit + publish flow.
9. **L1 → L4** — public API.
10. **M1 → M5** — scale hardening, runs throughout but sealed off as a
    final phase.

Roughly: G + H + I (= MVP-of-SaaS) is ~6 weeks of focused work; J + K
adds the editorial layer (~3 weeks); L + M productize for scale (~3
weeks). Total estimate 12 weeks at single-engineer pace, less if
parallelized.

---

## Open questions for follow-up plans

These don't block starting — but each section above will need them
answered before its detailed plan is written:

- **G1:** Clerk vs Cloudflare Access vs Auth0 — pick when starting G1.
- **H3:** exact pricing per slot (is $0.50/image fair, or do we need
  cost-plus a fixed margin like 1.6×)? Check FAL + Anthropic actual
  unit costs first.
- **I1:** TS-port vs external Python service vs hybrid — output of the
  research spike.
- **J3:** Cmd-K palette feels over-engineered for 50-product catalogs;
  consider deferring to Phase L+.
- **K2:** how aggressive is the "regenerate" — 1 click costs ~$0.30; do
  we cap monthly regen attempts per tenant?
- **L2:** rate-limit thresholds per plan — needs a draft pricing table
  in H3 first.

---

## Appendix: artifact registry

When each phase is implemented, link the resulting plans here:

- `plans/active-plan-frontend-ux.md` — F1-F5, ✅ shipped 2026-04-27
- `plans/active-plan-saas-G.md` — Phase G (foundation), pending
- `plans/active-plan-saas-H.md` — Phase H (upload + billing), pending
- `plans/active-plan-saas-I.md` — Phase I (image pipeline), pending
- `plans/active-plan-saas-J.md` — Phase J (library SaaS), pending
- `plans/active-plan-saas-K.md` — Phase K (edit + publish), pending
- `plans/active-plan-saas-L.md` — Phase L (public API), pending
- `plans/active-plan-saas-M.md` — Phase M (scale hardening), pending

ADRs to author at the relevant phase:

- ADR-0003 — Image pipeline approach (TS / Python / hybrid) — Phase I1
- ADR-0004 — Auth provider selection — Phase G1
- ADR-0005 — Pricing schema + margin policy — Phase H3
- ADR-0006 — Public API versioning + deprecation policy — Phase L
