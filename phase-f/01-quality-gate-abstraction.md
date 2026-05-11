# Phase F · Iteration 01 — Quality-gate abstraction (R1)

**Refactor target:** extract the "produce → judge → fix → re-judge"
pattern that's hand-rolled in `pipeline/iterate.ts` and the claims-
grounding loop in `orchestrator/launch_pipeline.ts`
**Depends on:** none
**Blocks:** F3, F4, F5, F6 (all consume the new abstraction)
**Risk:** 🔴 high — touches two hot paths with zero existing coverage
**Estimated session length:** medium (1 PR, ~half day, careful)

## Why now
The pattern is currently hand-rolled in 2 production sites + about to
be hand-rolled in 4 deferred iterations (E2.1, E5.B, E5.C, E5.D).
Extracting once nets ~300 lines saved across existing + future call
sites and gives future iterations a 3-line "call runQualityGate"
shape instead of inventing a fresh loop.

## Files to touch

- (new) `apps/mcp-server/src/lib/quality-gate.ts` — the abstraction.
  ~120 lines. Strict generic typing
- (new) `apps/mcp-server/test/lib/quality-gate.test.ts` — unit tests
  for the lib itself (independent of the migrations)
- (new) `apps/mcp-server/test/pipeline/iterate-snapshot.test.ts` —
  golden-master test for the existing `pipeline/iterate.ts` loop with
  mocked judge calls. Must pass BOTH before and after migration
- (new) `apps/mcp-server/test/orchestrator/grounding-snapshot.test.ts`
  — golden-master test for the claims-grounding loop in
  `launch_pipeline.ts`
- `apps/mcp-server/src/pipeline/iterate.ts` — migrate to delegate via
  the new lib, gated by env var `USE_QUALITY_GATE_LIB` (default
  `false`; old path is the default)
- `apps/mcp-server/src/orchestrator/launch_pipeline.ts` — same
  migration for the grounding+rewrite loop
- `apps/mcp-server/src/pipeline/scene-library.ts` + `pipeline/prompt-
  variation.ts` — dedup `hashSeed` into `lib/hash-seed.ts` (R7 freebie)

## Proposed `quality-gate.ts` shape

```typescript
export interface JudgeResult {
  pass: boolean;
  reasons: string[];
  cost_cents: number;
  metadata?: Record<string, unknown>;
}

export interface QualityGateInput<T> {
  initial: T;
  judge: (current: T, attempt: number) => Promise<JudgeResult>;
  fix?: (current: T, reasons: string[]) => Promise<T | null>;
  maxAttempts?: number; // default 1 fix attempt
  budget_cents?: number; // halt if next call exceeds
}

export interface QualityGateResult<T> {
  final: T;
  passed: boolean;
  attempts: number;
  history: Array<{ attempt: number; judge: JudgeResult; fixed: T | null }>;
  total_cost_cents: number;
}

export async function runQualityGate<T>(
  input: QualityGateInput<T>
): Promise<QualityGateResult<T>>;
```

## Acceptance criteria

- [ ] `lib/quality-gate.ts` exists with the exact signature above;
      zero `any`/`unknown` escape hatches
- [ ] `test/lib/quality-gate.test.ts` covers: pass-on-first-try,
      pass-after-fix, fail-after-max-attempts, budget-halt-mid-loop,
      fix-returning-null-handled
- [ ] `test/pipeline/iterate-snapshot.test.ts` captures the existing
      iterate loop's behavior with scripted judge responses (5+
      scenarios). Snapshots are committed
- [ ] After `iterate.ts` migration: same snapshot tests pass with
      `USE_QUALITY_GATE_LIB=true` AND `false`
- [ ] `test/orchestrator/grounding-snapshot.test.ts` captures the
      claims-grounding loop's behavior (5+ scenarios). Snapshots
      committed
- [ ] After `launch_pipeline.ts` migration: same snapshot tests pass
      with `USE_QUALITY_GATE_LIB=true` AND `false`
- [ ] `vitest --coverage` for the modified functions shows ≥80%
      coverage (was 0% before this iteration)
- [ ] Worker typechecks clean
- [ ] `pnpm test` passes all suites

## Safety practices (per `PHASE_F_SAFETY_RESEARCH.md`)

- **Pin #1 — Golden-master snapshot tests**: APPLIES. Tests MUST be
  the first commit of the PR
- **Pin #2 — Branch-by-abstraction**: APPLIES. `USE_QUALITY_GATE_LIB`
  env var defaults `false`; new path runs only when flipped
- **Pin #3 — Strict generic typing**: APPLIES. `T` parameterized,
  no escape hatches
- **Pin #4 — One consumer at a time**: APPLIES. F3 (E2.1) is the
  first new consumer; ships AFTER F1 has been default-on for one
  deploy cycle
- **Pin #5 — Zero behavior change**: APPLIES. F1 ships ONLY the
  abstraction + delegating migration. No new features. Reviewers
  verify by seeing snapshot tests pass
- **Pin #6 — Coverage baseline**: APPLIES. Run `vitest --coverage`
  on `iterate.ts` + `claims-grounding`-block-of-`launch_pipeline.ts`
  BEFORE the migration. Record baseline in PR description

## Implementation notes

- Golden-master tests mock the external Anthropic/FAL calls via
  `vi.mock(...)`. The judge function becomes a scripted sequence
  returning hardcoded verdicts
- The env-var gate is a single `if` at the top of each migrated
  loop. When off, the OLD inline code runs; when on, delegates to
  `runQualityGate`. Both paths must produce byte-identical outputs
  for the same inputs — that's what the snapshot tests assert
- For the claims-grounding migration: the auto-rewrite chain becomes
  the `fix` callback; the regrade becomes the next `judge` call.
  `maxAttempts: 1` matches current behavior
- For the iterate migration: each iteration is a single `judge` +
  `fix` cycle; `maxAttempts: 2` matches the current 3-iter cap (1
  initial + 2 fixes)
- Cost accumulation moves into `runQualityGate` itself; callers
  read `result.total_cost_cents` instead of accumulating inline
- `notes[]` strings are built from `result.history` at the caller —
  the lib doesn't know about audit notes, callers do

## Rollback plan

If anything breaks in production:

1. Set `USE_QUALITY_GATE_LIB=false` via wrangler secret put on the
   worker. Takes effect within 30s. Old path resumes
2. If the new path silently produced wrong outputs (snapshot tests
   missed something), revert the migration commit but keep the
   abstraction. Snapshot tests get strengthened, retry next iteration
3. If the abstraction itself is wrong (e.g., generic type wrong for
   a deferred consumer), keep both paths active and ship F3's plan
   adjustment as a separate iteration

## Out of scope (do NOT do this iteration)

- Migrating any additional callers beyond `iterate.ts` and the
  claims-grounding loop — F3-F6 are the planned consumers, each in
  its own iteration
- Adding new features (the abstraction is JUST extraction; no new
  capabilities)
- Touching the dual_judge.ts or claims-grounding.ts internals —
  those stay as the judge implementations the abstraction calls
- Removing the old inline code paths — they stay behind the env var
  for one deploy cycle; retiring is a follow-up
