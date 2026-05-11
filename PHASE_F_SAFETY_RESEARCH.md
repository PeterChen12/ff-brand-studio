# Phase F — Safe-refactor research

**Date:** 2026-05-11
**Purpose:** Before drafting the 8 Phase F iteration plans, identify
the smallest set of practices + tools that materially lower the risk
of refactoring the quality-gate pattern (R1) and the adapter pattern
(R5). Honest answer up front: **nothing external needs to be
registered.** Everything we need is already in the stack.

---

## What's actually risky about Phase F

The refactor risk is concentrated in **F1 (the quality-gate
abstraction)**. Two specific risk classes:

1. **Behavioral drift** — F1 migrates two existing inline loops
   (`pipeline/iterate.ts` image-refine, and the claims-grounding
   loop I added to `launch_pipeline.ts` in E5). Each loop has subtle
   semantics (cost-cap pre-flight, fall-back to "ship best with FAIR",
   reason-string formatting that feeds the next prompt). Bug-for-bug
   compatible refactoring is hard.

2. **Wrong API shape** — if the `runQualityGate<T>` signature is wrong
   for one of the four future consumers (E2.1, E5.B, E5.C, E5.D),
   we'll either contort the consumers or re-shape the lib mid-flight.
   Same risk class as designing an interface before you have the
   second concrete user.

F2 (BFR adapter completion) and the consumer iterations (F3–F6) are
lower-risk — they're additive features that don't change existing
behavior. F7 (sharp text overlay) and F8 (agentic walk) are entirely
independent.

---

## Current testing state (surveyed)

- Vitest is set up: 12 test files at `apps/mcp-server/test/**`
- Unit + integration split (`vitest.config.ts` + `vitest.integration.config.ts`)
- Coverage tool not installed
- **No existing tests cover the iterate loop or the claims-grounding
  loop** — the two inline implementations F1 will migrate
- Test style is minimal: short `describe` blocks asserting constants
  + shape stability (per the comment in `evaluator_optimizer.test.ts`)

This means **F1 must add tests as the first step**, before touching
the abstraction. Otherwise we're refactoring blind against the riskiest
parts of the codebase.

---

## Safe-refactor practices that apply here

### Pin #1 — Golden-master snapshot tests
Before extracting the quality-gate abstraction, capture the existing
inline-loop behavior with synthesized inputs:

- Mock the `judge` external call (Sonnet/Haiku) to return a scripted
  sequence of verdicts (e.g., "first call reject + reasons X, second
  call approve")
- Run the existing inline loop, capture: total iterations, final
  output reference, notes array, total cost
- Save as `toMatchSnapshot()` fixtures

After the refactor, the same scripted inputs must produce identical
snapshots. **This is the only safety net that catches behavioral
drift.** Adds ~50 lines of test code per loop site (2 sites = ~100
lines added before the refactor).

### Pin #2 — Branch-by-abstraction
Martin Fowler's pattern. Concretely:

- F1 introduces `lib/quality-gate.ts` as a NEW module — does not
  modify existing files
- F1 also adds a thin wrapper inside `iterate.ts` that delegates to
  the new lib, gated by an env var `USE_QUALITY_GATE_LIB` (default
  false, i.e. old path still runs)
- Snapshot tests run BOTH paths and assert identical output
- Once snapshots are green for ~24h of prod traffic with both paths
  computed (the new path computed but its result discarded), flip
  the env var to use the new path
- Old path stays as fallback for one deploy cycle
- Next iteration retires the old path

This is more disciplined than the standard "rewrite + cross fingers"
pattern and worth the extra cycle on a refactor that touches the
hottest production path.

### Pin #3 — Strict generic typing
The `T` in `runQualityGate<T>` does heavy lifting. Constrain it so:

- `T` defaults to `unknown` only if no fix function — non-fixable gates
- When `fix` is provided, `T` must be the input AND output of `fix`
- `judge` accepts `T` and returns `JudgeResult` with reasons strings

TypeScript's structural typing catches the wrong call sites at compile
time. We already typecheck both apps in CI; F1 must add no
`any`/`unknown` escape hatches.

### Pin #4 — One consumer at a time
F3 (the first consumer, E2.1) ships before F4–F6 to validate the API
shape. If E2.1 requires changes to the lib, those changes are cheap
(only one caller). After F3 lands clean, F4–F6 batch-adopt.

### Pin #5 — No behavior change in F1
F1 ships ONLY the abstraction + migrating the two existing inline
loops. Zero new features. Zero changes to the user-visible output.
Reviewers see snapshot tests pass and trust the refactor.

### Pin #6 — Coverage check before refactor
Run `vitest --coverage` (requires `@vitest/coverage-v8` — already a
peer dep of vitest, free). Confirm the iterate loop + claims-grounding
loop have coverage. If 0%, F1 starts with adding coverage.

---

## Tooling decisions

Each tool was considered. Honest verdict for each:

| Tool / library | Decision | Why |
|---|---|---|
| Vitest snapshot tests | ✅ **Use** | Already installed; the cleanest way to pin existing behavior |
| `@vitest/coverage-v8` | ✅ **Install** | Free peer dep of vitest; one-time signal of what's currently tested |
| Branch-by-abstraction + feature flag | ✅ **Use** | Discipline, not a tool. Already have env vars |
| `fast-check` (property-based testing) | 🔵 Skip | Overkill for this refactor. Worth knowing it exists if R1 surfaces a class of property bugs |
| Stryker mutation testing | 🔵 Skip | Heavy infrastructure for a single-developer pace |
| ts-morph / jscodeshift AST refactor | 🔵 Skip | The migration is 2 call sites by hand; AST tools cost more than they save |
| Anthropic / FAL / Cloudflare APIs | ✅ Already integrated | F1 adds zero new external dependencies |
| Cloudflare Workers Logpush | 🟡 **Consider** for dual-path comparison | If we run old+new in parallel, Logpush captures discrepancies to R2. Optional |
| GitHub Actions matrix testing | 🟡 Already set up | CI runs typecheck + tests on every push. Just keep it running |

**Nothing requires registration.** Everything is in the existing stack
or is a free dev dep.

---

## What "ship safely" looks like for F1

Concrete steps F1's iteration plan should mandate:

1. **Before touching code:**
   - Run `vitest --coverage` once and record baseline coverage % for
     `iterate.ts` + the claims-grounding block of `launch_pipeline.ts`
   - If <50% coverage on those code paths, F1 adds tests first

2. **Add golden-master tests** for both existing loops (mock the
   external judges; assert iterations, final output ref, notes, cost
   on representative inputs)

3. **Extract the abstraction** in a new file `lib/quality-gate.ts`
   with strict generic typing

4. **Migrate `pipeline/iterate.ts`** to delegate to the abstraction
   (behind an env-var-gated wrapper so the old path remains the default)

5. **Migrate the claims-grounding loop** the same way

6. **Run snapshot tests against both paths** — old vs new must produce
   identical output for the scripted inputs

7. **Ship behind env var off** — the new code is present but inactive

8. **Wait one deploy cycle** (~24h of real traffic if possible) before
   flipping the env var on

9. **Retire old path** in a follow-up iteration once the new path has
   been default for one deploy cycle

This is more cycles than a normal feature ship, but R1 is the
foundation 4 future iterations build on — getting it wrong cascades.

---

## What "ship safely" looks like for F2 (BFR adapter completion)

F2 has a different risk profile — it's coordinating across two repos
(ff-brand-studio + buyfishingrod-admin). Safety practices:

1. **Ship the BFR-side receiver endpoint FIRST**, behind an HMAC check.
   Keep it dormant — no caller yet
2. **Ship the studio-side adapter implementation** second. Behind an
   env-var-gated feature flag
3. **Migrate E2's Stage button to use the new adapter** as F2's
   final commit — only after both sides are green
4. **Old bulk-approve path stays available** as fallback for one
   deploy cycle (same expand-contract as F1)

The "ship receiver first, dormant, then caller second" pattern is
standard for cross-service contracts (Stripe, GitHub do this).

---

## Risk assessment per Phase F iteration

| # | Iteration | Risk class | Mitigation |
|---|---|---|---|
| F1 | Quality-gate abstraction | 🔴 High — touches hot paths | Pins #1–#6 all apply |
| F2 | BFR adapter completion | 🟠 Medium — cross-service | Ship receiver first, expand-contract |
| F3 | E2.1 best-of-input | 🟡 Low — additive | Standard unit tests, gated by feature flag |
| F4 | E5.B defect router | 🟡 Low — additive | Same |
| F5 | E5.C chained specs | 🟡 Low — additive | Same |
| F6 | E5.D multi-judge | 🟠 Medium — affects regulated tenants only | Gated by tenant.features.regulated_category flag |
| F7 | E4.1 sharp overlay | 🟠 Medium — bundle size + fonts | Lazy-import; ship behind feature flag |
| F8 | E6.1 agentic walk | 🟡 Low — new endpoint, no existing path to break | Standard unit tests |

---

## Conclusions for plan drafting

When I draft `phase-f/01-..` through `phase-f/08-..`, each plan will:

1. **Have an explicit "Safety practices" section** citing the pins
   above that apply
2. **Specify the test fixtures to add BEFORE the code change** for
   refactor-class iterations (F1, F2)
3. **Mandate env-var gating** for both refactor-class and risky
   feature iterations (F1, F2, F7)
4. **Include a "Rollback plan"** section describing how to revert if
   the iteration causes regressions
5. **Have a "Done = X" criterion** that includes snapshot/integration
   test pass, not just typecheck

Nothing in this list requires user action. Drafting the plans next.
