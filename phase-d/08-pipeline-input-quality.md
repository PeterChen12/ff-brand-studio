# Phase D · Iteration 08 — FF Studio input-quality fail-fast

**Audit items closed:** Bearking 4.3 (no input-quality fail-fast) —
#3 ranked silently-bad-output cause
**Depends on:** D6 (uses the same `pickBestReference` scoring infra)
**Blocks:** none
**Estimated session length:** small (1 PR, ~hour)

## Why now
Today the pipeline runs cleanup → derive → refine on a
400×400 watermarked vendor thumbnail just as eagerly as on a
4000×4000 studio shot. We charge the wallet, run FAL, produce
something that'll inevitably fail QA → retry up to 3× → still fail →
land in HITL. That's $1.50–$3.00 of wallet burned on a launch that
was never going to succeed. A 5-line pre-flight saves it.

## Files to touch

- `apps/mcp-server/src/pipeline/cleanup.ts` (entry point — runs
  before any worker call)
  - At the top of the function, validate `inputBuffer`:
    1. Use `sharp(buffer).metadata()` to get width/height
    2. Reject if `Math.max(width, height) < 1500`
    3. Reject if mime type isn't `image/jpeg` or `image/png` or
       `image/webp` (already caught at upload, but defense in depth)
    4. Use Tesseract.js or a lightweight text-detection heuristic
       to reject if detected text overlay covers >10% of the frame
       (watermarked vendor thumbnails)
  - Throw `ApiError(422, 'input_quality_too_low', message)` with
    detail `{ width, height, longest_side, has_text_overlay }`

- `apps/mcp-server/src/orchestrator/launch_pipeline.ts`
  - Catch the new `input_quality_too_low` error per-reference
  - If ALL references fail input quality, mark the run as
    `cost_capped` (don't bill image gen) and add a clear note:
    "All N references failed quality check — please upload at least
    one image ≥1500px without heavy watermark"
  - If only SOME references fail, exclude them from `pickBestReference`'s
    candidate pool but proceed with the survivors

- `apps/dashboard/src/components/launch-wizard.tsx`
  - Render the new error type with marketer-friendly copy (not the
    raw error code) — "Your reference images need to be at least
    1500px on the longest side, without watermarks. Try uploading
    a higher-resolution version."

## Acceptance criteria

- [ ] Launching with a single 400×400 reference returns 422
      `input_quality_too_low` BEFORE any FAL call. Wallet ledger has
      no debit for the launch (or, if already pre-debited, a refund
      row immediately follows)
- [ ] Launching with 1× 4000×4000 + 3× 400×400 references succeeds
      using only the 4000×4000; result panel notes "3 of 4
      references skipped (too small)"
- [ ] An obvious watermarked vendor thumbnail (visible "DMK" text
      across the front) gets rejected
- [ ] The wizard shows a friendly error: "Your reference images
      aren't quite right" with a concrete next-step ("Upload a
      higher-res version") instead of "input_quality_too_low"
- [ ] Cost preview's predicted total doesn't change (preview runs
      pre-launch, before this gate). The savings show up in the
      wallet ledger as "no debit" rather than as a preview discount

## Implementation notes

- Sharp metadata is sub-millisecond; this gate adds negligible
  latency. The text-detection heuristic IS slower (~100ms via
  Tesseract). If perf is a concern, gate text-detection behind the
  size + format check so it only runs when the cheap checks pass
- The 1500px threshold is a starting point — log all rejections for
  a week, see if any legitimate inputs are caught, tune down if so
- A run that fails this gate should NOT count toward the tenant's
  monthly regen quota — it never ran. Refund the pre-debit if any
- Refund pattern: `wallet_ledger` insert with `delta_cents > 0` and
  `reason = 'input_quality_refund'`, `reference_id` = the failed
  run's id. Surfaces clearly in the costs page

## Out of scope (do NOT do this iteration)

- Auto-upscaling low-res references — quality gain is marginal,
  defer
- Allowing operators to override the gate ("I know it's small, run
  anyway") — too easy to abuse; if the gate is wrong, fix the gate
- Watermark detection via a real CV model — keep the cheap heuristic
  for v1, upgrade if false positives emerge
- Pre-flight on uploads via the agentic D2 path — D2 has its own
  classifier; this iteration is about the launch-time gate
