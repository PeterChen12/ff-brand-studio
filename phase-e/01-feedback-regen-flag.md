# Phase E · Iteration 01 — Enable feedback_regen for enterprise tenants

**Problem:** #1 (403 on `/v1/assets/:id/regenerate` for BFR)
**Depends on:** none
**Blocks:** none
**Estimated session length:** small (~15 min)

## Why now
The BFR client (`support@buyfishingrod.com`) clicks Regenerate on a
generated asset and gets `403 feature_disabled` because the endpoint
gates on `tenant.features.feedback_regen === true` and the BFR tenant
was provisioned without that flag. This is a 1-line database update
+ a provisioner amendment so the BFR client can iterate on imperfect
images today. Same gap applies to any other enterprise tenant we
provision in the future.

## Root cause (confirmed)

`apps/mcp-server/src/index.ts:2364`:
```
if (features.feedback_regen !== true) {
  return c.json({ error: "feature_disabled", feature: "feedback_regen" }, 403);
}
```

BFR's provisioned `tenant.features`:
```
production_pipeline: true,
default_platforms: ["amazon", "shopify"],
amazon_a_plus_grid: true,
rate_limit_per_min: 240,
publish_destinations: ["buyfishingrod-admin"],
```

No `feedback_regen` key.

## Files to touch

- `apps/mcp-server/scripts/provision-bfr-client.mjs` — add
  `feedback_regen: true` to the `FEATURES` const so re-running the
  provisioner sets the flag (idempotent; on conflict the `DO UPDATE`
  branch refreshes features)
- (one-off) `apps/mcp-server/scripts/fix-bfr-feedback-regen.mjs` —
  small script that updates the BFR tenant row in place:
  `UPDATE tenants SET features = features || '{"feedback_regen": true}'::jsonb WHERE id = '32b1f9d2-...';`
- Also consider: when any tenant has `plan = 'enterprise'`, the
  enterprise-tier defaults should include `feedback_regen: true`.
  Centralize this somewhere — either at provision time or via a
  view/derived field on `/v1/me/state`. Pick provision-time for v1

## Acceptance criteria

- [ ] After the fix script runs, querying `tenants WHERE id =
      '32b1f9d2-...'` shows `features.feedback_regen = true`
- [ ] BFR client clicks Regenerate on an asset, the request succeeds
      (200 with new R2 URL), wallet ledger debits the regen fee
- [ ] Re-running `provision-bfr-client.mjs` on a fresh tenant
      produces `feedback_regen: true` in the row's features

## Implementation notes

- The jsonb concat operator `||` merges keys with right-side priority,
  so the script is idempotent — re-running doesn't break anything
- Pre-existing tenants on enterprise plan that DON'T have the flag
  should also be backfilled. For now only BFR is affected
- Don't change the gating logic in `index.ts` — flag-gated regenerate
  is correct for non-enterprise tenants (regen costs $0.30/each and
  could be abused without a quota gate)

## Out of scope (do NOT do this iteration)

- Removing the feature flag entirely — the gate is correct, BFR just
  needs the flag set
- Adding a UI for tenants to self-grant features
- Changing the per-regen pricing
- Touching the regen cap logic (already wired via `checkRegenCap`)
