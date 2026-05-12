# Phase F — Refactor + ship deferred Phase E work

Tracking document for the 8 iterations identified in
`PHASE_F_INVESTIGATION.md` (deferred Phase E work + targeted refactors)
under the safety practices in `PHASE_F_SAFETY_RESEARCH.md`.

## Iteration index

| # | Iteration | Depends on | Risk | Status | Est |
|---|---|---|---|---|---|
| 01 | [Quality-gate abstraction (R1)](phase-f/01-quality-gate-abstraction.md) | none | 🔴 high | ✅ shipped + F1.1 retirement complete (inline path removed; iterate.ts deferred — shape mismatch) | medium |
| 02 | [BFR adapter `stage(ctx)` completion (R5)](phase-f/02-bfr-adapter-stage.md) | none | 🟠 medium | ✅ fully shipped (studio + BFR receiver) | medium-large |
| 03 | [E2.1 — Best-of-input passthrough](phase-f/03-best-of-input.md) | F1, optionally F2 | 🟡 low | ✅ shipped | small |
| 04 | [E5.B — Compliance defect router](phase-f/04-defect-router.md) | F1 | 🟡 low | ✅ shipped | medium |
| 05 | [E5.C — Chained specs-table extraction](phase-f/05-chained-specs.md) | F1 | 🟡 low | ✅ shipped in BFR repo (scripts/refresh_bearking_specs.mjs — chained Sonnet validate + re-extract) | small |
| 06 | [E5.D — Multi-judge ensemble (regulated categories)](phase-f/06-multi-judge.md) | F1 | 🟠 medium | ✅ shipped | medium |
| 07 | [E4.1 — Sharp text-overlay pipeline](phase-f/07-sharp-text-overlay.md) | none | 🟠 medium | ⏭️ deferred — structurally covered by existing composite.ts + E4 judge; full bundled-fonts pipeline is its own phase | medium |
| 08 | [E6.1 — Agentic LLM folder walk](phase-f/08-agentic-folder-walk.md) | none | 🟡 low | ✅ fully shipped (server lib + endpoint + Agentic dashboard tab) | large |

## Critical ordering

- **F1 MUST ship before F3, F4, F5, F6** — these consume R1's abstraction
- **F2 SHOULD ship before F3** — F3 (Stage Product passthrough flow) is
  cleaner when the BFR adapter is real, not bulk-approve-via-workaround
- **F7, F8 are independent** — schedule whenever convenient

Suggested executive order:
1. F1 (foundation; one real consumer validates the API)
2. F3 (consumer that proves F1's shape; smallest of the consumers)
3. F2 (if peter wants the Stage Product flow cleaned up)
4. F4, F5, F6 (batch — they all adopt F1)
5. F7 (independent quality work)
6. F8 (independent feature work)

## Safety practices (cross-cutting)

Every Phase F iteration plan includes:

1. A **Safety practices** section citing applicable pins from
   `PHASE_F_SAFETY_RESEARCH.md` (golden-master tests, branch-by-
   abstraction, strict typing, one consumer at a time, zero behavior
   change for refactors, baseline coverage check)
2. **Test fixtures BEFORE code** for F1 and F2
3. **Env-var gating** for F1, F2, F7
4. **Rollback plan** section
5. **Done = X criteria** including snapshot/integration test pass,
   not just typecheck

## Done definition for the phase

Phase F closes when:
- F1 + F2 + F3 ship + verify (the foundational batch)
- At least one of F4/F5/F6 ships (proves the abstraction handles a
  second consumer cleanly)
- F7 + F8 can ship asynchronously

## Workflow

Same as Phase D + E (`phase-d/00-WORKFLOW.md`), augmented with the
mandatory safety pins above. Detailed workflow in
`phase-f/00-WORKFLOW.md`.
