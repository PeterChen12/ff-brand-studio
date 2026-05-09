# Phase D · Iteration 02 — Agentic folder upload

**Problem:** #2 (vendor batches need a "drop the folder" path)
**Depends on:** D1 (uses the launch queue for batch progress)
**Blocks:** none
**Estimated session length:** large (likely 2 PRs split: ingest then orchestrator)

## Why now
A Bearking-style vendor batch (27 products in 7 docx files) currently
takes manual scripting (`extract_bearking_products.py` +
`upload_bearking_products.mjs`). For a non-technical operator this is
infeasible. The "agentic" path: drop a folder, an LLM reads its
structure (subfolder names = products, .txt/.md/.docx alongside =
descriptions, image files = references), proposes a manifest the
operator reviews, then onboards everything in one shot.

## Files to touch

- (new) `apps/dashboard/src/app/products/agentic/page.tsx` +
  `_client.tsx` — third tab on `/products/*` (Single / Bulk / **Agentic**).
  Uses `<input type="file" webkitdirectory>` so the browser surfaces a
  folder picker. Walks the file tree client-side, compresses images,
  uploads each to a temp `agentic-staging/` R2 prefix
- (new) `apps/mcp-server/src/lib/agentic-folder-classifier.ts` —
  given a list of `{ path, kind: "image"|"text"|"unknown" }`, calls
  Sonnet 4.6 to return a manifest:
  `{ products: [{ name, description?, references: string[] }] }`.
  System prompt explains: subfolder names usually map to product names;
  files at the same level as a subfolder usually describe siblings;
  prefer the longest non-image text file as the description source
- (new) `apps/mcp-server/src/index.ts` — `POST /v1/products/agentic-plan`
  takes `{ staged_paths: [{ path, kind }] }`, returns the manifest.
  `POST /v1/products/agentic-confirm` takes the (possibly edited)
  manifest, creates each product in a transaction, returns
  `[{ product_id, sku }]`
- `apps/dashboard/src/components/products/upload-mode-tabs.tsx` —
  add the Agentic tab between Single and Bulk

## Acceptance criteria

- [ ] Mei drags her `Bearking-Apr2026/` folder onto the Agentic tab.
      The dashboard walks the tree, lists what it found
      ("18 images, 7 text files, 27 detected products")
- [ ] After ~5s of LLM classification, she sees a table of proposed
      products with name + description preview + N references each
- [ ] Each row is editable inline: rename, swap a reference image,
      delete a product. A "Confirm all" button charges N × $0.50 +
      classifier fee, then enqueues N launches into the D1 queue
- [ ] Folders with mixed content (some clear products, some ambiguous
      "loose" images) prompt the operator: "We didn't classify these 3
      images — assign or discard"
- [ ] Re-uploading the same folder doesn't re-onboard products that
      already exist (dedup on name match within tenant)
- [ ] Agentic upload total cost line item shows clearly:
      `27 × $0.50 onboard + ~$0.10 classifier = $13.60` before
      Confirm

## Implementation notes

- Folder traversal in browser: `getAsFileSystemHandle()` is best but
  Safari support is poor; fall back to `webkitdirectory` which yields
  flat file list with full `file.webkitRelativePath`. Both are fine
  for v1
- Classifier cost: Sonnet 4.6 ~$0.05 per 30-product folder (small
  prompt; structured JSON output). Charge as a separate ledger row
  (`reason='agentic_classify'`) so it shows up distinct from onboard
  fees
- Confirm-step transaction: insert all products + reference rows in
  one `db.transaction(...)`; rollback if any single product fails
  Zod. Don't half-onboard
- Use the D1 launch queue for the auto-launch step (after Confirm,
  enqueue a launch for each new product). The operator doesn't have
  to click Launch 27 times
- For the Bearking case specifically, ALSO accept `.docx` files —
  Sonnet can read docx directly via the file-input API. Drop the
  python extraction step

## Out of scope (do NOT do this iteration)

- Re-importing previously-uploaded folders with diff awareness —
  that's a "Sync vendor batch v2" feature
- Auto-launching with marketplace selection — operator confirms each
  manifest entry before launches fire
- Server-side folder upload via SFTP — over-engineering for v1
- Smart de-dup across tenants (other operators' Bearkings) — privacy
  + scope concerns; just dedup within the operator's tenant
- Auto-pricing or category guessing — keep classifier scope to
  name + description + reference assignment only
