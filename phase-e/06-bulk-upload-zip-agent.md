# Phase E · Iteration 06 — Bulk upload zip + agentic folder walk

**Problem:** #6 (bulk upload not robust enough — needs zip support +
true agentic folder walk)
**Depends on:** Phase D's D2 (agentic folder upload — gets most of the
infra; this iteration adds zip + robustness)
**Blocks:** none
**Estimated session length:** medium (1 PR, ~half day)

## Why now
The current Phase D · D2 plan covers folder upload via
`webkitdirectory`, but a vendor batch often arrives as a `.zip` (the
Bearking case had 7 docx files inside a zip from Google Drive). The
agent also needs to:
1. Unpack zip server-side (or in-browser via `JSZip`)
2. Handle nested zips (Google Drive sometimes wraps)
3. Walk arbitrary folder structures (vendor1/series-a/img.jpg vs
   vendor1/img.jpg → still classify correctly)
4. Read docx / pdf / md / txt for descriptions
5. Surface "I'm not sure" cases to the operator instead of guessing

## Files to touch

### Studio dashboard (`apps/dashboard/src`)

- `app/products/agentic/_client.tsx` (extends D2)
  - Accept `.zip` files in the dropzone. On drop, unpack client-side
    via `JSZip` and treat the contents as a virtual folder tree
  - Handle nested zips up to 2 levels deep (Google Drive wraps)
  - For `.docx` / `.pdf` files, upload them as-is to the
    agentic-staging R2 prefix and send their paths to the classifier
- `lib/zip-unpacker.ts` (NEW) — wraps `JSZip` with the multi-level
  unwrap + size cap (100MB total per upload, error otherwise)

### Studio worker (`apps/mcp-server/src`)

- `lib/agentic-folder-classifier.ts` (from D2, extended)
  - Accept `docx`/`pdf` paths and pass to Sonnet for description
    extraction. Sonnet 4.6 reads docx/pdf natively via the Files API
  - Add `confidence` field to each manifest entry. Below 0.7 →
    flag for operator review with a reason ("file structure
    ambiguous", "no description found", "image-to-product mapping
    uncertain")
- `index.ts`
  - `POST /v1/products/agentic-plan` already accepts staged paths
    (per D2). Extend to accept the new file kinds: `docx`, `pdf`
  - New `POST /v1/products/agentic-plan/refine` accepting operator
    corrections (manual product-image assignments, manual rename)
    and re-running classification with the corrections as hints

## Acceptance criteria

- [ ] Mei drops `bearking-vendor-batch.zip` (containing 7 docx +
      raw images). The dashboard unpacks client-side, shows
      "Unpacked 27 detected products, classifying…"
- [ ] After ~10s, she sees the manifest table. Products with
      `confidence < 0.7` have a yellow ⚠ icon and a reason
      explaining the uncertainty
- [ ] She can manually assign an unrouted image to a product (drag
      onto the product row); the manifest re-validates without
      re-calling the LLM (operator overrides win)
- [ ] A nested zip (zip inside zip) unpacks correctly up to depth 2;
      depth 3+ shows an error: "Too deeply nested — please re-zip
      flattened"
- [ ] The classifier accepts `.docx` files and pulls
      `name + description + specs` from them. Bearking re-uploaded
      as zip produces the same 27 products as the manual python
      script did
- [ ] Total upload size capped at 100MB; clearer error message than
      the existing one

## Implementation notes

- JSZip is ~100KB bundle, fine. Sufficient for the v1 size cap
- Sonnet 4.6 + the Files API can ingest docx + pdf directly. No
  need for python extract step on the server
- The "confidence" surfacing is the key UX gain over D2. Operators
  trust the agent more when it admits uncertainty than when it
  silently guesses
- Multi-level zip unwrap: scan top-level entries, if any have
  `.zip` extension, recurse once and merge. Skip beyond depth 2 to
  prevent zip-bomb-style misuse
- The `agentic-plan/refine` endpoint takes the original manifest +
  operator corrections + the original staged paths and returns a new
  manifest. Don't re-classify from scratch — only fill in the
  ambiguous cells

## Out of scope (do NOT do this iteration)

- Server-side zip unpacking (we do it client-side for v1; if browser
  size cap bites, we can move it)
- Tar / rar / 7z support — zip only for v1; vendors send zip
- Automatic translation of CN-only docx → bilingual (chain pattern,
  but separate iteration)
- Real-time progress streaming during classification (Server-Sent
  Events) — for v1, show spinner with rough percentage
- Vendor-batch versioning ("this is v2 of the same batch, diff
  against v1") — overkill for v1
