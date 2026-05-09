# Phase C · Iteration 05 — Vocabulary sweep

**Audit items closed:** #7, #8, #10, #11, #12, #13, #14, #15, #17, #22, #40
**Depends on:** none (but iter 02–04 should ship first to avoid merge
churn since this rewrites strings in those same files)
**Blocks:** none
**Estimated session length:** small (1 PR, ~hour)

## Why now
The dashboard leaks engineering language end to end: SKU, HITL, dry
run, FAL pipeline, surfaces, compliance bands, tenant, vendor names
(Sonnet, Flux, GPT Image 2, DataForSEO, Kling, Opus). A 1-year
marketing PM bounces off these and feels out of her depth. This is
mostly find-and-replace + a couple of tab renames — high leverage,
zero technical risk.

## Vocabulary mapping (do all of these)

| Where (engineering term) | Replace with (marketer term) |
| --- | --- |
| "Launch SKU" / "Launch a SKU" (nav, page titles, CTAs) | "Create listing" / "New listing" |
| "HITL", "HITL holds", "hitl_blocked" (badges) | "Needs review" / "Pending approval" |
| "Dry run" / "FAL pipeline" (wizard toggle) | "Preview only" / "Generate images" (already in iter 02 — verify it landed) |
| "Compliance bands" (homepage card) | "Quality grades" |
| Vendor names: "Sonnet, Flux, GPT Image 2, DataForSEO, Kling" (homepage) | "AI services" or omit entirely; describe by *what* not *who* |
| "Optional Opus 4.7 vision pass" (homepage card footer) | "AI quality double-check" |
| Quality preset model names "nano-banana-pro · gpt-image-2 · flux-kontext-pro" (wizard) | Drop the model line; keep label + hint |
| "Tenant · 租户配置" (Settings tab) | (handled in iter 03 → "Brand profile") |
| "API keys" / "Webhooks" (Settings tabs visible to all) | Move behind an `[Advanced]` tab toggle, hidden unless tenant has a `developer_mode` feature flag |
| Status badge raw enums: `succeeded`, `cost_capped`, `hitl_blocked` | "Done", "Hit budget cap", "Needs review" |
| "Wallet · 余额" (sidebar pill) | "Credits · 余额" — pill stays clickable |
| `v0.2.0 · live` (homepage card footer) | Remove |
| "surfaces" (cost breakdown line) | "listings" — handled in iter 07 |

## Files to touch

- `apps/dashboard/src/components/layout/shell.tsx` — NAV array
  labels (`/launch` row); Wallet pill label
- `apps/dashboard/src/app/_overview-client.tsx` — homepage card
  copy (compliance bands → quality grades; vendor name strip)
- `apps/dashboard/src/components/launch-wizard.tsx` — quality preset
  labels (drop model names from the visible chip; keep them in code
  for routing); status pill in ResultPanel
- `apps/dashboard/src/app/inbox/_client.tsx` — page header,
  badge labels (`hitl_blocked` → "Needs review"); raw status
  enums everywhere
- `apps/dashboard/src/app/library/_client.tsx` — any status badges
  showing raw enum strings
- `apps/dashboard/src/app/settings/_client.tsx` — Settings tabs:
  hide `api-keys` and `webhooks` tabs unless `tenant.features.developer_mode === true`. Both still render via direct URL
  (`?tab=api-keys`) for power users
- (small util) `apps/dashboard/src/lib/format.ts` — add
  `friendlyStatus(s: string): string` mapping `succeeded → "Done"`,
  `hitl_blocked → "Needs review"`, etc. Use everywhere status pills
  render

## Acceptance criteria

- [ ] Sidebar nav shows "Create listing · 新建产品" instead of
      "Launch SKU · 上线产品" (index 03)
- [ ] Homepage no longer mentions Sonnet, Flux, GPT Image 2,
      DataForSEO, Kling, or Opus by name
- [ ] Inbox page header reads "Pending review" / "Needs review",
      not "HITL Review"
- [ ] All status badges render via `friendlyStatus()` helper —
      no `hitl_blocked` raw string visible in the UI
- [ ] Settings tabs default to `[Channels] [Brand profile]`
      visible. `[Advanced]` tab opens API keys / Webhooks. Direct
      URL `?tab=api-keys` still works
- [ ] Sidebar pill says "Credits", not "Wallet"
- [ ] Homepage card footer no longer shows `v0.2.0 · live`
- [ ] Search the codebase for `HITL` (case-insensitive) — only
      results are in code comments and var names, never in
      user-facing copy

## Implementation notes

- Don't rename the data model fields (still `hitl_blocked` in DB);
  only translate at the rendering boundary
- Keep `friendlyStatus()` exhaustive over the known enum values —
  unknown statuses fall back to title-case
- Tabs change requires `tenant?.features?.developer_mode` from the
  TenantSnapshot — wire if missing (small extension to context)

## Out of scope (do NOT do this iteration)

- Touching API endpoint paths (`/v1/launches` stays — it's a developer-
  facing URL, not a marketer one)
- Renaming database tables/columns (nothing changes for the worker)
- Translating `_zh` subtitles to a different vocabulary mapping —
  consult a Chinese-speaking reviewer for the CN side; this iteration
  ships English changes only and leaves `subtitle` strings alone
- Bilingual subtitle toggle on / off — that's iteration 10
