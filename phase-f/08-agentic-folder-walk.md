# Phase F · Iteration 08 — Agentic LLM folder walk (E6.1)

**Closes:** E6 plan's full agentic walk — Sonnet reads docx/pdf,
classifies loose images, surfaces confidence-flagged rows for review
**Depends on:** E6's zip-unwrap (already shipped); independent of F1-F7
**Blocks:** none
**Risk:** 🟡 low — new endpoint, no existing path to break
**Estimated session length:** large (1 PR for the classifier;
another for the UI; can split)

## Why now
E6 shipped client-side zip unwrap that feeds the existing folder-of-
folders flow. That works when the operator's zip is pre-organized
(one subfolder per product). For batches that arrive unorganized
(loose images + docx files at root), an agentic classifier is
needed: Sonnet reads the docx/pdf, classifies images by content +
filename + context, surfaces confidence-flagged uncertain rows for
operator review.

This is a sizable iteration (server + UI). Can split into F8a
(classifier endpoint) and F8b (operator-review UI) if needed.

## Files to touch

### Studio worker (`apps/mcp-server/src`)

- (new) `lib/agentic-folder-classifier.ts` — exports
  `classifyFolderContents({ files }) → ManifestProposal`. Takes a
  list of `{ path, kind: "image"|"docx"|"pdf"|"text", r2_key }`.
  Calls Sonnet 4.6 with the Files API to read docx/pdf directly.
  Returns:
  ```
  {
    products: [{ name, description?, references: r2_key[], confidence: 0-1 }],
    unassigned: [{ path, reason: string }]
  }
  ```
- `index.ts` — new endpoint `POST /v1/products/agentic-classify`
  accepting staged paths; returns the manifest
- `index.ts` — new endpoint `POST /v1/products/agentic-confirm`
  accepting an (operator-edited) manifest; creates products in a
  transaction

### Studio dashboard (`apps/dashboard/src`)

- `app/products/agentic/page.tsx` + `_client.tsx` (new) — third tab
  on `/products/*` (Single / Bulk / **Agentic**). Drop folder OR
  zip → call classify endpoint → show review table with confidence
  flags → operator confirms → call confirm endpoint
- `components/products/upload-mode-tabs.tsx` — add the Agentic tab

## Acceptance criteria

- [ ] An operator drops `bearking-vendor.zip` (7 docx + raw images,
      unorganized) into the Agentic tab. The dashboard unpacks,
      classifies, shows a manifest table within ~10s
- [ ] Each manifest row has a confidence flag. Rows with
      `confidence < 0.7` show a yellow ⚠ icon + reason
- [ ] Operator can drag an unassigned image onto a product row,
      rename a product, or delete a row. UI updates client-side
- [ ] "Confirm all" calls `/v1/products/agentic-confirm` with the
      (possibly edited) manifest. All products onboard in one
      transaction with per-product $0.50 + classifier ~$0.05 fee
- [ ] Re-uploading the same folder doesn't re-onboard products that
      already exist (dedup by name match within tenant)
- [ ] Classification respects the 100MB total upload cap

## Safety practices

- **No production hot path**: APPLIES — this is a new endpoint, no
  existing flow breaks if the new path has bugs
- **Confidence surfacing**: APPLIES — operator sees AI uncertainty
  rather than the system silently guessing. Critical for trust
- **Transactional confirm**: APPLIES — all-or-nothing onboarding
  prevents half-completed batches
- **Audit logging**: every agentic-confirm invocation logs the
  manifest summary so we can review what AI proposed vs what the
  operator accepted

## Implementation notes

- Sonnet's Files API ingests docx/pdf natively — no python pre-step
  needed. ~$0.05 per 30-product folder (small input, structured JSON
  output)
- Classifier cost is a separate `wallet_ledger` row with
  `reason='agentic_classify'` so it's distinguishable from onboard fees
- "Confidence" is Sonnet-self-reported — the prompt asks for a
  per-product confidence in [0,1]. Threshold of 0.7 for flagging
  is tunable
- Re-classification on operator-edit (drag-image-to-different-product)
  is local-only; doesn't re-call Sonnet. Operator edits win
- The agentic tab co-exists with single + bulk; doesn't replace them.
  Operators with pre-organized folders use bulk; ad-hoc batches use
  agentic

## Rollback plan

If the classifier produces consistently bad manifests:
1. Hide the Agentic tab via a feature flag
   (`tenant.features.agentic_upload_enabled = false`)
2. The unwrapping path from E6 still works for organized zips
3. Operator falls back to manual single-product onboarding

## Out of scope (do NOT do this iteration)

- Real-time SSE progress during classification (spinner is fine for v1)
- Vendor-batch versioning ("this is v2 of the same batch, diff
  against v1") — overkill for v1
- Tar/rar/7z support (zip only)
- Auto-pricing or category guessing — classifier stays scoped to
  name + description + image-assignment only
- Operator-editable Sonnet prompt — internal constant
