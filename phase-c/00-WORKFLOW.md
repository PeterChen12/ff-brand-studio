# Phase C — Drafting workflow

This phase addresses the marketer-PM audit (`PHASE_C_INDEX.md` lists every
issue). The work is broken into ~10 small iterations because:

1. **Claude Code context windows blow out** when an iteration plan tries to
   describe a dozen unrelated changes. One iteration = one session = one PR.
2. Marketing-facing UI changes are **easy to merge in pieces** without
   breaking each other. Vocabulary changes don't depend on cost-display
   changes; bulk-inbox changes don't depend on the LLM-judge layer.
3. Each iteration ends with a **shippable, reviewable outcome** that the
   client (BFR) can see — no "half a refactor" in flight.

---

## Rules for drafting an iteration file

1. **One iteration file ≤ 200 lines.** If you can't fit the plan in 200
   lines, split it.
2. **Each file is self-contained.** A new Claude Code session must be able
   to pick up `phase-c/04-vocabulary-sweep.md` and ship it without reading
   any other file in this phase. Re-state context the implementer needs.
3. **No code in the iteration file.** Pseudocode is fine for clarifying
   tricky logic; full diffs belong in the PR.
4. **Specific files only.** Every "files to touch" entry must be an
   absolute path or a glob. Vague references ("the wizard") are forbidden.
5. **Audit items map 1-to-1.** Every iteration cites the audit item
   numbers it closes (`#7, #8, #13, #17`). The index file tracks which
   items are still open.
6. **Out-of-scope is mandatory.** Each file lists 3-5 changes that look
   adjacent but are intentionally NOT part of this iteration — prevents
   scope creep mid-session.

---

## Standard structure for each iteration file

```
# Phase C · Iteration NN — <title>

**Audit items closed:** #X, #Y
**Depends on:** Iteration NN (or: none)
**Blocks:** Iteration NN (or: none)
**Estimated session length:** small (1 PR, ~hour) | medium (1 PR, ~half day) | large (2 PRs)

## Why now
3 sentences max. What breaks if we don't ship this; what unlocks if we do.

## Files to touch
- `apps/dashboard/src/components/launch-wizard.tsx` — what changes
- `apps/dashboard/src/lib/...` — what changes
- (new) `apps/dashboard/src/lib/...` — purpose

## Acceptance criteria
Bulleted, testable. The reviewer should be able to walk through these
one by one.
- [ ] Mei opens the wizard and sees X
- [ ] Toggling Y persists across reload
- [ ] Backend Zod schema accepts Z

## Implementation notes
The non-obvious bits. Order of operations, edge cases, performance
considerations, things a fresh session would otherwise have to discover
the hard way.

## Out of scope (do NOT do this iteration)
- Adjacent change A — that's iteration NN
- Tempting refactor B — defer
- Visual polish C — covered later
```

---

## Drafting cadence

- **One iteration file per drafting session.** Don't try to draft
  multiple at once — by file 3 the quality drops.
- **Index first.** `PHASE_C_INDEX.md` is the source of truth for ordering
  and dependencies. Keep it current; cross out items as iterations close.
- **Re-read the audit before drafting.** Audit context decays fast;
  a draft written without re-reading the audit usually misses
  half the cited items.
- **No fixing during drafting.** This is planning only. The
  iteration files describe future work — the PRs that close them
  are separate sessions.

---

## When an iteration is ready to ship

The implementer (could be a future Claude Code session) opens the file,
follows the spec, opens a PR titled `phase-c/NN: <title>`. Closing
checklist:

- [ ] All acceptance criteria pass
- [ ] No out-of-scope changes snuck in (review the diff for items
      explicitly excluded)
- [ ] `PHASE_C_INDEX.md` updated with `✅ shipped` next to this row
- [ ] If the iteration changed user-facing copy or behavior, BFR's
      handoff doc (`buyfishingrod-admin/FF_BRAND_STUDIO_INTEGRATION.md`)
      is updated if relevant

---

## What this phase is NOT

- Not a full v3 rebuild. The audit is targeted at "remove jargon, expose
  what's hidden, hide what's leaking, prevent legal exposure." Anything
  bigger (e.g., a redesigned launch flow) goes to Phase D.
- Not all-or-nothing. We can ship iterations 01 and 02 and pause —
  every iteration is independently valuable.
- Not user-research. The audit was a heuristic walkthrough from the
  Mei persona. Iteration 11+ might commission real user testing once
  these top fixes ship; not in scope here.
