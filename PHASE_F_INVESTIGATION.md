# Phase F Investigation — Refactors that compound across deferred work

**Date:** 2026-05-11
**Purpose:** Before executing the 6 deferred items from Phase E, identify
code-organization patterns that, if extracted once, shrink every future
iteration's diff. Then re-rank the deferred work in light of the refactors.

---

## Executive summary

One specific refactor (the **Quality-Gate-with-Auto-Fix abstraction**, R1
below) is the dominant lever: it directly simplifies 4 of the 6 deferred
items. Two more refactors (R4 already-shipped audit + R5 adapter
completion) clean up smaller surface areas. R2 and R3 are nice-to-haves
that don't change iteration cost much.

Recommended sequencing if Phase F runs:
- **F1** — extract R1 (one focused refactor, no behavior change)
- **F2** — R5 partial: stage(ctx) method on the BFR adapter so E2's
  Stage-Product button can call it directly instead of piggybacking on
  bulk-approve
- **F3** — then E2.1, E5.B, E5.C, E5.D using R1
- **F4** — E6.1 and E4.1 are independent, schedule anytime

---

## 1. Deferred work survey

Six items deferred during Phase E execution:

| ID | Origin | Current shape | What it actually needs |
|---|---|---|---|
| E2.1 | E2 best-of-input | Check if reference scores publish-ready; if yes, write the original R2 URL as the asset and skip generation. ~$0.50 savings per launch. | **Iterative quality gate** at the head of the pipeline: produce score → judge against threshold → if pass, passthrough; if fail, fall through to generation. |
| E5.B | E5 audit | Compliance defect router. Today image QA reasons all route to the same generic regenerate. Specialist fixers per defect type (bg_not_white → bg-correction, text_in_image → strip-text, cropped → tighter framing). | **Routing + iterative quality gate**: dispatch by defect type, run specialist, re-judge, fall back to generic. |
| E5.C | E5 audit | Specs extraction lost rows on some Bearking series (audit issue 3.3). Single-pass extract. | **Iterative quality gate**: extract → validate (Sonnet: "are all source rows captured?") → if no, re-extract with missing rows named. |
| E5.D | E5 audit | Multi-judge ensemble for regulated categories (medical, supplements, electrical claims). | **Iterative quality gate with consensus combinator**: judge1 + judge2 → if disagree, force HITL. |
| E6.1 | E6 plan | Full agentic LLM walk: Sonnet reads docx/pdf, classifies loose images, surfaces confidence-flagged rows. | Independent — server-side endpoint + dashboard UI. Doesn't fit the quality-gate pattern. |
| E4.1 | E4 plan | Full sharp text-overlay pipeline (generate clean base → OCR check → sharp composite real-font text). | Independent — bundled fonts, sharp SVG overlay, slot templates. Doesn't fit the quality-gate pattern. |

**Pattern that dominates:** 4 of 6 items (E2.1, E5.B, E5.C, E5.D) are
structurally identical: *produce candidate output → judge it → if it
fails, attempt a targeted fix → re-judge → accept or escalate*.

We already have this loop implemented inline in **3 different places**
in the codebase:
- `pipeline/iterate.ts` — image refine loop (3 iter cap, dual_judge,
  prompt amendment with rejection reasons)
- `orchestrator/launch_pipeline.ts` — claims-grounding loop with auto-
  rewrite (1 rewrite cap, regrade, fall back to HITL) — added in E5
- `pipeline/derive.ts` — implicit (CLIP triage → re-derive)

Each was hand-rolled. Each future deferred item will be hand-rolled
unless the pattern is extracted.

---

## 2. Refactor opportunities ranked by leverage

### R1 — Quality-Gate-with-Auto-Fix abstraction
**Status:** highest-leverage refactor.

Proposed shape:
```typescript
// apps/mcp-server/src/lib/quality-gate.ts
export interface JudgeResult {
  pass: boolean;
  reasons: string[];
  cost_cents: number;
  metadata?: Record<string, unknown>;
}

export interface QualityGateInput<T> {
  initial: T;
  judge: (current: T, attempt: number) => Promise<JudgeResult>;
  fix?: (current: T, judge_reasons: string[]) => Promise<T | null>;
  maxAttempts?: number; // default 1 fix attempt
  budget_cents?: number; // halt if next call exceeds
  on_attempt?: (attempt: number, judge: JudgeResult, fixed: T | null) => void;
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

**Why this shape:**
- `T` is whatever produces output (image R2 URL, listing copy, specs
  array). Type-parameterized so each caller stays type-safe.
- `judge` returns reasons that the `fix` function can use as input —
  matches the existing iterate.ts pattern where dual_judge reasons feed
  back into the regen prompt.
- `fix` is optional — gates that have no auto-fix (just retry or
  escalate to HITL) pass undefined.
- `maxAttempts` defaults to 1 because most patterns we use cap retries
  at 1 to bound cost; existing iterate.ts uses 3.
- `history` is what we audit-log today via `notes[]` strings.

**Migration impact (callers that should adopt it):**
- `pipeline/iterate.ts` — replace ~80 lines of inline loop. ~40 lines
  saved.
- `orchestrator/launch_pipeline.ts` — replace ~50 lines of grounding
  + auto-rewrite that I added in E5. ~30 lines saved.
- E2.1, E5.B, E5.C, E5.D — each adopts the abstraction at first
  implementation. Estimated 30-50 lines saved per deferred item =
  120-200 lines NOT written.

**Net code change:** ~+150 line abstraction, ~-300 lines across
existing + future call sites = **net negative**. And future iterations
get to read 3-line "call runQualityGate with these handlers" instead
of inventing a fresh loop.

### R5 — Complete the marketplace adapter pattern (BFR slice)
**Status:** unblocks E2.1 and makes Stage Product semantically correct.

Today `integrations/buyfishingrod-admin.ts` is a stub that throws
`notImplemented`. E2 worked around it by using bulk-approve + the
asset.approved webhook fan-out — functionally correct but couples
"stage a product" to the per-asset event model.

A real `stage(ctx)` method would:
- Take a product-level envelope (product + all assets + listing copy)
- POST to BFR's new `/api/integrations/ff-brand-studio/stage-product`
  endpoint (which doesn't exist yet — needs BFR-side companion)
- Return a single PublishResult instead of N webhook fan-outs

**Migration impact:**
- E2 today: dashboard → bulk-approve → N webhook deliveries → N BFR
  handler invocations → N DB writes (one per asset)
- After R5: dashboard → Stage endpoint → 1 webhook delivery → 1 BFR
  handler invocation → 1 transactional DB write (atomic)
- Same outcome, fewer moving parts, easier to debug, easier to extend
  for Amazon SP-API + Shopify Admin

**Honest caveat:** R5 requires a BFR-side endpoint addition, which
means coordination with the other agent on the BFR repo. Phase D
showed that works; just needs to be explicit.

### R4 — Wallet service (already done)
`lib/wallet.ts` already exports `chargeWallet`, `creditWallet`,
`getBalanceCents`, `reconcileTenant`. The phase-c/d/e additions I
shipped that touched wallet (claims-grounding cost accumulation,
auto-rewrite cost) used inline `seoCostCents += result.costCents`
accumulators that the orchestrator later turned into a single wallet
write at run completion. That's fine — the wallet abstraction is
already centralized at the persistence boundary; the per-step
accumulators are computation-only.

No refactor needed.

### R2 — Typed tenant features schema
Tenant features bag is read by 9 different files and the dashboard's
`TenantFeatures` interface drifts from the worker's view. Single
typed source of truth would prevent drift.

**Migration impact:** small — fixes a class of latent bugs (typo on
a flag name silently disables a feature), but doesn't shrink any
deferred iteration's diff.

**Honest assessment:** good hygiene, low urgency. Defer until a
feature-flag typo bites us.

### R3 — Endpoint boilerplate reducer
42 endpoints in `index.ts`, ~74 lines each on average. Each follows
the requireTenant + Zod parse + handler + optional audit pattern.

**Migration impact:** speculative — the boilerplate is mostly
unavoidable (Zod schema, business logic, response shape). A declarative
helper would save maybe 5-10 lines per endpoint but adds an
abstraction layer that hides what's happening.

**Honest assessment:** would-be cleanup, not a leverage point. Defer.

### R6 — Pipeline step state machine
Pipeline steps have ad-hoc return shapes. A formal state machine
would clarify the orchestrator, but **none** of the deferred items
add new pipeline steps. Pure code-art refactor.

**Honest assessment:** skip until we're actually adding steps.

### R7 — Deterministic-seed helper
`hashSeed` is duplicated in `scene-library.ts` and `prompt-variation.ts`
(both from my E3). Two identical 8-line djb2 hash functions.

**Migration impact:** 1 file added, 2 places dedup'd. Tiny.

**Honest assessment:** fold into the R1 commit as a freebie. Not its
own iteration.

---

## 3. Refactor → deferred-work matrix

|  | E2.1 best-of-input | E5.B defect router | E5.C specs chained extract | E5.D multi-judge | E6.1 agentic walk | E4.1 sharp overlay |
|---|---|---|---|---|---|---|
| **R1 quality-gate** | ✓ direct | ✓ direct | ✓ direct | ✓ direct | — | — |
| **R5 adapter completion** | ✓ via clean Stage flow | — | — | — | — | — |
| R2 typed features | — | — | — | — | — | — |
| R3 endpoint helper | — | — | — | — | (would help — new endpoints) | — |
| R7 hash util | — | — | — | — | — | — |

**Read:** R1 lights up 4 of 6 cells; nothing else lights up more than 1.
The case for shipping R1 first is overwhelming.

---

## 4. Proposed Phase F structure

If you want me to draft the actual iteration plan files, this is the
shape I'd propose:

| # | Iteration | Status this doc | Est |
|---|---|---|---|
| F1 | **R1 — Quality-gate abstraction + migrate iterate.ts + grounding loop** | (sketched here) | medium (1 PR, ~half day) |
| F2 | **R5 partial — BFR adapter `stage(ctx)` + BFR-side endpoint** | (sketched here) | medium-large (coordinated PR) |
| F3 | E2.1 best-of-input passthrough — uses R1 | (drafted earlier in E2 plan) | small |
| F4 | E5.B compliance defect router — uses R1 | (drafted in E5 plan) | medium |
| F5 | E5.C chained specs extraction — uses R1 | (drafted in E5 plan) | small |
| F6 | E5.D multi-judge ensemble — uses R1 + consensus combinator | (drafted in E5 plan) | medium |
| F7 | E4.1 sharp text-overlay pipeline | (drafted in E4 plan) | medium |
| F8 | E6.1 agentic LLM folder walk | (drafted in E6 plan) | large |

**Critical ordering:** F1 must ship before F3/F4/F5/F6. F2 should
ship before F3 if R5 is in scope. F7/F8 are independent.

**Skipped from this proposal:** R2 (typed features), R3 (endpoint
helper), R6 (state machine) — not worth a dedicated iteration. R4
(wallet) — already done. R7 (hash util) — fold into F1's commit.

---

## 5. Recommended next action

One of three paths:

1. **Ship F1 now** (just the quality-gate refactor, no behavior
   change, no new features). Then later iterations adopt the
   abstraction as they land. Lowest-risk path.

2. **Ship F1 + F3** as one batch. Refactor + first concrete consumer.
   Validates the abstraction shape; if it feels wrong, only 1 caller
   to revert.

3. **Draft all 8 F-iteration files first** (following the established
   "investigate → plan → execute" cadence), then execute on signal.
   Highest planning surface but lets you decide ordering before any
   code runs.

My recommendation: **#2 (F1 + F3)**. The risk of designing the wrong
abstraction is mitigated by having one real caller force the API to
prove its value. F4/F5/F6 then adopt cleanly. The other deferred items
can wait.

Let me know which path you want and I'll execute.
