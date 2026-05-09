# Phase D · Iteration 07 — FF Studio stub-workers decision

**Audit items closed:** Bearking 4.2 (`launch_product_sku` returns
stub URLs) — #2 ranked silently-bad-output cause
**Depends on:** none (but D6 should ship first to avoid double-dipping
on pipeline changes)
**Blocks:** none
**Estimated session length:** large (2 PRs likely; this is partly an
architecture call)

## Why now
`apps/mcp-server/src/orchestrator/workers/{white_bg,lifestyle,variant,
video}.ts` are still placeholder stubs returning fake R2 paths. The
real production work happens in `pipeline/index.ts` via
`runProductionPipeline`. Two callers + two code paths = drift; the
audit found cases where workers/* was hit and silently produced
nothing valid because the stubs were never finished.

This iteration is a decision point: **delete the stubs and route
everything through `runProductionPipeline`**, OR **finish Phase 2 by
plumbing real generation into each worker file**. Both are valid;
the audit recommends the former because Phase 2 was never scoped.

## Recommended path: delete stubs, single entry point

Single source of truth: `runProductionPipeline`. The stub worker
files become thin shims (or deleted entirely). Any caller that
imported from `orchestrator/workers/*` re-imports from `pipeline/`.

## Files to touch (recommended path)

- `apps/mcp-server/src/orchestrator/workers/white_bg.ts`
- `apps/mcp-server/src/orchestrator/workers/lifestyle.ts`
- `apps/mcp-server/src/orchestrator/workers/variant.ts`
- `apps/mcp-server/src/orchestrator/workers/video.ts`
  - DELETE these files. If any have non-stub helpers, lift them into
    `pipeline/`

- `apps/mcp-server/src/orchestrator/launch_pipeline.ts`
  - Already imports from `workers/index.ts`. Replace those imports
    with direct `runProductionPipeline` calls per slot
  - Per-worker invocation pattern: build a slot-specific
    `PipelineCtx` with `{ targetKind, dimensions, brandHex, ... }`
    and call the production pipeline once per slot

- `apps/mcp-server/src/orchestrator/workers/index.ts`
  - DELETE re-exports; either delete the file or replace with a single
    re-export of `runProductionPipeline` for legacy import paths

- Any test that mocked `generateWhiteBgWorker` etc. needs to mock
  `runProductionPipeline` instead. Check `tests/orchestrator/*.test.ts`

## Acceptance criteria

- [ ] No code path returns the literal stub URL pattern
      `r2://stub/...` anywhere in the worker. Grep audit:
      `rg "r2://stub" apps/mcp-server/src` returns zero
- [ ] All existing 61 worker unit tests pass against the new shim
- [ ] A real launch (full run, not dry) still produces real R2 URLs
      for every slot. No 200-response with garbage URLs
- [ ] The audit-log `notes[]` no longer contains the string
      "stub_worker_used" anywhere
- [ ] Per-slot cost attribution remains correct (each slot's
      `cost_cents` populated from the actual pipeline run, not zeroed
      because of stub bypass)

## Implementation notes

- Phase 2 (the un-finished alternative) was scoped as: real
  white-bg/lifestyle/variant generators living in
  `orchestrator/workers/*` so the orchestrator could call them
  directly. The pipeline `runProductionPipeline` ended up being the
  pragmatic in-Worker path. Choosing one means deleting the other
- This change is a refactor, not a feature. Pull a separate audit
  pass post-refactor to confirm no live customer flow broke (BFR's
  Phase B ingest path runs through `launch_pipeline.ts` which DOES
  go through `runProductionPipeline` already, so should be safe —
  but verify)
- If any test uses fake worker URLs as fixtures, regenerate the
  fixtures from a real (cheap, dry-run) launch
- Watch for the V2_INVENTORY note: "v2 uses plain async chains" —
  some of the worker files may have been planned as the LangGraph
  port. Deleting them removes that future path. Confirm with peter
  before merging

## Out of scope (do NOT do this iteration)

- Actually adding LangGraph (the deferred V2 plan) — separate phase
- Refactoring `runProductionPipeline` itself — keep it as-is, just
  reroute callers
- Changing the per-slot cost model — that's D3 (cost reduction)
- Adding new worker types (e.g., a transparent-bg worker) — out of
  scope until Phase 2 is officially closed
