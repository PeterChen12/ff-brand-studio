# Phase F · Iteration 03 — Best-of-input passthrough (E2.1)

**Closes:** E2 audit item #8 — when an input reference image is
already publish-ready, write it as the asset directly and skip
generation
**Depends on:** F1 (uses the quality-gate abstraction)
**Blocks:** none
**Risk:** 🟡 low — additive feature, env-var gated
**Estimated session length:** small (1 PR, ~hour)

## Why now
F1 ships the abstraction. F3 is the first consumer that proves the
API shape is right. Best-of-input passthrough is the simplest of the
four planned consumers (E2.1, E5.B, E5.C, E5.D) because it has only
two outcomes (passthrough or fall-through-to-generation), so it's
the safest first validation of F1's design.

Cost impact: ~$0.50 savings per launch on clean inputs (no white-bg
generation needed because the input already is one).

## Files to touch (all in `apps/mcp-server/src`)

- (new) `lib/best-of-input.ts` — exports
  `isPublishReadyReference(metrics) → boolean` and
  `passthroughAllowedForSlot(slot) → boolean`. The publish-ready
  threshold: `fill ∈ [0.60, 0.75] && whiteness ≥ 0.95 && longestSide ≥ 2000`
- `pipeline/index.ts` — before the refine_studio step, run a
  quality-gate (from F1's lib) with:
  - `judge`: scores the picked reference against the threshold
  - `fix`: undefined (no fix — it's pass or fall through)
  - `maxAttempts`: 1
  - If passed, write the reference R2 URL into `outputs.refine_studio`
    with `costCents: 0` + audit note "passthrough_publish_ready"
  - If failed, the normal refine_studio path runs
- `lib/image_post.ts` — extend `measureProductFill` to also return
  cornerWhiteness + dimensions in one pass (avoid two sharp reads)
- (new) `test/lib/best-of-input.test.ts` — unit tests for the
  threshold logic + the passthrough slot allowlist

## Quality-gate plumbing (proves F1's shape)

```typescript
const passthroughGate = await runQualityGate({
  initial: pickedReferenceMetrics,
  judge: async (m) => ({
    pass: isPublishReadyReference(m),
    reasons: m.fill < 0.60 ? ["fill too low"]
            : m.fill > 0.75 ? ["fill too high"]
            : m.whiteness < 0.95 ? ["background not pure white"]
            : m.longestSide < 2000 ? ["resolution too low"]
            : [],
    cost_cents: 0,
  }),
  maxAttempts: 1, // no fix, just judge once
});
if (passthroughGate.passed) {
  // skip generation, write reference URL as the asset
}
```

## Acceptance criteria

- [ ] A launch with a reference scoring fill=0.65, whiteness=0.98,
      longestSide=3000 writes a passthrough asset with `costCents: 0`
      and `model_used: 'passthrough_original'`. Library renders it
      identically to a generated asset
- [ ] A launch with a reference scoring fill=0.85 (too high, product
      too tight) falls through to normal generation. No passthrough
      row written
- [ ] Cost preview in the launch wizard shows the passthrough savings
      line: "Passthrough saved $0.50 — input was publish-ready"
- [ ] Passthrough threshold tuning is one-line constant change in
      `lib/best-of-input.ts` — no architecture changes to retune
- [ ] Audit log contains a `passthrough_publish_ready` note per
      passthrough event so we can monitor the rate over time
- [ ] Feature gated by `tenant.features.passthrough_enabled` (defaults
      true after F3 ships; on for BFR tenant from day one)

## Safety practices

- **Pin #4 — One consumer at a time**: APPLIES — F3 is the first
  consumer of F1's abstraction. If anything feels wrong about
  `runQualityGate`'s shape, F3 surfaces it; F4-F6 don't ship until
  F3 is clean
- **Tenant feature flag**: APPLIES — `passthrough_enabled` defaults
  true after this iteration ships, but can be turned off per tenant
  if a tenant reports issues
- **Audit logging**: APPLIES — every passthrough event gets a
  distinct note so we can rate-monitor and detect threshold drift

## Implementation notes

- The judge function is synchronous in spirit but typed as Promise
  to match F1's contract — wrap the sync check in `async`
- "Passthrough" is observable: it shows up in the library with
  `model_used: 'passthrough_original'`, which downstream filtering /
  cost reporting can recognize
- Threshold values are tunable post-ship. Start conservative
  (0.60–0.75 fill is narrower than "anything centered"); expand if
  false-negatives are reported
- The lifestyle slot does NOT passthrough — lifestyle by definition
  is generated. Only refine_studio (the white-bg main shot) is
  eligible; the `passthroughAllowedForSlot` helper enforces this

## Rollback plan

If passthroughs are producing visibly worse outputs than generations:
1. Set `tenant.features.passthrough_enabled = false` per affected
   tenant via PATCH `/v1/tenants/me/preferences`
2. If the issue is systemic, change the threshold in `best-of-input.ts`
   to make it stricter (e.g. require `fill ≥ 0.70`)
3. Last resort: revert the F3 commit; F1's abstraction remains.
   Future F4-F6 don't depend on F3

## Out of scope (do NOT do this iteration)

- Multi-reference scoring (already in D6's plan; defer)
- Passthrough for lifestyle / variant slots (won't ship — those need
  generation by definition)
- Operator-tunable threshold via tenant prefs UI (start as constant)
- Per-tenant threshold overrides — global constant for v1
