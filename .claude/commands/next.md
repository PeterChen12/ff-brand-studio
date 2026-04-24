---
description: Execute the next PENDING step in plans/active-plan.md
argument-hint: "[optional step number like '2.3']"
---

Read `plans/active-plan.md` and follow this procedure exactly:

1. If $ARGUMENTS is provided (e.g., "2.3"), locate that exact step. Otherwise,
   find the first step with status `PENDING`.
2. If any step is currently `IN_PROGRESS`, stop and tell me — I need to run
   `/commit` first.
3. Update that step's status from `PENDING` to `IN_PROGRESS` in the plan file.
4. Execute ONLY that step's scope. Do not read or touch later steps.
5. Run the step's test command. If it fails, fix and re-run until it passes.
6. When all acceptance criteria are met, STOP responding and tell me:
   "Step X.Y complete. Run /review to verify."
7. Do NOT continue to the next step on your own.
