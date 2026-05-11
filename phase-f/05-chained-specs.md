# Phase F · Iteration 05 — Chained specs-table extraction (E5.C)

**Closes:** E5 audit item C + Bearking audit issue 3.3 (spec rows
lost in some series; 8-13 captured when source had ~15)
**Depends on:** F1 (uses the quality-gate abstraction)
**Blocks:** none
**Risk:** 🟡 low — additive validation step
**Estimated session length:** small (1 PR, ~hour)

## Why now
The Bearking vendor batch surfaced that single-pass spec extraction
loses rows. A chained pattern (extract → validate → re-extract for
missing rows) closes the loss without major surgery. Becomes the
third concrete consumer of F1's quality-gate abstraction, which
further validates the API shape.

Expected impact: spec completeness near 100% on future vendor batches
(currently ~70%).

## Files to touch (all in `apps/mcp-server/src`)

- `pipeline/specs.ts` — extend the existing extraction to use the
  quality-gate pattern. The `judge` step is a Sonnet call:
  "Given this source text and these extracted specs, list any rows
  from the source that were NOT captured." The `fix` step re-extracts
  with the missed rows explicitly named in the prompt
- (new) `test/pipeline/specs-chain.test.ts` — unit tests with
  scripted Sonnet responses verifying: clean first-pass extraction
  passes through, partial-extraction triggers re-extract, max-1-retry
  cap

## Quality-gate plumbing

```typescript
const specsGate = await runQualityGate({
  initial: { source, extracted: firstPassResult },
  judge: async ({ source, extracted }) => {
    const validation = await validateExtraction({ source, extracted, anthropicKey });
    return {
      pass: validation.missing_rows.length === 0,
      reasons: validation.missing_rows.map((r) => `missed: ${r}`),
      cost_cents: validation.cost_cents,
    };
  },
  fix: async ({ source, extracted }, reasons) => {
    const missed = reasons.map((r) => r.replace(/^missed: /, ""));
    const reExtracted = await reExtractWithHints({ source, prior: extracted, hints: missed });
    return { source, extracted: reExtracted };
  },
  maxAttempts: 1, // one re-extraction attempt, then accept what we have
});
```

## Acceptance criteria

- [ ] A docx that originally produced 9 spec rows but had 15 in the
      source now produces 14-15 rows after one re-extraction
- [ ] A clean first-pass extraction (all rows captured) passes
      through with no re-extract call (zero added cost)
- [ ] Re-extraction has a hard cap of 1 attempt; if it still misses
      rows, accept the result + log a warning note
- [ ] Audit log notes `specs_chained_extract attempts=N missed=M`
      per launch so we can measure the recovery rate
- [ ] No regression on existing extraction quality — passing-through
      cases (already-complete) produce identical output to before
- [ ] Total added cost per launch: ~$0.01 (one Sonnet validation
      call). If re-extraction fires: ~$0.03 extra

## Safety practices

- **Pin #5 — Compat-first**: APPLIES — the gate's pass path is
  byte-identical to today's behavior. Only the no-pass path adds
  new work
- **Audit logging**: APPLIES — record every chained-extract event
  so we can monitor the recovery rate and tune the validator prompt

## Implementation notes

- The validator's Sonnet prompt should be terse: "Compare the source
  text to the extracted specs list. Return JSON: `{ missing_rows:
  string[] }`. Each missing row is a short description of what the
  source contained but the extraction lacked."
- The re-extraction prompt prepends "PRIOR ATTEMPT MISSED: <list>"
  and asks Sonnet to do the full extraction again, emphasizing the
  missed rows
- Cap on missed_rows is 20 — if the validator reports more, something
  bigger is wrong; accept the result and flag for HITL
- The existing `pipeline/specs.ts` extraction stays as the first-pass
  function; F5 just adds the gate around it

## Rollback plan

If chained re-extraction produces worse results (e.g. hallucinates
specs that weren't in the source):
1. Revert F5 commit; first-pass extraction returns to its current
   single-shot behavior
2. F1's abstraction stays; F3 (best-of-input) and F4 (defect router)
   are unaffected

## Out of scope (do NOT do this iteration)

- Replacing the entire specs extraction with structured-output
  Sonnet (already on a different roadmap)
- Validating specs against external sources (vendor catalogs, etc.)
- Operator-edit-able specs in the dashboard — separate UX iteration
