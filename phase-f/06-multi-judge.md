# Phase F · Iteration 06 — Multi-judge ensemble (E5.D)

**Closes:** E5 audit item D — multi-judge consensus for regulated-
category tenants (medical, supplements, electrical regulatory claims)
where single-judge false-negatives are unacceptable
**Depends on:** F1 (uses the quality-gate abstraction; uses the
"consensus combinator" pattern)
**Blocks:** none
**Risk:** 🟠 medium — adds a tenant-gated path; needs careful
threshold tuning
**Estimated session length:** medium (1 PR, ~half day)

## Why now
The Haiku-based claims-grounding judge from Phase C iter 01 is
acceptable for v1 across most tenants, but for tenants in regulated
categories one judge can miss subtle issues. Example: "supports
healthy joints" — a single judge might pass it; a more skeptical
judge would flag it for needing substantiation.

Multi-judge consensus + force-HITL on disagreement is the standard
mitigation for safety-critical text classification tasks.

## Files to touch (all in `apps/mcp-server/src`)

- `lib/claims-grounding.ts` — add a second `SKEPTICAL_JUDGE_SYSTEM_PROMPT`
  variant that uses more conservative reject criteria (any unsubstantiated
  health/safety/regulatory claim → REJECT). New helper:
  `checkClaimsGroundingDual(input) → DualGroundingResult` that runs
  both judges in parallel and returns:
  - `unanimous_pass` (both GROUNDED) → accept
  - `unanimous_fail` (both UNGROUNDED) → flag with combined reasons
  - `disagreement` (one passes, one rejects) → force HITL with reason
- `orchestrator/launch_pipeline.ts` — when the tenant has
  `tenant.features.regulated_category === true`, replace the
  single-judge call with `checkClaimsGroundingDual`. Auto-rewrite
  (E5 Opportunity A) still fires on the failure path but with the
  combined reasons from both judges
- (new) `test/lib/claims-grounding-dual.test.ts` — unit tests for
  the three outcome cases

## Acceptance criteria

- [ ] For a tenant WITHOUT `regulated_category`, behavior is
      identical to today (single Haiku judge)
- [ ] For a tenant WITH `regulated_category`, every grounding check
      runs both judges in parallel. Unanimous outcomes are accepted
      (pass or fail). Disagreement forces HITL regardless of which
      judge passed
- [ ] Disagreement count is logged per launch + per tenant so the
      operator can spot regions where the judges drift
- [ ] Cost per surface with multi-judge: ~$0.02 (was $0.01). Cost
      ledger reflects this
- [ ] Auto-rewrite from E5 still fires on `unanimous_fail` results
      using combined reasons from both judges

## Safety practices

- **Tenant feature flag**: APPLIES — `regulated_category` must be
  explicitly set on the tenant row; default off. No tenant gets
  the new behavior silently
- **Pin #5 — Compat-first**: APPLIES — non-regulated tenants see
  identical behavior. Only opted-in tenants get the multi-judge path
- **Audit logging**: APPLIES — every dual-judge invocation logs
  `multi_judge agreement=unanimous_pass|unanimous_fail|disagreement`
  so we can measure the false-disagreement rate

## Implementation notes

- The skeptical judge's system prompt is the same SHAPE as the
  permissive judge — both return `{ rating, ungrounded_claims,
  confidence }` JSON — but with stricter criteria. Example
  difference: where the permissive judge accepts "soft hand feel"
  as a reasonable inference from "100% cotton", the skeptical judge
  requires "soft hand feel" to be explicitly stated in the source
- Disagreement does NOT trigger auto-rewrite — disagreement means
  "I can't confidently auto-fix; needs a human." Forces HITL.
- The two judges run in parallel via `Promise.all` (same pattern as
  E5 Opportunity E). Wall-clock for the grounding stage stays
  identical to single-judge mode
- `tenant.features.regulated_category` is a boolean. Future
  granularity (e.g. `regulated_category: "medical" | "electrical"`)
  is a follow-up — start with the binary gate

## Rollback plan

If the skeptical judge produces too many false-positives (over-
flagging benign copy):
1. Set `regulated_category = false` for affected tenants
2. If the issue is the skeptical prompt itself, tune it in
   `claims-grounding.ts` — string change, no architecture impact
3. Last resort: revert F6 commit; the single-judge path resumes

## Out of scope (do NOT do this iteration)

- Three-judge ensembles (overkill for v1)
- Per-category specialist judges (medical vs supplements vs electrical)
  — single skeptical judge for all regulated categories first
- Tunable disagreement thresholds (today: any disagreement → HITL)
- Cross-tenant disagreement learning — privacy concern, defer
