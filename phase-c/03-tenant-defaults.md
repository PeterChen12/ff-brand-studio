# Phase C · Iteration 03 — Tenant defaults in Settings

**Audit items closed:** #18, #19
**Depends on:** Iteration 02 (clean wizard state shape)
**Blocks:** none
**Estimated session length:** medium (1 PR, ~half day)

## Why now
Output language (English / 中文 / Both) and quality preset
(budget/balanced/premium) are per-launch radios in the wizard, but
marketers pick once and never change. They belong as tenant defaults
in Settings, with an optional per-launch override via a small "Tweak
this run" disclosure. This iteration moves them to Settings → Brand
profile and reads the defaults in the wizard.

## Files to touch

- `apps/mcp-server/src/db/schema.ts` — extend `tenants.features`
  jsonb to canonically include `default_output_langs: ("en"|"zh")[]`
  and `default_quality_preset: "budget"|"balanced"|"premium"`. No
  schema migration needed (jsonb), but document the keys in a comment
- `apps/mcp-server/src/index.ts` — `/v1/me/state` already returns
  `tenant.features` — verify the new keys flow through
- `apps/mcp-server/src/index.ts` — new endpoint `PATCH
  /v1/tenants/me/preferences` accepting `{ default_output_langs?,
  default_quality_preset? }` for a logged-in operator with
  `org:admin` role
- (rename) `apps/dashboard/src/components/settings/tenant-panel.tsx`
  → `brand-profile-panel.tsx` (rename in `_client.tsx` tab list too)
- `apps/dashboard/src/components/settings/brand-profile-panel.tsx` —
  new "Defaults" section with the two preference editors. Saves on
  blur via the new PATCH endpoint
- `apps/dashboard/src/components/launch-wizard.tsx` — read defaults
  from `useTenant()` on mount; drop the in-wizard radios behind a
  `<details>` "Tweak this run" disclosure (closed by default)
- `apps/dashboard/src/lib/tenant-context.tsx` — surface the two new
  default fields on the `TenantSnapshot` type

## Acceptance criteria

- [ ] Mei visits Settings → Brand profile. She sees "Listing language"
      with three options (English / 中文 / Both) and "Quality preset"
      with three options (budget/balanced/premium). She picks once,
      blurs, and the value persists across reload
- [ ] Mei opens the wizard. The output language and quality preset
      she set in Settings are pre-selected. The wizard doesn't show
      the per-launch radios by default — there's a "Tweak this run"
      collapsed disclosure that, when opened, reveals them
- [ ] Changing the wizard override does NOT persist back to the
      tenant defaults — it's per-launch only
- [ ] The Settings tab is renamed "Brand profile · 品牌资料" (was
      "Tenant · 租户配置")

## Implementation notes

- Don't migrate existing tenant.features keys — additive only. If a
  tenant has no `default_output_langs`, fall back to `["en"]`. If no
  `default_quality_preset`, fall back to `"balanced"`
- The PATCH endpoint must be tenant-admin gated (existing
  `requireTenant + role:admin` middleware). A non-admin operator
  hitting it should get 403
- Wizard reads tenant defaults on first render via the
  `TenantProvider` already in `shell.tsx`. No new fetch needed.
- The `<details>` disclosure in the wizard should remember its
  open/closed state per session in `sessionStorage` so a power user
  who always tweaks doesn't have to re-open it on every navigation

## Out of scope (do NOT do this iteration)

- Per-marketplace spec customization (still tenant-level, deferred)
- Brand color / logo upload (real "Brand profile" content, defer)
- Wizard step indicator / numbered breadcrumb — iteration 08
- Migrating existing tenants' implicit defaults — accept the fallbacks
- Localizing the Settings tab labels beyond the bilingual subtitle
