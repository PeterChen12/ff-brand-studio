# Phase C · Iteration 06 — Inbox operator UX

**Audit items closed:** #5, #6, #30, #36
**Depends on:** none (orthogonal to wizard work)
**Blocks:** none
**Estimated session length:** small (1 PR, ~hour)

## Why now
The inbox is the operator's daily driver — every HITL'd run lands
here. Today it shows hash IDs (`Run · 5d3e2f1a`) instead of product
names, uses native `window.prompt()` for reject reasons, has no
bulk-approve, and silently removes assets on approve with no undo.
A BFR operator processing 50 pending reviews would hate every minute
of this.

## Files to touch

- `apps/dashboard/src/app/inbox/_client.tsx`
  - Replace hash IDs in run cards with friendly labels: fetch
    `productName` and `sku` from the `/v1/inbox` response (extend
    the worker query to JOIN products)
  - Replace `window.prompt(...)` for reject reason with a styled
    modal (use existing `<ConfirmDialog>` if extensible, else
    create a small `<RejectReasonModal>`)
  - Add multi-select: each run card has a checkbox; a sticky
    action bar appears with `[Approve N] [Reject N]` once any
    rows selected
  - On approve, show a toast with `Undo` action (5s window).
    Undo calls a new `POST /v1/assets/:id/un-approve` endpoint
- `apps/mcp-server/src/index.ts`
  - Extend `GET /v1/inbox` to include `productName, productSku,
    productNameZh` per run (LEFT JOIN products on
    `runs.product_id`)
  - New `POST /v1/assets/:id/un-approve` endpoint that flips
    `assets.status` from `approved` → `pending_review` if invoked
    within 30s of approve. Emit `asset.unapproved` audit event
    (separate from approved so webhook consumers can react)
  - New `POST /v1/inbox/bulk-approve` accepting `{ asset_ids: [] }`
    (cap 50 per request to keep webhooks sane)

## Acceptance criteria

- [ ] Inbox shows "Aluminum Camp Stove (CS-001)" instead of
      "5d3e2f1a (no product)"
- [ ] Reject button opens a styled modal with a textarea, not a
      native browser prompt
- [ ] Operator selects 5 runs via checkboxes, clicks "Approve 5",
      and all five fire a single bulk-approve request
- [ ] After single approve, a toast with "Undone" appears for 5s.
      Clicking it restores the asset to the inbox
- [ ] Bulk-approve audit log shows one `asset.approved` event per
      asset (not one event for the bulk action)

## Implementation notes

- The "Undo" pattern: optimistic UI removes the row immediately,
  but the actual `POST /v1/assets/:id/approve` is delayed 5s in a
  pending queue. If undo clicked, kill the queued request. If
  not, fire it. Keeps wallet ledger clean (no charge → reverse
  charge round-trip)
- Bulk approve atomicity: each asset approve is its own DB row;
  if 3 of 5 succeed and 2 fail, return per-asset results. UI
  shows partial success
- Reject modal can reuse `<ConfirmDialog>` if it accepts arbitrary
  body content; otherwise duplicate-and-rename to keep the new
  one ergonomic
- The JOIN in `/v1/inbox` is small (max 50 rows). Don't bother
  with a separate `/v1/inbox/with-product` endpoint

## Out of scope (do NOT do this iteration)

- Filtering inbox by product / category / cost — defer
- Inbox keyboard shortcuts (J/K nav, A/R approve/reject) —
  defer to iteration 11
- Reject-with-suggested-fix flow (operator types correction,
  asset auto-regenerates) — too big for this batch
- Approving entire runs at once vs per-asset — keep per-asset
  granularity for now
