# Phase C · Iteration 02 — Marketplace selection becomes real

**Audit items closed:** #1, #2, #3, #4, #9, #20
**Depends on:** none
**Blocks:** Iteration 03 (tenant defaults reads from this iteration's
shape)
**Estimated session length:** medium (1 PR, ~half day)

## Why now
The wizard's marketplace and image-spec chips look selectable but are
display-only — `platforms` is hardcoded `["amazon", "shopify"]`. A
Shopify-only seller pays for Amazon image generation she'll never use.
Plus the locked "Auto-publish · Enterprise" card interrupts every launch
with a Calendly upsell that already lives in Settings. And the `dryRun`
toggle defaults ON — first-time users get no images and don't know why.
This iteration makes the wizard honest: real toggles, no duplicate
upsells, full-run as the default.

## Files to touch

- `apps/dashboard/src/components/launch-wizard.tsx`
  - Replace `platforms = useMemo(() => ["amazon", "shopify"], [])` with
    state: `const [platforms, setPlatforms] = useState<("amazon"|"shopify")[]>(["amazon","shopify"])`
  - Replace info-only chips at line 459–469 with real toggle pills
    (same visual, but `aria-pressed` + `onClick` toggles selection,
    requires ≥1 selected)
  - Show subtitle on each pill: `Amazon US · 7 image specs` /
    `Shopify DTC · 5 image specs`. Specs themselves remain display-only
    (those are tenant config, iteration 03 surfaces a Settings page
    for them)
  - **Delete** the entire "🔒 Auto-publish · Enterprise" block
    (lines 510–544). Replace with a single tiny line under the
    marketplace toggles: `Auto-publish to Seller Central / Shopify
    Admin is enterprise — set up in Settings · Channels →`
  - Flip `useState(true)` → `useState(false)` for `dryRun` (line 173)
  - Rename Toggle props: `offLabel="Preview only · free"` /
    `onLabel="Generate images · charges wallet"` (drop "FAL pipeline"
    string entirely)
- `apps/dashboard/src/components/settings/channels-panel.tsx`
  - This is now the single home for the Calendly entry
  - No code changes needed unless the wizard's removed copy needs to
    move here (it shouldn't — channels-panel already covers it)

## Acceptance criteria

- [ ] Mei opens the wizard and sees Amazon + Shopify toggle pills,
      both ON by default. She clicks Amazon → it deselects (Shopify
      stays). Cost preview drops by the Amazon image subtotal
- [ ] Trying to deselect both fires a soft warning and refuses
      ("at least one marketplace required") — no console error
- [ ] No "🔒 Auto-publish" lock cards in the wizard. The wizard has a
      single one-line link to Settings → Channels
- [ ] `dryRun` defaults OFF. Toggle reads "Generate images · charges
      wallet" / "Preview only · free" — no "FAL pipeline" anywhere
- [ ] Cost preview math is correct under all three combinations
      (amazon-only / shopify-only / both)
- [ ] `POST /v1/launches/preview` and `/v1/launches` send the actual
      `platforms` array — no hardcoded fallback in the request body

## Implementation notes

- The wizard's existing `fetchPreview` already takes `platforms` from
  state — no worker-side changes needed because the worker already
  reads `platforms` from the request body. Just stop hardcoding the
  array on the client.
- Keep `surfaces` derivation tied to `platforms × outputLangs` (the
  existing useMemo logic at line 159–166) — surfaces auto-shrink
  when a marketplace is dropped
- For the deselect-both refusal, simplest UX: greyed-out pill that
  resists click + tooltip "at least one required" rather than
  modal/toast
- Don't refactor the `<Toggle>` component — just rename the labels
  passed in
- The "Auto-publish · enterprise" inline link should NOT use the
  CALENDLY_URL constant directly — it should link to
  `/settings?tab=channels` so the user lands on the consolidated
  enterprise CTA

## Out of scope (do NOT do this iteration)

- Per-marketplace spec customization ("I want only Amazon main + 2
  lifestyle") — that's a tenant-level preference, iteration 03
- Replacing the wizard's three-card layout with a stepper — defer
  to iteration 08
- Renaming "Launch SKU" → "Create listing" in nav — that's iteration
  05's job
- Showing the wallet balance inline next to each pill — iteration 07
- Touching the `outputLangs` radio (still in wizard for now) —
  iteration 03 moves it to Settings
