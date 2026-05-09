# Phase D · Iteration 01 — Async client-side launch queue

**Problem:** #1 (slow pipeline blocks the wizard)
**Depends on:** none
**Blocks:** none (D2 agentic upload reads from the same queue API)
**Estimated session length:** medium (1 PR, ~half day)

## Why now
A Mei waits 120s+ on a single launch before she can do anything else.
For a 27-product vendor batch (Bearking), that's 54 minutes of wall-
clock at a screen, not background time. She needs to start launch #2
the moment she clicks Launch on #1, not when #1 finishes. We do this
client-side first because the worker side already supports concurrent
calls; a true server-side queue (Cloudflare Queues + Durable Objects)
is bigger work and out of scope here.

## Files to touch

- (new) `apps/dashboard/src/lib/launch-queue.tsx` — React context +
  reducer holding `Map<id, LaunchJob>` where `LaunchJob = { product_id,
  product_name, status: "queued"|"running"|"succeeded"|"failed",
  result?, started_at, finished_at }`. Caps concurrency at 3 in-flight
  to match the worker's per-tenant rate budget; the rest sit in
  `queued` until a slot frees
- `apps/dashboard/src/app/layout.tsx` — wrap `<LaunchQueueProvider>`
  around `<Shell>` so any page can submit jobs
- `apps/dashboard/src/components/launch-wizard.tsx` — replace the
  direct `await apiFetch("/v1/launches")` with `enqueueLaunch({...})`
  from the new context. The wizard returns to its initial state
  immediately so Mei can pick the next product. The old result panel
  remains for **the most recent completed job** (toggle to history)
- (new) `apps/dashboard/src/components/launch/queue-drawer.tsx` —
  bottom-right floating panel that lists pending/running/done jobs
  with progress bars, clickable to expand a finished job's
  `<ResultPanel>`. Persists across navigation
- `apps/dashboard/src/components/layout/shell.tsx` — render the
  `<QueueDrawer />` at the bottom of `<ShellInner>` so it sticks
  on every signed-in page

## Acceptance criteria

- [ ] Mei clicks Launch on product A. The wizard immediately resets to
      "Pick a product" state. The queue drawer in the bottom-right
      shows "1 in progress" with a progress bar
- [ ] She picks product B and clicks Launch. Queue drawer now shows
      "2 in progress" — both fire concurrently against the worker
- [ ] She queues 5 more. Drawer shows "3 in progress · 4 queued" — the
      first 3 fire, the 4th and 5th wait until one of the 3 finishes
- [ ] When a job finishes, the drawer flashes the row green with a
      "View result" link that opens the existing ResultPanel inline
- [ ] Failed jobs show in red with a "Retry" button that re-enqueues
      with the same payload
- [ ] Drawer state persists across page navigation but NOT across
      browser reload (in-memory only — server-side queue is D-future)
- [ ] Wallet pill in the sidebar reflects the post-debit balance after
      each successful job (re-poll `/v1/me/state` on every job
      completion)

## Implementation notes

- The 3-concurrent cap is a client-side safety; the worker has its own
  240/min rate limit. We don't want one tenant to drop 27 launches at
  once and starve out other tenants
- The reducer pattern is simpler than redux/zustand here. Actions:
  `ENQUEUE`, `START`, `SUCCESS`, `FAILURE`, `REMOVE`. ~80 lines
- Jobs that have been in `queued` >5min should self-fail with a
  client-only timeout error (worker side may have already taken the
  request and still be running, so we just stop watching for it)
- When the user closes the tab mid-queue, in-flight requests continue
  on the worker; only the client UI loses tracking. Document this in
  the drawer's footer copy: "Closing this tab cancels tracking, not
  the underlying jobs."
- The wallet pre-debit happens on the worker; the client just
  optimistically shows "−$X.XX" on the queued row until the response
  comes back

## Out of scope (do NOT do this iteration)

- Server-side queue (Cloudflare Queues + Durable Objects) — that's a
  separate iteration, requires queue opt-in + producer/consumer code
- Cross-session persistence (jobs survive browser reload) — needs a
  server-side queue first
- Cancel-in-flight for queued or running jobs — wallet refunds are
  hard; defer
- Concurrent-launch warnings ("you're about to charge $25 across 5
  jobs") — adjacent UX, separate iteration
- Bulk-launch from the picker (multi-select + 1-click) — that's part
  of D2 (agentic upload) territory
