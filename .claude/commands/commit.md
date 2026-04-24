---
description: Mark the current IN_PROGRESS step DONE and create a git commit
---

1. Find the step in `plans/active-plan.md` marked `IN_PROGRESS`.
2. Change its status to `DONE`.
3. Stage all changes: `git add -A`
4. Commit with a conventional message:
   - `feat(<scope>): <step title>` for feature steps
   - `chore(<scope>): <step title>` for setup/config steps
   - `test(<scope>): <step title>` for test-only steps
5. Commit body must include the acceptance criteria that were met.
6. After committing, stop. Do NOT run /next automatically.
7. Tell me: "Step X.Y committed as <hash>. Run /next when ready."
