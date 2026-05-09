# Phase C · Iteration 04 — Add Product form fixes

**Audit items closed:** #17b, #23, #24, #25, #34
**Depends on:** none
**Blocks:** none
**Estimated session length:** small (1 PR, ~hour)

## Why now
The Add Product form has a 2000-character description cap that fights
its own advice ("the richer the input, the sharper the SEO copy"). Real
spec sheets are 5–10K chars. The placeholder uses a `·` separator that
implies pasting both Chinese AND English. The $0.50 fee is footer-
buried. Bulk upload is a tiny text link. And there's no save-draft —
a wifi blip kills 8 reference uploads.

## Files to touch

- `apps/dashboard/src/app/products/new/_client.tsx`
  - `maxLength={2000}` → `maxLength={10000}` on the description
    textarea (line 302). Counter updates to `/10,000`
  - Bilingual placeholder (line 277): split into two lines or use
    "or" / "或" between alternatives so it reads as **alternatives**
    not **paste-both**: `渔王 Apex 12英尺海钓鱼竿  或  CastMaster
    Apex 12ft Surf Rod`
  - Move the $0.50 fee chip out of `<CardFooter>` and into a sibling
    of the submit button: `Add product · $0.50 →` (matches the
    Launch button's price-inline pattern)
  - Make bulk upload a **first-class tab** above the form: `[Single
    product] [Bulk upload]` — selected state controlled by a query
    param (`?mode=single|bulk`); default `single`. Existing
    `/products/bulk` page becomes the second tab's content
  - Persist the form state (`name`, `description`, `files[]`'s
    metadata only — not blob data) to `sessionStorage` on every
    change. On mount, restore. Clear after successful submit
- `apps/mcp-server/src/index.ts`
  - Locate the Zod schema for `POST /v1/products` (line ~1900–2200
    range, has `description` field). Update `description.max(2000)`
    → `.max(10000)`. Same for `/v1/products/ingest`

## Acceptance criteria

- [ ] Mei pastes a 4500-character supplier spec into the description
      field. It accepts the full text. Counter shows `4500 / 10,000`,
      not red. Submit succeeds
- [ ] Pasting >10,000 chars truncates with a visible toast warning,
      not silent truncation
- [ ] $0.50 fee is on the same row as the "Add product →" button,
      not in the footer. Reads `Add product · $0.50 →`
- [ ] On `/products/new`, two tabs are visible: `Single product`
      (selected) and `Bulk upload`. Switching tabs updates the URL
      and shows the alternative form
- [ ] Reloading mid-form preserves typed name and description (file
      blobs are NOT persisted — that's an explicit limitation)
- [ ] Server-side Zod accepts a 10K description without 400'ing

## Implementation notes

- File blob persistence to `sessionStorage` is impossible (size
  cap + non-serializable). Persist only `{ name, description }` and
  warn on the file dropzone empty state: "Drag images again — your
  text was saved"
- The placeholder change is cosmetic but high-leverage. Make sure the
  visual still works in narrow widths (the long bilingual string can
  push out the `<input>`); consider letting it wrap visually with
  `whitespace-pre-line` on the placeholder, but most browsers don't
  honor that — fallback to using just the English example with a
  note "or in Chinese"
- Bulk upload as a tab requires a small client-side route bridge
  since `/products/bulk` is its own page. Easiest: keep
  `/products/new` as the tabbed wrapper, embed the existing
  `<BulkUploadInner>` from `/products/bulk/_client.tsx`. Or, simpler:
  make the tabs purely link-based — `/products/new` and
  `/products/bulk` each render their full page, and both pages show
  the same tab strip at the top
- Counter text: `count.toLocaleString()` for the 10,000 to render
  as `10,000` not `10000`

## Out of scope (do NOT do this iteration)

- Auto-save the file uploads themselves (multipart resume) — too
  invasive for a form-fixes batch
- Description-driven category/kind suggestion preview — defer
- Upload-from-URL (paste a CDN link instead of dropping) — defer
- Image compression preview — defer
