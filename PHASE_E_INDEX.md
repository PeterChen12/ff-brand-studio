# Phase E — Pipeline quality + stage-product workflow

Tracking document for the 8 problems peter raised on 2026-05-11:

1. 403 on `/v1/assets/:id/regenerate` for the BFR tenant
2. "Stage Product" one-click button missing for enterprise tenants
3. Outdoor products rendering on coffee tables (wrong lifestyle scene)
4. Audit other places where chaining / routing / parallelization help
5. Duplicate images across lifestyle slots (no variation seeding)
6. Bulk upload not robust enough (zip support + true agentic walk)
7. Line artifacts in text generated inside images
8. Best-of-input filter — skip generation when an input is already publish-ready

Six plan files consolidate issues that share surface area:

| # | Iteration | Issues | Status | Priority | Est |
|---|---|---|---|---|---|
| 01 | [Enable feedback_regen for enterprise tenants](phase-e/01-feedback-regen-flag.md) | #1 | ✅ shipped | 🔴 critical (blocker) | small |
| 02 | [Stage Product workflow + best-of-input filter](phase-e/02-stage-product-best-of-input.md) | #2, #8 | drafted | 🟠 high | medium |
| 03 | [Context-aware backgrounds + variation seeding](phase-e/03-backgrounds-variation.md) | #3, #5 | ✅ shipped | 🟠 high (quality) | medium |
| 04 | [Sharp-based text overlay (kill diffusion text artifacts)](phase-e/04-text-overlay-sharp.md) | #7 | drafted | 🟠 high (quality) | medium |
| 05 | [Chaining / routing / parallel quality audit + targeted fixes](phase-e/05-chaining-routing-audit.md) | #4 + cross-cutting | drafted | 🟡 medium (quality) | medium |
| 06 | [Bulk upload zip + agentic folder walk](phase-e/06-bulk-upload-zip-agent.md) | #6 | drafted | 🟡 medium | medium |

## Suggested execution order

1. **E1** (feedback_regen flag) — 5-min fix unblocks the BFR client right now
2. **E3** (backgrounds + variation) — quality wins that any vendor batch will visibly benefit from
3. **E4** (text overlay) — eliminates the most embarrassing failure mode (garbled text in images)
4. **E2** (stage product + best-of-input) — closes the one-click loop the BFR client wants
5. **E5** (chaining/routing audit) — cross-cutting improvements that compound with E3/E4
6. **E6** (bulk upload zip/agentic) — extends Phase D's D2 work

## Done definition for the phase

Phase E closes when iterations 01–04 ship + verify on prod. The remaining
iterations (05–06) can ship asynchronously.

## Workflow

Same as Phase D — see `phase-d/00-WORKFLOW.md`. Read index → confirm
deps → read iteration file → implement → typecheck → commit → deploy →
smoke-test → memory update → ask peter for next.
