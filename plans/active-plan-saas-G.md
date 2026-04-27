# Phase G — Foundation: Auth, Tenancy, Persistence (detailed plan)

> Detailed plan for Phase G of the SaaS iteration. See
> `plans/saas-iteration-plan.md` for the broader sequence (G–M).
> Locked decisions from 2026-04-27 review apply throughout.

**Goal of Phase G**

Every row in the platform belongs to a tenant; every dashboard page is
authenticated; every Worker endpoint is tenant-scoped. SEO copy is
persisted (no longer ephemeral). Wallet + audit-log scaffolding is in
place so Phase H (Stripe) just plugs into existing primitives.

**Phase G is the BLOCKER for everything else.** Until rows have
`tenant_id` we cannot safely open up self-serve upload (anyone could
read anyone's data), and until SEO copy persists we cannot build
edit/publish flows.

---

## ADR-0004 — Auth provider selection

### Decision

Use **Clerk** for authentication and B2B organizations.

### Context / alternatives considered

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **Clerk** | Free tier 10K MAU; native B2B `Organization` primitive; Next.js 15 + React 19 first-class; drop-in `<SignIn />` / `<SignUp />` / `<OrganizationSwitcher />`; webhook on `organization.created`; Workers-compatible JWT verification via `@clerk/backend` | Vendor lock-in; pricing climbs at 10K+ MAU ($25/mo + $0.02/MAU); session cookies need same-origin or careful CORS for Worker | **Picked** |
| Cloudflare Access | Free with CF account; deeply integrated; zero ops | No native multi-org primitive; B2B requires manual modeling; SSO-only flow is opinionated; less polished consumer-facing UI | Too thin for self-serve SaaS |
| Auth0 | Mature; extensive docs | Costlier free tier (7.5K MAU); B2B add-on is $$$; heavier integration | Overkill for MVP |
| Roll our own | No vendor lock | 4–6 weeks of work, security risk, maintenance forever | Off the table |

### Consequences

- New dependency: `@clerk/nextjs` (dashboard) + `@clerk/backend`
  (mcp-server, used in Worker JWT verification).
- Pages still serves a static export. Auth gating happens client-side
  via `<SignedOut><RedirectToSignIn /></SignedOut>` — no Edge middleware
  required, no `output: 'export'` regression.
- Clerk Organizations map 1:1 to our `tenants` table. We sync via the
  `organization.created` webhook + a fallback "first request" lazy-create.
- Force-orgs mode: every user must belong to at least one organization.
  Personal accounts are not supported. Simpler product story for an
  agency platform.
- API keys (Phase L) layer on top: a Worker request can carry either
  a Clerk session JWT OR a tenant-scoped `ff_live_*` API key.

### Migration / rollback

- **Migration:** all existing seeded data sits under a `legacy-demo`
  tenant created in G2's backfill. The 5 demo SKUs become visible only
  to that tenant.
- **Rollback:** if Clerk needs to be replaced, the dependency surface is
  thin: `@clerk/nextjs` provider in `layout.tsx`, JWT verification in
  one Worker middleware, `clerk_org_id` column in `tenants`. Replacing
  costs ~2 days.

---

## Schema migration registry (one big migration vs four)

Phase G touches schema four times, but it is cleaner to ship as
**one migration file** committed at G1 and applied once. Sub-iterations
G2–G4 then ride on top.

| Object | Action | Notes |
|---|---|---|
| `tenants` (new) | CREATE | `id`, `clerk_org_id` UNIQUE, `name`, `stripe_customer_id` NULL, `wallet_balance_cents` default 500, `plan` default `'free'`, `features` jsonb default `'{}'`, `created_at` |
| `seller_profiles` | ALTER ADD `tenant_id uuid` | NOT NULL after backfill; FK to `tenants.id` |
| `products` | ALTER ADD `tenant_id uuid` | NOT NULL after backfill |
| `product_variants` | ALTER ADD `tenant_id uuid` | NOT NULL after backfill |
| `product_references` | ALTER ADD `tenant_id uuid` | NOT NULL after backfill |
| `platform_assets` | ALTER ADD `tenant_id uuid` | NOT NULL after backfill (denormalized — saves a join on every read) |
| `launch_runs` | ALTER ADD `tenant_id uuid` | NOT NULL after backfill |
| `assets` (legacy v1) | ALTER ADD `tenant_id uuid` | NOT NULL — backfill to `legacy-demo` tenant |
| `platform_listings` (new) | CREATE | full table per G3 spec below |
| `wallet_ledger` (new) | CREATE | append-only |
| `audit_events` (new) | CREATE | append-only |
| Indexes | CREATE | `(tenant_id)` btree on every domain table; `(tenant_id, created_at desc)` on `launch_runs` and `platform_assets` for the dashboard sort path |

Migration file: `apps/mcp-server/drizzle/0002_phase_g_tenancy.sql`
(committed once; idempotent guards via `IF NOT EXISTS`).

---

## Iteration G1 — Tenant + auth provider integration

**Outcome:** unauthenticated browser hitting any page lands on Clerk
sign-in; new signup creates a tenant + grants $5 credit; Worker
endpoints reject requests without a valid JWT.

### G1.1 — Install + provider wiring

**Files / new files:**
- `apps/dashboard/package.json` — add `@clerk/nextjs`
- `apps/mcp-server/package.json` — add `@clerk/backend`
- `apps/dashboard/src/app/layout.tsx` — wrap children with
  `<ClerkProvider>`
- `apps/dashboard/.env.local` — `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `apps/mcp-server/wrangler.toml` — secrets entries for `CLERK_SECRET_KEY`,
  `CLERK_PUBLISHABLE_KEY`, `CLERK_WEBHOOK_SECRET`

**Resources:**
- [Clerk Next.js quickstart](https://clerk.com/docs/quickstarts/nextjs)
- [Clerk Cloudflare Workers integration](https://clerk.com/docs/references/backend/overview)

**Subtasks:**
1. Install `@clerk/nextjs` in dashboard with `--legacy-peer-deps`
   (React 19 compatibility note).
2. Create Clerk application in dashboard; copy publishable + secret.
3. Add the 3 Clerk env vars to local `.env`, to `apps/dashboard/.env.local`
   (publishable only), and to Worker secrets via `wrangler secret put`.
4. Add `<ClerkProvider>` to `RootLayout`. Configure
   `appearance.theme = neutral`, FF brand color overrides for the
   `<SignIn />` / `<SignUp />` modals.
5. Force-orgs setting in Clerk dashboard: enable "Organizations are
   required" so personal accounts cannot use the product.

### G1.2 — Sign-in / sign-up routes + protected layout

**Files / new files:**
- `apps/dashboard/src/app/(auth)/sign-in/[[...sign-in]]/page.tsx`
- `apps/dashboard/src/app/(auth)/sign-up/[[...sign-up]]/page.tsx`
- `apps/dashboard/src/app/(auth)/layout.tsx` — slimmer layout, no Shell
- `apps/dashboard/src/components/layout/shell.tsx` — wrap nav in
  `<SignedIn>`; show `<RedirectToSignIn />` when `<SignedOut>`

**Subtasks:**
1. Catch-all `/sign-in/[[...sign-in]]` route renders `<SignIn />`.
   Same for `/sign-up`.
2. Auth-only layout (no sidebar, centered card).
3. Shell gates everything else: `<SignedOut><RedirectToSignIn /></SignedOut>`.
4. `<OrganizationSwitcher />` lives in the sidebar footer (replaces /
   complements the API-status indicator).
5. After sign-in: redirect to `/` (Overview).

### G1.3 — `tenants` table + Clerk → tenant sync

**Files / new files:**
- `apps/mcp-server/drizzle/0002_phase_g_tenancy.sql` — full migration
- `apps/mcp-server/src/db/schema.ts` — add `tenants` Drizzle definition
- `apps/mcp-server/src/lib/tenants.ts` — `ensureTenantForOrg(orgId, name)`
- `apps/mcp-server/src/index.ts` — `POST /v1/clerk-webhook` handler

**Resources:**
- [Clerk webhooks docs](https://clerk.com/docs/integrations/webhooks)
- Use `svix` (already a Clerk dep) to verify the webhook signature.

**Subtasks:**
1. Apply the migration to local + production Postgres.
2. Drizzle schema: `tenants` mirrors the SQL exactly.
3. `ensureTenantForOrg(orgId, name)`: SELECT tenant by `clerk_org_id`;
   if missing, INSERT with $5 starter credit and a corresponding
   `wallet_ledger` row (`reason='signup_bonus'`).
4. Clerk webhook endpoint listens for `organization.created`,
   `organization.updated`, `organization.deleted`. On created → call
   `ensureTenantForOrg`. On updated → sync name. On deleted → mark
   tenant `plan='deleted'` (soft-delete, preserve audit).
5. Verify webhook via `svix.verify(...)` with `CLERK_WEBHOOK_SECRET`.
6. Add a fallback "lazy create on first authenticated request" so we're
   not 100% dependent on the webhook being delivered.

### G1.4 — Worker auth middleware

**Files / new files:**
- `apps/mcp-server/src/lib/auth.ts` — `requireTenant` Hono middleware
- `apps/mcp-server/src/index.ts` — apply middleware to all `/v1/*` and
  `/api/*` routes; leave `/health` + `/v1/clerk-webhook` open

**Subtasks:**
1. `requireTenant` middleware:
   - Extract `Authorization: Bearer <jwt>` header (Clerk session token)
     or fall back to `Cookie: __session=...`.
   - `verifyToken(jwt, { secretKey: env.CLERK_SECRET_KEY })` from
     `@clerk/backend`.
   - Read `org_id` claim from the verified JWT.
   - `ensureTenantForOrg(org_id, ...)` returns the tenant row.
   - Attach `c.set('tenant', row)` and `c.set('actor', userId)` for
     downstream handlers.
   - 401 if any step fails.
2. Update existing Worker routes incrementally. (G2 finishes this.)
3. Open routes: `/health`, `/v1/clerk-webhook`, `/v1/stripe-webhook`
   (future H3).

### G1.5 — Frontend API client carries the JWT

**Files / new files:**
- `apps/dashboard/src/lib/api.ts` — typed fetch wrapper that calls
  `await getToken()` from `@clerk/nextjs` and attaches it.
- All existing `fetch(${MCP_URL}/...)` call sites in the dashboard
  migrated to use the wrapper.

**Subtasks:**
1. Wrapper: `apiFetch(path, init?)` — gets token via Clerk's
   `useAuth().getToken()` (client side), or `auth().getToken()` (RSC),
   sets `Authorization: Bearer <token>` header, parses JSON, throws
   typed errors.
2. Replace direct fetches in: `Shell` (health probe — actually keep
   open), `OverviewPage` (`/api/launches`, `/api/assets`),
   `LaunchWizard` (`/api/products`, `/demo/launch-sku`), `LibraryPage`
   (`/api/assets`), `CostsPage` (`/api/launches`).

### G1.6 — Acceptance for G1

- Browser hitting `/library` while signed out is redirected to `/sign-in`.
- Curling `https://...workers.dev/api/products` without the
  `Authorization` header returns `401`.
- Signing up creates: a Clerk user → an org (forced) → a `tenants` row
  via webhook → a `wallet_ledger` row of `+500c` with reason
  `signup_bonus` → wallet balance `500`.
- The `<OrganizationSwitcher />` shows up in the sidebar; user can
  switch orgs and the page re-renders against the new tenant.

---

## Iteration G2 — Tenant column on every domain table

**Outcome:** every row in every domain table carries `tenant_id`. Every
Worker query filters by it. Tenant A cannot read Tenant B via any path.

### G2.1 — Schema migration (already authored in G1.3 file)

**Subtasks:**
1. Apply the migration. Tables touched: 8 (listed in registry above).
2. Backfill: `UPDATE <table> SET tenant_id = (SELECT id FROM tenants
   WHERE clerk_org_id = 'legacy-demo')` for every existing row before
   the NOT NULL constraint is enforced.
3. Insert a fixture `tenants` row with `clerk_org_id='legacy-demo'`
   ahead of the backfill. Document this in
   `scripts/seed-legacy-tenant.mjs`.

### G2.2 — Drizzle schema updates

**Files:** `apps/mcp-server/src/db/schema.ts`

**Subtasks:**
1. Add `tenantId: uuid('tenant_id').notNull().references(() => tenants.id)`
   to every domain table definition.
2. Add `tenants` table definition.
3. Add `platform_listings`, `wallet_ledger`, `audit_events` definitions
   (used by G3 + G4).
4. Re-export `Tenant`, `NewTenant`, `PlatformListing`, etc. types.

### G2.3 — Tenant-scoped query helpers

**Files / new files:**
- `apps/mcp-server/src/db/scoped.ts` — `scoped(db, tenantId)` returns
  a wrapped builder that auto-injects `where tenant_id = ...` on every
  table access.

**Resources:**
- Drizzle has no built-in row-level security; we wrap manually.

**Subtasks:**
1. Implement `scoped(db, tenantId)` returning an object with methods
   matching what handlers use: `selectFrom(table)`, `insertInto(table)`,
   `update(table)`, `delete(table)`. Each prepends `tenant_id` to the
   filter / value.
2. Document the pattern in `apps/mcp-server/CONTRIBUTING.md`: "every
   domain query goes through `scoped(c.var.db, c.var.tenantId)`".
3. Lint rule (custom Biome plugin or grep-based CI guard) that fails
   the build if a Drizzle query against a domain table is missing a
   `tenant_id` filter.

### G2.4 — Migrate every existing handler

**Files:** all of `apps/mcp-server/src/index.ts` route handlers, plus
`apps/mcp-server/src/orchestrator/launch_pipeline.ts`,
`seo_pipeline.ts`, every MCP tool.

**Subtasks:**
1. Replace `db.select().from(products)` with
   `scoped(db, tenantId).selectFrom(products)`.
2. INSERTs: every `db.insert(products).values(...)` becomes
   `scoped(db, tenantId).insertInto(products).values(...)` — the helper
   merges `tenant_id` into the values automatically.
3. Orchestrator: `runLaunchPipeline` accepts `tenant_id` as input,
   stamps every row it creates (variants, platform_assets, listings).
4. MCP tools: pass the tenant_id from the registered tool context
   (this requires plumbing the auth context into the MCP server's tool
   invocation, which is non-trivial — punt to Phase L if blocked, since
   MCP isn't tenant-aware in our current usage).

### G2.5 — Migrate seed scripts

**Files:** `scripts/seed-demo-skus.mjs`, `scripts/seed-fishing-rod-references.mjs`

**Subtasks:**
1. Each script ensures the `legacy-demo` tenant exists, then writes
   every row with that tenant_id.
2. New script `scripts/seed-legacy-tenant.mjs` is the single source of
   truth for the demo tenant UUID.

### G2.6 — Acceptance for G2

- SQL audit query returns 0 rows where `tenant_id IS NULL` across all
  domain tables.
- A test that creates Tenant B, inserts a Product, then queries from
  Tenant A's session returns an empty list (not the Tenant B product).
- The Biome / CI guard passes; introducing `db.select().from(products)`
  without scoping fails the build.

---

## Iteration G3 — `platform_listings` table for SEO copy persistence

**Outcome:** every successful launch persists per-surface copy; the
dashboard can fetch + display past listings.

### G3.1 — Drizzle schema (in the G2 migration)

```ts
export const platformListings = pgTable(
  "platform_listings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    variantId: uuid("variant_id").notNull().references(() => productVariants.id, { onDelete: "cascade" }),
    surface: text("surface").notNull(),       // amazon-us | tmall | jd | shopify
    language: text("language").notNull(),     // en | zh
    copy: jsonb("copy").notNull(),
    flags: jsonb("flags").notNull().default([]),
    violations: jsonb("violations").notNull().default([]),
    rating: text("rating"),                   // EXCELLENT | GOOD | FAIR | POOR
    iterations: integer("iterations").default(1),
    costCents: integer("cost_cents").default(0),
    status: text("status").notNull().default("draft"), // draft | approved | published
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => ({
    uniqVariantSurface: uniqueIndex("uniq_variant_surface_lang").on(
      t.variantId, t.surface, t.language
    ),
    tenantIdx: index("idx_listings_tenant").on(t.tenantId),
  })
);
```

### G3.2 — Persist from `runSeoPipeline`

**Files:** `apps/mcp-server/src/orchestrator/seo_pipeline.ts`

**Subtasks:**
1. After each surface's iteration loop terminates (succeeded or capped),
   `INSERT INTO platform_listings ... ON CONFLICT (variant_id, surface,
   language) DO UPDATE` with the latest copy + rating + iterations +
   cost. Keeps a single live record per surface (older revisions
   captured by G3.4 versioning, not this initial cut).
2. Update the function signature to accept `tenant_id` + `variant_id`
   (callers pass them in).
3. Update callers: `runLaunchPipeline` already has both; the `/demo/seo-preview`
   endpoint synthesizes a tenant — refactor that to require auth + use
   the real tenant.

### G3.3 — Read endpoint

**Files:** `apps/mcp-server/src/index.ts`

**Subtasks:**
1. New endpoint `GET /v1/listings?variant_id=...` (or `?sku=...`) —
   returns the live listings for that variant, scoped to tenant.
2. Update `/api/assets` (rename to `/v1/assets` per Phase L versioning
   prep) to optionally side-load matching listings via the
   `?include=listings` query param.
3. New endpoint `GET /v1/listings/:id/history` — returns the version
   history (G3.4).

### G3.4 — Listings versioning

**Files:** new table `platform_listings_versions`.

**Subtasks:**
1. New table mirrors `platform_listings` columns plus `parent_listing_id`
   and `version` int. Append-only.
2. Trigger or app-level: every UPDATE to `platform_listings` writes the
   prior row to `platform_listings_versions`.
3. Used by Phase K's edit/regen flow to show "before / after" diffs and
   roll back.

### G3.5 — Acceptance for G3

- A launch run that produces 2 surfaces creates 2 rows in
  `platform_listings`, both with the right tenant_id.
- Refreshing the dashboard 24h later still shows the same copy.
- `GET /v1/listings?variant_id=<demo-rod>` returns the persisted JSON.

---

## Iteration G4 — Wallet + audit log scaffolding

**Outcome:** every cost is debited from a tenant's wallet through a
single helper; every meaningful action writes an audit row. Phase H
billing builds on top, doesn't reinvent.

### G4.1 — Schema (in the G2 migration)

```ts
export const walletLedger = pgTable("wallet_ledger", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  deltaCents: integer("delta_cents").notNull(),
  reason: text("reason").notNull(),       // 'launch_run' | 'signup_bonus' | 'stripe_topup' | 'refund' | 'admin_grant'
  referenceType: text("reference_type"),  // 'launch_run' | 'stripe_session' | null
  referenceId: uuid("reference_id"),
  balanceAfterCents: integer("balance_after_cents").notNull(),
  at: timestamp("at").defaultNow(),
});

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  actor: text("actor"),                   // clerk user_id; nullable for system events
  action: text("action").notNull(),       // 'launch.start' | 'launch.complete' | 'product.create' | 'listing.edit' | 'listing.publish' | 'wallet.debit' | 'wallet.credit'
  targetType: text("target_type"),
  targetId: uuid("target_id"),
  metadata: jsonb("metadata").default({}),
  at: timestamp("at").defaultNow(),
});
```

### G4.2 — Wallet helpers

**Files:** `apps/mcp-server/src/lib/wallet.ts`

**Subtasks:**
1. `chargeWallet(db, tenantId, cents, reason, referenceType, referenceId)`:
   - Single transaction.
   - SELECT current balance FOR UPDATE.
   - If `balance + delta < 0`, throw `InsufficientFundsError`.
   - INSERT into `wallet_ledger`.
   - UPDATE `tenants.wallet_balance_cents`.
   - Return `{ balanceAfter }`.
2. `creditWallet(...)` — symmetric for top-ups, signup bonus, refunds.
3. `getBalance(tenantId)` — simple helper (cached on the tenant row;
   ledger is the source of truth, the tenant column is the cache).
4. Periodic (or on-demand) reconciliation: SUM the ledger and compare
   to the cached column; alert if they diverge.

### G4.3 — Audit helpers

**Files:** `apps/mcp-server/src/lib/audit.ts`

**Subtasks:**
1. `auditEvent(db, tenantId, actor, action, targetType, targetId, metadata)`
   — fire-and-forget INSERT (does not block the request).
2. Strongly-typed `Action` union (TypeScript) so call sites can't typo
   `launch.start` vs `launch_start`.
3. Emit calls from: launch start + complete, listing edit, listing
   publish, product create, wallet debit + credit, signup, organization
   create / delete.

### G4.4 — Wire into `runLaunchPipeline`

**Files:** `apps/mcp-server/src/orchestrator/launch_pipeline.ts`

**Subtasks:**
1. At start: write `audit.launch.start`.
2. Pre-flight: `chargeWallet(tenant, estimated_cost_cents,
   'launch_run', 'launch_run', run_id)` — debits up-front against the
   *predicted* cost (with a small float). Phase H tunes the prediction.
3. After workers + adapters + SEO: refund or top-up the difference
   between predicted and actual:
   `creditWallet(...)` if predicted > actual, `chargeWallet(...)` if
   actual > predicted (subject to the same insufficient-funds guard).
4. At end: write `audit.launch.complete` with status + cost + duration.

### G4.5 — Acceptance for G4

- Manually inserted `wallet_ledger` rows sum to the cached
  `tenants.wallet_balance_cents`.
- Tenant with $0 balance hitting `/v1/launches` is rejected with `402
  Payment Required` and a clear `code: 'wallet_insufficient'` JSON body.
- Every launch has at least 2 `audit_events` rows: `launch.start` and
  `launch.complete` (or `.failed`).
- Reconciliation script `scripts/audit-wallet-integrity.mjs` returns 0
  drift across all tenants.

---

## Cross-cutting Phase G concerns

### Migration safety

The G2 migration is the largest schema change since the v2 pivot. To
de-risk:

1. **Apply to local first.** Run against `localhost:5432/ff_brand_studio_dev`
   restored from a recent prod dump.
2. **Backfill before NOT NULL.** Alter add nullable column → backfill
   to legacy-demo tenant → alter set NOT NULL.
3. **Rollback script** committed alongside (`drop column` + `drop
   table`).
4. **Deploy order:** schema first → Worker rev with auth-required
   middleware second → dashboard rev third. Each reversible.

### Frontend impact during the transition

Until G1.5 ships, dashboard fetches break (no JWT yet). Approach: ship
G1 + G2 as a single deployment, not piecemeal. Keep the `legacy-demo`
tenant accessible via a special "dev mode" header during local testing.

### Costs

Phase G itself adds zero recurring costs:

- Clerk free tier covers 10K MAU.
- Postgres rows added are negligible.
- Wallet & audit rows accumulate at ~10/launch — well within Postgres
  budget.

### Estimated effort

| Iteration | Engineer-days |
|---|---|
| G1 (auth provider) | 3 |
| G2 (tenant column) | 4 |
| G3 (listings persistence) | 2 |
| G4 (wallet + audit) | 2 |
| Migration + smoke + deploy | 1 |
| Buffer (one unknown) | 1 |
| **Total** | **~13 days** (~3 weeks at half-time) |

---

## Resolved questions (locked 2026-04-27)

1. **Clerk plan.** Stay on the **Free** tier through MVP. Re-evaluate
   when we cross 5K MAU. Triggers: free-tier ceiling at 10K MAU; the
   first $25/mo charge there is acceptable; "Enhanced B2B Auth"
   ($100/mo flat) deferred until we need SSO / SAML for an
   enterprise tenant.
2. **Multi-org per user.** **Yes.** `<OrganizationSwitcher />` lives in
   the sidebar footer. Operators can belong to multiple agencies; each
   org maps to one tenant.
3. **`legacy-demo` tenant fate.** **Convert to read-only "Sample
   Catalog"** linked via the `tenant.features.has_sample_access` flag.
   Every new signup gets the flag turned on so they can explore the
   pre-seeded fishing-rod SKUs without paying. Their own tenant is
   separate; they cannot edit Sample SKUs but can clone one into their
   own catalog as a starting point. Sample-tenant rows are invisible
   to wallet / billing.
4. **Wallet currency.** **USD-only** in Phase G + H. Multi-currency
   parked behind a `tenant.features.multi_currency` flag for a future
   phase if a non-US agency lands.
5. **MCP server tenant context.** **Punt to Phase L.** Until the public
   API ships with `ff_live_*` keys, the MCP tools called by Claude
   Desktop are read-only against the `legacy-demo` Sample tenant.
   Tenant-scoped writes are dashboard-only until L1 + L2 land.

---

## Deliverables checklist

When Phase G is done:

- [ ] Clerk app live, force-orgs enabled
- [ ] `tenants`, `platform_listings`, `platform_listings_versions`,
      `wallet_ledger`, `audit_events` tables exist in prod
- [ ] All 8 domain tables have `tenant_id NOT NULL`
- [ ] Worker rejects unauthenticated requests with 401
- [ ] Dashboard wraps everything in `<ClerkProvider>`; `/sign-in` and
      `/sign-up` work
- [ ] New signup creates tenant + grants $5 starter credit + 1
      `wallet_ledger` row
- [ ] Every launch debits the wallet through `chargeWallet()`
- [ ] Every launch writes `audit.launch.start` + `.complete`
- [ ] SEO copy persists in `platform_listings`; visible after page
      reload
- [ ] CI guard prevents un-scoped Drizzle queries from being merged
- [ ] `scripts/audit-wallet-integrity.mjs` returns clean
- [ ] ADR-0004 committed
- [ ] `SESSION_STATE.md` updated with the new auth flow + tenant model

When all are checked, Phase H (Stripe billing + self-serve upload) is
unblocked.
