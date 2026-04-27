# Phase J — Library SaaS Features (detailed plan)

> Detailed plan for Phase J of the SaaS iteration. Depends on Phase G
> (auth + tenancy) and Phase H (self-serve upload + wallet) being
> shipped. See `plans/saas-iteration-plan.md` for the broader sequence.

**Goal of Phase J**

Turn `/library` from a flat thumbnail grid into a real Digital Asset
Manager that an agency-side operator can comfortably live inside for
hours. Preview, zoom, download (singly + bulk), search, and audit any
asset in ≤2 clicks.

The bar to clear: a marketing manager who joined an agency last month
should be able to find the Amazon main image for SKU "FF-DEMO-ROD-12FT",
copy the public URL, and hand it to their seller-central uploader —
without asking anyone for help.

---

## Iteration J1 — Lightbox + hover-zoom magnifier

**Outcome:** every asset tile in `/library` opens a full-resolution
lightbox carousel; hovering shows a 250% magnifier overlay so operators
can spot detail flaws without leaving the grid.

### J1.1 — Library lightbox

**Files / new files:**
- `apps/dashboard/package.json` — add `yet-another-react-lightbox@^4`
- `apps/dashboard/src/components/library/asset-lightbox.tsx`
- `apps/dashboard/src/app/library/_client.tsx` — wire click to open

**Resources:**
- [`yet-another-react-lightbox`](https://yet-another-react-lightbox.com/)
  + `/plugins/zoom` (MIT, ~12kB total). React-19-compatible, controlled
  open state, slot-aware navigation.

**Subtasks:**
1. AssetLightbox accepts `slides: Slide[]`, `index`, `onClose`. Renders
   YARL with the Zoom plugin enabled, native dimensions read from
   `platform_assets.width / height`.
2. Click on a tile → set `lightboxOpen=true, lightboxIndex=i`. Esc /
   backdrop closes.
3. Keyboard: arrows navigate slots within the same SKU, `+/-` zoom,
   `Esc` close.

### J1.2 — Hover-zoom magnifier

**Files:** `apps/dashboard/src/components/library/zoom-tile.tsx`

**Subtasks:**
1. ZoomTile renders an `<img>` plus a hover-overlay div whose
   `backgroundImage` is the same R2 URL at `backgroundSize: '250%'`.
2. `onMouseMove` updates `backgroundPosition` so the cursor maps to a
   zoomed pixel (formula: `((cursorX / w) * 100)% ((cursorY / h) * 100)%`).
3. Touch devices skip the magnifier and fall straight through to the
   lightbox click handler.

### J1.3 — Acceptance for J1

- Click any tile → full-screen carousel at native R2 resolution.
- Hover any tile (mouse) → 250% magnifier follows cursor without
  stuttering at 60fps.
- Lightbox carousel groups assets within the same SKU.

---

## Iteration J2 — Per-asset + bulk download

**Outcome:** operators can download individual assets or a whole SKU's
delivery bundle (ZIP with CSV manifest) in one click.

### J2.1 — Per-asset download

**Files:** `apps/dashboard/src/components/library/asset-actions.tsx`

**Subtasks:**
1. Each tile + lightbox slide gets a download button that sets
   `download` attribute on an anchor pointing to the public R2 URL.
2. Filename: `<sku>-<platform>-<slot>.<ext>`.

### J2.2 — Bulk SKU download

**Files:**
- `apps/dashboard/package.json` — add `jszip@^3`, `file-saver@^2`
- `apps/dashboard/src/lib/zip-bundler.ts`

**Subtasks:**
1. SKU group header gets "Download bundle" button.
2. Bundler fetches every R2 URL (via apiFetch for the auth header),
   adds to JSZip as `<sku>/<platform>-<slot>.<ext>`, writes a top-level
   `manifest.csv` with columns: sku, platform, slot, filename, width,
   height, rating, model_used, cost_cents, generated_at.
3. Triggers `saveAs(blob, '<sku>-bundle.zip')`.

### J2.3 — Acceptance for J2

- Single download writes correctly-named file to disk.
- Bundle ZIP for a 12-asset SKU is <50MB; opens in any unzipper.
- manifest.csv parses cleanly in Excel / Google Sheets.

---

## Iteration J3 — Search + filter + tenant audit log surface

**Outcome:** library is searchable across SKU, platform, slot, status,
date range. Audit tab surfaces the underlying `audit_events` for the
operator's tenant.

### J3.1 — Search bar + URL-state filters

**Files:**
- `apps/dashboard/src/app/library/_client.tsx` — useSearchParams driven
  filter state
- `apps/dashboard/src/components/library/filter-bar.tsx`

**Subtasks:**
1. Top filter bar: full-text search box (debounced 200ms), platform
   chips (amazon / shopify / all), slot dropdown, status filter, date
   range presets ("today", "last 7d", "last 30d", "all time").
2. Filter state lives in the URL so links are shareable.
3. Client-side filtering for now (≤500 assets per tenant in MVP); when
   we cross 5K, push to a `GET /v1/assets?q=...` endpoint with full
   server-side search.

### J3.2 — Audit tab on `/library`

**Files:**
- `apps/dashboard/src/app/library/_client.tsx` — add tabs `Assets` /
  `Audit log`
- `apps/mcp-server/src/index.ts` — `GET /v1/audit` paginated, tenant-scoped

**Subtasks:**
1. Audit tab renders the most recent 100 audit_events with a "show 100
   more" pagination button.
2. Filter by action (multi-select), by date range, by actor.
3. Each row is expandable to show the metadata jsonb pretty-printed.

### J3.3 — Acceptance for J3

- Searching "rod" shows only matching SKUs in <100ms.
- Audit tab matches the actual `audit_events` for the tenant when
  cross-checked via SQL.

---

## Iteration J4 — Performance polish + virtual scroll

**Outcome:** library renders 500+ assets without jank. Initial paint
under 200ms after `/v1/assets` resolves.

### J4.1 — Virtual scroll on the grid

**Files:**
- `apps/dashboard/package.json` — add `@tanstack/react-virtual@^3`
- `apps/dashboard/src/components/library/virtual-grid.tsx`

**Subtasks:**
1. Virtualize the asset grid; only render tiles in viewport + 1 row of
   buffer.
2. Image lazy-load via `loading="lazy"` plus an Intersection Observer
   to upgrade thumbnails to higher-res when scrolled into view.

### J4.2 — Image variant URLs

**Files:** `apps/mcp-server/src/index.ts` — `/api/assets` adds
`thumb_url` (250×250 wasm-resized via Workers AI image-resize binding,
or via Cloudflare Image Resizing).

**Subtasks:**
1. Switch tile backgrounds to use `thumb_url`; lightbox/zoom uses full.
2. Cache control: `Cache-Control: public, max-age=86400, immutable`.

### J4.3 — Acceptance for J4

- 500-asset library scrolls at 60fps on a 2019 MacBook Pro.
- First contentful paint after `/v1/assets` resolves: ≤200ms.

---

## Cross-cutting Phase J concerns

### Storage costs

Bulk-zip generation happens client-side, so no Worker CPU. R2 egress
is free for the first 10TB/mo (CF policy as of 2026) — well within
agency-scale usage.

### Mobile considerations

- Hover magnifier disabled on touch (replaced by pinch-to-zoom inside
  the lightbox).
- Filter bar collapses to a sheet on <md breakpoint.
- Bundle download too heavy for mobile — gate behind a "you're on
  mobile, this might use 50MB of data" confirm step.

### Estimated effort

| Iteration | Engineer-days |
|---|---|
| J1 (lightbox + magnifier) | 2 |
| J2 (download + bulk) | 2 |
| J3 (search + audit) | 3 |
| J4 (virtual scroll + perf) | 2 |
| Buffer | 1 |
| **Total** | **~10 days** |

---

## Resolved questions (locked 2026-04-27)

1. **Bulk-download size cap.** Hard-cap the ZIP at 200MB; assets beyond
   that prompt to "download in batches" with a quick selector.
2. **Image variants.** Use Cloudflare Image Resizing (cf-image-binding)
   for thumbs. Avoids storing 2× copies in R2.
3. **Audit log retention.** Keep all rows forever (audit_events are
   tiny — ~150 bytes/row × 100 rows/tenant/day = 5MB/tenant/year).
   Pruning revisited at Phase M.
4. **Search backend.** Client-side until tenants exceed 1K assets.
   Then bump to Postgres trigram + GIN index, no separate search
   service.

---

## Deliverables checklist

When Phase J is done:

- [ ] `yet-another-react-lightbox` integrated; click-tile-to-zoom works
- [ ] Hover magnifier visible on mouse devices, off on touch
- [ ] Per-asset download button writes correctly-named file
- [ ] Bulk SKU bundle = ZIP + manifest.csv, opens cleanly in Finder/
      Explorer
- [ ] Filter bar (search + platform + slot + status + date) controls
      URL state
- [ ] `/library` has an Audit log tab backed by `GET /v1/audit`
- [ ] Library grid virtualized; 500 assets scroll smoothly
- [ ] Image thumbs served via CF Image Resizing
- [ ] `SESSION_STATE.md` updated with library SaaS surface

When all are checked, the platform looks like a real DAM, not a debug
inspector. Phase K (edit + publish) builds on top.
