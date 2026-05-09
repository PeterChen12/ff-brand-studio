# Phase D — Throughput, cost, and BEARKING audit fixes

Tracking document for the 4 problem areas peter raised on 2026-05-09:
1. Slow image pipeline → batch/queue UX
2. Folder-level agentic bulk upload
3. Per-launch cost ($6.20 today) feels steep — find savings
4. BEARKING upload audit (`buyfishingrod-admin/docs/BEARKING_UPLOAD_AUDIT.md`)
   covering 5 categories + 28 sub-items

Iterations are sized to the Phase C rule (≤200 lines, one PR, one
session, self-contained). `phase-d/00-WORKFLOW.md` explains the
sequential execution process.

## Iteration index

| # | Iteration | Problem # | Status | Priority | Est |
|---|---|---|---|---|---|
| 01 | [Async client-side launch queue](phase-d/01-async-launch-queue.md) | 1 | drafted | 🔴 critical (UX) | medium |
| 02 | [Agentic folder upload](phase-d/02-agentic-folder-upload.md) | 2 | drafted | 🟠 high | large |
| 03 | [Cost reduction strategies](phase-d/03-cost-reduction.md) | 3 | drafted | 🟠 high (revenue) | medium |
| 04 | [Bearking admin polish](phase-d/04-bearking-admin-polish.md) | 4 | drafted | 🟡 medium | small |
| 05 | [Bearking data quality](phase-d/05-bearking-data-quality.md) | 4 | drafted | 🟡 medium | medium |
| 06 | [FF Studio multi-reference best-fill](phase-d/06-pipeline-multi-reference.md) | 4 | drafted | 🔴 critical (silently-bad outputs) | medium |
| 07 | [FF Studio stub-workers decision](phase-d/07-pipeline-stub-workers.md) | 4 | drafted | 🔴 critical (silently-bad outputs) | large |
| 08 | [FF Studio input-quality fail-fast](phase-d/08-pipeline-input-quality.md) | 4 | drafted | 🟠 high (cost waste) | small |
| 09 | [FF Studio pipeline polish (#4–10)](phase-d/09-pipeline-polish.md) | 4 | drafted | 🟢 polish | medium |
| 10 | [Infrastructure decision (S3 vs storefront redeploy)](phase-d/10-infrastructure-decision.md) | 4 | drafted | 🟡 architecture (no code) | medium |

## Suggested execution order

The order follows the user's stated problem priority (1→2→3→4) with a
re-shuffle inside problem 4 that pulls the silently-bad-output fixes
(06–08) ahead of the polish items, since those gate trust in every
future BFR vendor batch.

1. **D1** (async queue) — biggest daily friction; unblocks Mei's flow
2. **D6** (multi-reference) — silently-bad outputs is the worst class of bug
3. **D8** (input-quality fail-fast) — prevents wasting wallet on bad inputs
4. **D3** (cost reduction) — addresses the $6.20/launch concern
5. **D2** (agentic folder upload) — efficiency for vendor batches
6. **D4** (admin polish) — operator confusion fixes
7. **D5** (data quality) — catalog hygiene
8. **D7** (stub-workers decision) — architecture call, may be bigger than one PR
9. **D9** (pipeline polish) — performance + reliability
10. **D10** (infrastructure) — strategic decision, mostly architecture writeup

## Done definition for the phase

Phase D closes when iterations 01, 03, 04, 06, 08 ship + verify on prod.
The remaining iterations (02, 05, 07, 09, 10) can ship asynchronously.
