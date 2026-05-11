# Phase F — Workflow (augmented with safety practices)

Same execution flow as Phase D + E, with three additional steps
mandated by `PHASE_F_SAFETY_RESEARCH.md`:

## Per-iteration safety checklist (before merging)

1. **Read the safety practices** section of the iteration file. If
   the iteration claims pin #1 (golden-master tests), the test fixtures
   MUST be the first commit of the PR — before any production code
   changes
2. **Run `vitest --coverage`** on the file(s) about to be modified.
   Record baseline % in the PR description. If <50% on modified
   functions, add unit tests before the refactor
3. **For refactor-class iterations (F1, F2)**: ship behind an env var.
   The new code path is present but inactive for one deploy cycle.
   Only flip the env var on after one cycle of clean production traffic
4. **For feature-class iterations with risk (F6, F7)**: ship behind a
   tenant feature flag so only opted-in tenants see the new behavior
5. **Run BOTH typecheck AND test suite** before commit. Typecheck-only
   green is not sufficient for Phase F. (Phases A-E were typecheck-only;
   F is different)
6. **Update the rollback section** in the iteration file with the
   actual commit hash of the change once shipped, so re-running the
   plan or rolling back doesn't require git archaeology

## Drafting cadence

Same as previous phases — one iteration plan per file, ≤200 lines,
self-contained. The plans were drafted in one session (this one),
but execution remains one-at-a-time per peter's preference.

## Execution cadence

For F1 specifically (the highest-risk iteration):
- Day 1: ship the new lib + tests + behind-env-var migration
- Day 2: smoke test in prod with env var off (new code present, old
  path active)
- Day 3: flip env var on for BFR tenant only via PATCH
  /v1/tenants/me/preferences (no global change)
- Day 4: monitor; if clean, flip globally
- Day 5: retire old path in a follow-up iteration

For F2: ship BFR-side receiver endpoint first (dormant), then studio-
side caller second, then flip the Stage Product button to use the
new path.

For F3–F6: standard one-day iterations after F1 is on globally.

## When to PAUSE and ask

- F1's golden-master tests catch a discrepancy after migration. Stop
  and report the diff before continuing
- Any iteration's `vitest --coverage` baseline drops on changed files.
  Stop and add coverage first
- Cross-repo coordination needed in F2 — confirm with peter before
  shipping the BFR-side endpoint, since another agent owns that repo
- E2.1 best-of-input materially changes wallet semantics (passthrough
  = $0 charge). Confirm wallet ledger semantics with peter before
  shipping F3

## What NOT to do

- Don't ship F1 without the golden-master tests. The whole safety
  posture rests on them
- Don't batch F4 + F5 + F6 into one commit even though they all use
  the same abstraction. One per commit so a regression points at one
  consumer not three
- Don't introduce new external dependencies during F1. The whole
  refactor is structurally simple; npm packages add review surface
  without benefit
- Don't skip the env-var gating for F7 (text overlay) — the font
  bundle adds 3MB+ to the worker bundle; gate it on so we can roll
  back if Cloudflare's bundle-size limit becomes an issue
