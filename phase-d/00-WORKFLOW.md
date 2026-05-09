# Phase D — Drafting + execution workflow

This phase tackles four problem areas: slow pipeline → batch UX, agentic
bulk upload, per-launch cost reduction, and the 28-item BEARKING audit.
The work is broken into 10 iterations because the Phase C experience
showed that any plan touching more than ~200 lines of intent leaks
context-window budget.

## Drafting rules

Same as Phase C (`phase-c/00-WORKFLOW.md`):

1. One iteration file ≤ 200 lines
2. Each file is self-contained — a fresh session can pick up
   `phase-d/04-bearking-admin-polish.md` and ship it without reading
   any other plan in the phase
3. No code in iteration files; pseudocode for tricky logic only
4. Specific files only (absolute paths or globs)
5. Audit items map 1-to-1
6. Out-of-scope is mandatory

## Standard structure for each iteration file

```
# Phase D · Iteration NN — <title>

**Audit items closed:** <Bearking-audit refs OR problem #>
**Depends on:** Iteration NN (or: none)
**Blocks:** Iteration NN (or: none)
**Estimated session length:** small | medium | large

## Why now
3 sentences max.

## Files to touch
- absolute paths

## Acceptance criteria
testable, bulleted

## Implementation notes
the non-obvious bits

## Out of scope (do NOT do this iteration)
- adjacent thing A
- tempting refactor B
```

## Execution workflow — running through the 10 iterations one by one

When peter says "continue with Phase D" or names a specific iteration,
the executing session should:

1. **Read the index first** — `PHASE_D_INDEX.md` to confirm which
   iteration is next and whether dependencies have shipped
2. **Read the iteration file in full** before touching any code —
   the "Out of scope" section catches scope creep before the diff
   starts piling up
3. **Verify dependencies** — if the iteration's "Depends on" is unmet,
   stop and report it; don't try to absorb the dependency into the
   current iteration
4. **Implement** following the "Files to touch" + "Acceptance criteria"
   bullets as the contract. Don't add adjacent fixes that look obvious
   while diffing — those go in their own iteration
5. **Typecheck both apps** (worker + dashboard) before committing —
   `pnpm -F ff-mcp-server type-check` and `pnpm -F ff-dashboard type-check`
6. **Commit + push** with subject `phase-d/NN: <title>`. Mark the row
   `✅ shipped` in `PHASE_D_INDEX.md` in the same commit
7. **Deploy** if the worker changed — wrangler from this machine works
   with the legacy CLOUDFLARE_API_KEY in `Claude_Code_Context/.env`
8. **Smoke-test** — at minimum hit the new endpoint(s) with a known
   request to confirm the deploy is live; don't trust the CI green
   alone
9. **Update memory** if the iteration introduces lasting facts
   (e.g., new endpoint paths, new tenant flags, new infrastructure
   dependencies) so future sessions know
10. **Ask peter for the next iteration** — don't auto-continue past
    the iteration named in the prompt unless peter explicitly said
    "do all of phase D"

## When to PAUSE and ask

- The iteration's "Out of scope" wasn't enough — adjacent work is
  surfacing that genuinely should come first. Stop and propose the
  re-ordering before doing anything
- Cost-affecting changes (D3) — confirm the wallet-debit semantics
  with peter before deploying; the math has to be right
- Architecture decisions (D7 stub-workers, D10 infrastructure) — these
  are not code-only iterations; surface the decision points before
  coding

## What NOT to do

- Don't draft new iteration files mid-execution. If you find work that
  doesn't fit any drafted plan, add it to a "Phase E pending" list at
  the bottom of the index, don't paper over it
- Don't merge iterations even if they "feel related." The 200-line
  rule exists because larger plans drift mid-session
- Don't ship code that touches a Bearking audit item without citing
  the audit reference number in the commit message — the audit doc
  is the single source of truth for whether something was actually
  fixed
