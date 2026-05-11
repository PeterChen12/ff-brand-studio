# Phase F · Iteration 04 — Compliance defect router (E5.B)

**Closes:** E5 audit item B — route compliance rejection reasons to
specialist fixers instead of one generic regenerate prompt
**Depends on:** F1 (uses the quality-gate abstraction)
**Blocks:** none
**Risk:** 🟡 low — additive routing logic
**Estimated session length:** medium (1 PR, ~half day)

## Why now
Today when the dual_judge rejects an image with reasons like
"background not pure white" or "text detected in image" or
"product cropped", the regen prompt just appends the reasons and
runs the same FAL refine. Wastes iterations because the generic
prompt doesn't aggressively target the specific defect.

Routing each defect class to a specialist fixer (different prompt
prefix, different parameter set) cuts iteration count from ~3 to
~1 on most FAIR results.

Expected impact: ~30% fewer regenerations per launch.

## Files to touch (all in `apps/mcp-server/src`)

- (new) `pipeline/defect-router.ts` — exports
  `classifyDefects(reasons: string[]) → DefectCategory[]` and
  `buildSpecialistPrompt(category: DefectCategory, basePrompt: string) → string`
- `pipeline/iterate.ts` — when the quality-gate (from F1) returns
  reasons, classify them and build the fixer prompt accordingly
  instead of appending reasons verbatim
- (new) `test/pipeline/defect-router.test.ts` — unit tests for
  classification (regex-based) + prompt construction

## Defect categories (initial set)

| Category | Match pattern | Specialist instruction |
|---|---|---|
| `bg_not_white` | `/background.*not.*white\|color banding\|gradient seams\|halo/i` | "Re-render with PURE WHITE seamless background (#FFFFFF), zero color banding, zero gradient, no halo around the product. The product itself stays identical." |
| `text_in_image` | `/(text\|watermark\|logo\|caption\|character\|scanline)/i` | "ABSOLUTE PRIORITY: previous attempt added text/watermarks. Generate with ZERO text, ZERO letters, ZERO numbers, ZERO logos. Only product-printed text is allowed." |
| `cropped_subject` | `/cropped\|cut off\|out of frame\|partial/i` | "Re-render with the FULL product visible end-to-end. Centered, generous fill (0.55-0.75 of frame), nothing cut off." |
| `wrong_color` | `/wrong.*color\|recolor\|color.*mismatch/i` | "Match the EXACT color of the reference. Do not re-tint, do not re-saturate, do not adjust hue." |
| `melted_geometry` | `/melted\|warped\|impossible\|extra fingers\|duplicated/i` | "AI artifact in previous attempt. Re-render with clean geometry — no duplicated parts, no warping, no impossible features. Hold the identity of the reference exactly." |
| `generic` | (fallback) | (existing reason-block appending) |

## Quality-gate integration

```typescript
const refineGate = await runQualityGate({
  initial: { promptArgs, lastOutput: null },
  judge: async (state, attempt) => {
    // call refine + dual_judge as today
    const output = await refineCall(...);
    const verdict = await judgeImage(output);
    return { pass: verdict.approved, reasons: verdict.reasons, cost_cents: ... };
  },
  fix: async (state, reasons) => {
    const categories = classifyDefects(reasons);
    const specialistPrompt = buildSpecialistPrompt(categories[0] ?? "generic", basePrompt);
    return { ...state, promptArgs: { ...state.promptArgs, override: specialistPrompt } };
  },
  maxAttempts: 2, // matches current 3-iter cap
});
```

## Acceptance criteria

- [ ] A reject with reason "background has color banding" routes to
      the `bg_not_white` specialist, which prepends pure-white
      directive to the regen prompt
- [ ] A reject with reason "text artifact in bottom-right" routes
      to `text_in_image` specialist
- [ ] Multi-defect reasons (e.g. cropped + text) classify into both
      categories; the first one (highest-priority) drives the
      specialist; the rest are appended as reasons (defense in depth)
- [ ] Unknown defect reasons fall back to the generic reason-append
      behavior (existing today)
- [ ] Average iteration count per FAIR launch drops measurably
      (collect for 1 week post-deploy; expected from ~2.4 to ~1.5)
- [ ] No regression on EXCELLENT/GOOD launches (which don't trigger
      the fix path)

## Safety practices

- **Pin #5 — Compat-first**: APPLIES — the generic fallback exists
  for any defect we haven't seen yet. New routing only fires when
  reasons match known patterns. Unknown reasons take the old path
- **Audit logging**: APPLIES — every specialist invocation logs
  `defect_routed defect=bg_not_white` so we can measure routing
  hit rate

## Implementation notes

- Classification is regex-based. Could later be Haiku-based for
  fuzzy matching, but regex is deterministic and free — start here
- Priority order matters when multiple defects classify: text first
  (most embarrassing), then bg, then cropped, then color, then
  geometry. Codify in `defect-router.ts`
- The specialist prompts are tunable post-ship — they're just
  strings, no architecture change to retune
- This iteration assumes F1 has shipped + the quality-gate is wired
  into iterate.ts. F4 is a no-op on the abstraction itself; it adds
  the routing logic to the fix function

## Rollback plan

If specialist prompts cause regressions:
1. Revert the F4 commit; the quality-gate keeps working with the
   old generic reason-append. F3 (best-of-input) is unaffected
2. If only one specialist is bad (e.g. `bg_not_white` overcorrects),
   delete that category's entry — others keep working

## Out of scope (do NOT do this iteration)

- Haiku-based fuzzy defect classification — regex first, swap later
  if needed
- Operator-tunable specialist prompts via UI — JSON constant only
- Per-tenant defect category overrides — global rules for v1
- Replacing the dual_judge — it stays as the judge; only the fix
  function changes
