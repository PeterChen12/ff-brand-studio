# Phase K — Edit + Publish Flow (detailed plan)

> Detailed plan for Phase K. Depends on Phase J (library SaaS features)
> being shipped. Builds the iteration loop: generate → edit → regenerate
> → approve → publish.

**Goal of Phase K**

Generated content is iterable, not throwaway. An agency operator can
fix a mistranslated bullet, swap an off-brand image, or feed the model
specific feedback ("looks too studio, want it more lifestyle") and
land on an approved bundle they can confidently push to Amazon Seller
Central / Shopify Admin.

---

## Iteration K1 — Inline copy edit per field

**Outcome:** every persisted SEO field (Amazon title, bullets,
description, search_terms; Shopify h1, meta, description_md) gets an
inline editor with per-field validation. Edits persist to
`platform_listings`, with a version row in `platform_listings_versions`
for the audit trail.

### K1.1 — Field editor component

**Files:**
- `apps/dashboard/package.json` — add `@tanstack/react-form@^0.31`
- `apps/dashboard/src/components/listing/inline-editor.tsx`
- `apps/dashboard/src/components/listing/listing-card.tsx`

**Resources:**
- TanStack Form: typed, schema-validated, lighter than react-hook-form,
  React-19 first-class.

**Subtasks:**
1. `<InlineEditor field=... value=... rules=... />` — renders read mode
   by default, expands to a textarea (or array editor) on click.
2. Per-field validators borrowed from `packages/brand-rules/amazon` and
   `/shopify` — same as the orchestrator runs.
3. Save button disabled until all rules pass; errors render inline as
   M3 helper-text.

### K1.2 — Persist edits + version trail

**Files:**
- `apps/mcp-server/src/index.ts` — `PATCH /v1/listings/:id`
- `apps/mcp-server/src/lib/listing-edit.ts`

**Subtasks:**
1. PATCH validates against the same brand-rules + bumps an
   `iterations` counter.
2. Before UPDATE, `INSERT INTO platform_listings_versions ... SELECT
   ... FROM platform_listings WHERE id = :id` — captures the prior
   row.
3. Audit event `listing.edit` with the field name + diff summary.

### K1.3 — Diff viewer

**Files:** `apps/dashboard/src/components/listing/version-diff.tsx`

**Subtasks:**
1. "View versions" link on each listing card opens a side-panel diff
   between the current and the latest version.
2. Diff library: `diff@5` (MIT, ~25kB) — character-level diff with
   word-boundary smoothing.

### K1.4 — Acceptance for K1

- Edit Amazon title to 250 chars → red error visible, save disabled.
- Save valid edits → page reload still shows new value.
- `platform_listings_versions` row gets written on every save.

---

## Iteration K2 — Feedback-driven image regen

**Outcome:** operator can right-click any image and request a regen
with feedback. Charges $0.30 per single-asset regen (per ADR-0005).

### K2.1 — Feedback chatbox

**Files:**
- `apps/dashboard/src/components/library/regen-modal.tsx`

**Subtasks:**
1. Right-click (or "Regenerate" button) opens modal with:
   - Pre-filled feedback chips: "halo / artifacts", "wrong angle",
     "wrong color", "off-brand", "watermark visible".
   - Free-text textarea.
   - Predicted cost: $0.30. Wallet check (matches the H4 pattern).
2. Submit → `POST /v1/assets/:id/regenerate` body `{ feedback: string,
   chips: string[] }`.

### K2.2 — Worker regen endpoint

**Files:**
- `apps/mcp-server/src/index.ts` — `POST /v1/assets/:id/regenerate`
- `apps/mcp-server/src/orchestrator/regenerate.ts`

**Subtasks:**
1. Auth + tenant-scope check.
2. chargeWallet $0.30 with reason `regenerate`.
3. Look up asset → variant → product. Build a refine prompt that
   prepends the operator's feedback to the existing prompt template.
4. Re-run Nano Banana Pro with `[studio_ref, current_asset]` as
   reference inputs. Append result to `refinement_history`.
5. Refund if regen fails (matches H4 refund-on-fail pattern).

### K2.3 — Per-tenant monthly cap

**Files:** `apps/mcp-server/src/lib/regen-cap.ts`

**Subtasks:**
1. Default cap: 200 regens/tenant/month. Configurable via
   `tenant.features.max_regens_per_month`.
2. Cap consulted in K2.2 before chargeWallet; 429 if exceeded.

### K2.4 — Acceptance for K2

- Regen with "wrong angle" feedback produces a visibly different image.
- Wallet debits $0.30 per attempt.
- 201st regen of the month returns 429 with a clear error.

---

## Iteration K3 — Approve → publish bundle

**Outcome:** agency marks a SKU "approved" → bundle is locked, exported,
and shipped to the agency's destination (Amazon SP-API draft listing
OR S3-bucket dump for manual upload, opted in per tenant).

### K3.1 — Approval state machine

**Schema:** new column `platform_listings.approved_at timestamp` plus
`platform_assets.approved_at`.

**Files:**
- `apps/mcp-server/drizzle/0003_phase_k_approvals.sql`
- `apps/mcp-server/src/index.ts` — `POST /v1/skus/:productId/approve`,
  `POST /v1/skus/:productId/unapprove`

**Subtasks:**
1. Approve = set `approved_at = now()` on every listing + asset for
   the product. Audit event `listing.publish`.
2. Approval is idempotent + reversible.
3. Unapprove clears `approved_at` (single update, no version row needed).

### K3.2 — Publish destinations

**Files:**
- `apps/mcp-server/src/lib/publish/amazon-spapi.ts` — stub initially;
  uses Amazon SP-API JSON-Listings (LXMP) format.
- `apps/mcp-server/src/lib/publish/r2-export.ts` — bundle the ZIP +
  manifest from J2 to a tenant-private R2 prefix
  `tenant/<tid>/exports/<run>/...` and email a presigned URL.

**Subtasks:**
1. Tenant settings: `publish.target = 'r2_export' | 'amazon_spapi'`,
   default `r2_export`.
2. POST /v1/skus/:productId/publish with target. r2_export is the
   default and only one shipped in K3 — Amazon SP-API stub returns
   `not_implemented` until the agency provides their LWA refresh
   token (added in Phase L's API key flow).

### K3.3 — Email notifications

**Files:**
- `apps/mcp-server/src/lib/email.ts` — uses Resend (free tier 3K
  emails/mo).

**Subtasks:**
1. New worker secret: `RESEND_API_KEY`.
2. On publish: email the operator (Clerk user.primary_email_address) a
   download link to the export ZIP, plus a summary of what's inside.

### K3.4 — Acceptance for K3

- Approving a SKU sets `approved_at` on every listing + asset.
- Publish writes a ZIP to `tenant/<tid>/exports/...` and emails a 7-day
  presigned URL.
- Reverting approval restores the SKU to draft.

---

## Cross-cutting Phase K concerns

### Costs

Resend (3K free emails/mo) covers the bulk of agency-scale traffic.
Each regen costs us ~$0.30 in FAL spend; we charge $0.30 — break-even,
priced for stickiness. Margin will recover at scale once we negotiate
volume rates with FAL.

### Estimated effort

| Iteration | Engineer-days |
|---|---|
| K1 (inline edit + version) | 4 |
| K2 (feedback regen + cap) | 3 |
| K3 (approve + publish) | 3 |
| Buffer | 1 |
| **Total** | **~11 days** |

---

## Resolved questions (locked 2026-04-27)

1. **Edit conflict resolution.** Last-write-wins with a conflict toast
   if the underlying row was updated since the editor opened. Full
   collaborative editing deferred until 5+ tenants ask for it.
2. **Regen cap default.** 200/tenant/month — covers heavy iteration
   across 100 SKUs at 2 regens each. Configurable up to 1000 by
   tenant.plan.
3. **Publish target.** R2 export + email is the only built-in target
   in K. Amazon SP-API integration ships when an agency provides their
   LWA refresh token (which assumes Phase L API keys are live).
4. **Email provider.** Resend over Postmark/SES — best DX, free tier
   covers Phase K + L volume.

---

## Deliverables checklist

When Phase K is done:

- [ ] Inline editor with per-field validators on every Amazon /
      Shopify field
- [ ] Edits persist; `platform_listings_versions` rows written
- [ ] Side-panel diff viewer shows last vs current
- [ ] Right-click any asset → regen modal with feedback chips
- [ ] Regen charges $0.30, refunds on failure
- [ ] Per-tenant monthly regen cap enforced
- [ ] SKU approval flow sets `approved_at` everywhere
- [ ] Publish-to-R2 produces a ZIP + manifest at
      `tenant/<tid>/exports/...`
- [ ] Operator gets a Resend email with a presigned download link
- [ ] `SESSION_STATE.md` updated with the iterate-then-publish flow

When all are checked, the platform shifts from "show-and-tell" to
"ship-it". Phase L (public API) opens the iteration to programmatic
consumers.
