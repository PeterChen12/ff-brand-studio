# Phase C · Iteration 10 — Polish & localization

**Audit items closed:** #32, #35, #37
**Depends on:** Iteration 05 (vocab sweep)
**Blocks:** none
**Estimated session length:** small (1 PR, ~hour)

## Why now
A few residual marketer-friendly touches that don't fit other batches:
the iteration-cap wall reads as a forced upsell instead of a real
limit, the manifest.csv reference confuses non-technical sellers, and
the always-bilingual nav labels are visual noise for single-language
tenants.

## Files to touch

- `apps/dashboard/src/components/launch-wizard.tsx`
  - Tweak panel cap-reached state (lines 1060–1068): replace
    "Schedule a call for further refinement →" with a clearer
    explanation: "You've reached 5 free regenerations on this image
    to keep costs predictable. Need more iterations? Schedule a
    call to discuss your needs." Keep the Calendly link but as a
    secondary action, not the only path
- `apps/dashboard/src/components/settings/channels-panel.tsx`
  - Local-export step 2 (lines 188–195): replace `manifest.csv`
    technical reference with marketer-friendly explanation:
    "The ZIP includes a spreadsheet (`upload-checklist.csv`) that
    lists every image with its target slot — Amazon hero image,
    Shopify lifestyle, etc. — so you (or a VA) know which file
    goes where without guessing"
- `apps/dashboard/src/components/layout/shell.tsx`
  - Add a tenant preference `language_display: "en"|"zh"|"both"`
    (default `both`). When `en`, hide the `_zh` subtitles in NAV;
    when `zh`, hide the English label. When `both`, current
    behavior (no change)
  - Read from `useTenant()` features map; falls back to `both`
- `apps/dashboard/src/components/settings/brand-profile-panel.tsx`
  - Add a "Display language" preference editor (radio:
    English / 中文 / Both). Saves to tenant.features via the
    PATCH endpoint from iteration 03

## Acceptance criteria

- [ ] Hitting the 5-iteration cap on tweak panel shows a
      paragraph explaining WHY the cap exists, not just an upsell
      button. The Calendly link is still present but framed as
      one option among many
- [ ] Channels panel local-export step 2 reads in marketer
      language. No bare `manifest.csv` reference
- [ ] In Settings → Brand profile, "Display language" preference
      shows. Setting it to "English" hides `_zh` subtitles in
      the sidebar. Setting to "中文" hides English. "Both" is
      the default
- [ ] No `_zh` subtitles visible in nav for an `en`-only tenant

## Implementation notes

- The display-language preference reuses the iter 03 PATCH
  endpoint — just adds one more key to the features payload
- The nav label conditional is a small render-time `if` in the
  NAV map; don't refactor the NAV array shape
- The `language_display` default is `both` for backwards compat —
  no migration needed

## Out of scope (do NOT do this iteration)

- A real i18n framework (react-intl / next-intl) — string
  table approach is fine for v1
- Per-page language override — global tenant setting only
- RTL layout support — N/A for en/zh
- Translating long-form copy (homepage description, settings
  blurbs) when tenant is `zh` — too much for one batch; show
  English with the `_zh` subtitles for now
