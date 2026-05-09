# Phase C — Marketer-PM audit fixes

Tracking document for the 41-item audit (`phase-c/00-WORKFLOW.md` describes
the drafting process). Each row is one iteration = one PR = one session.

| # | Iteration | Audit items | Status | Priority | Est |
|---|---|---|---|---|---|
| 01 | [Claims-grounding LLM judge](phase-c/01-claims-grounding-judge.md) | #A | ✅ shipped | 🔴 critical (legal) | medium |
| 02 | [Marketplace selection + autopublish cleanup](phase-c/02-marketplace-selection.md) | #1, #2, #3, #4, #9, #20 | ✅ shipped | 🔴 critical (UX) | medium |
| 03 | [Tenant defaults in Settings](phase-c/03-tenant-defaults.md) | #18, #19 | drafted | 🟠 high | medium |
| 04 | [Add Product form fixes](phase-c/04-add-product-form.md) | #17b, #23, #24, #25, #34 | partial (#17b ✅) | 🟠 high | small |
| 05 | [Vocabulary sweep](phase-c/05-vocabulary-sweep.md) | #7, #8, #10–13, #14, #15, #17, #22, #40 | drafted | 🟠 high | small |
| 06 | [Inbox operator UX](phase-c/06-inbox-operator-ux.md) | #5, #6, #30, #36 | drafted | 🟡 medium | small |
| 07 | [Cost & wallet transparency](phase-c/07-cost-wallet-transparency.md) | #16, #29, #33, #39 | drafted | 🟡 medium | small |
| 08 | [Empty states & onboarding](phase-c/08-onboarding-empty-states.md) | #21, #26, #27, #28, #38 | drafted | 🟡 medium | small |
| 09 | [Product picker upgrade](phase-c/09-product-picker.md) | #31 | drafted | 🟢 polish | medium |
| 10 | [Polish & localization](phase-c/10-polish-localization.md) | #32, #35, #37 | drafted | 🟢 polish | small |

## Top-5 execution order (per the audit)

1. **#A** → Iteration 01 (claims-grounding judge)
2. **#1, #2, #4** → Iteration 02 (marketplace selection)
3. **#17b** → Iteration 04 (form fixes — description cap slice)
4. **#3, #20** → Iteration 02 (autopublish consolidation slice)
5. **#9** → Iteration 02 (dry-run default flip slice)

Iteration 02 covers items 2, 4, and 5 of the top-5; executing it
closes 6 of the 7 numbered items in the priority list.

## Done definition for the phase

Phase C closes when iterations 01–05 are shipped + verified end-to-end on
the BFR tenant. Iterations 06–10 are nice-to-have polish that can ship
asynchronously after Phase C "MVP done."
