# Phase D · Iteration 10 — Infrastructure decision (S3 vs storefront redeploy)

**Audit items closed:** Bearking 5.1 (S3 bucket missing), 5.2
(storefront image deploy lag), 2.4, 2.6 — and the operational gap
this exposes
**Depends on:** none (mostly architecture writeup)
**Blocks:** any future operator-driven image upload
**Estimated session length:** medium (1 PR, mostly docs + decision)

## Why now
The audit surfaced that BFR's documented image-upload path is broken:
`lib/s3.ts` references `buyfishingrod-assets` bucket and
`cdn.buyfishingrod.com` CDN, **neither of which exists**. The current
working path is "commit images to the storefront repo's `public/`
dir, push, wait for Amplify build #N." This works but is undocumented
and gates real-time vendor batch publishing on a 3-min deploy.

This iteration is a decision: pick one of the two paths below, then
implement enough to make the choice obvious and re-doable for the
next vendor batch.

## Path A — Repair the S3 bucket + CDN

1. Create the AWS S3 bucket `buyfishingrod-assets` in `us-east-1`
   under account `590183723867`
2. Create the CloudFront distribution + Route 53 CNAME
   `cdn.buyfishingrod.com` pointing at the bucket
3. Wire the existing `/api/upload` route (admin-side) to actually
   write to S3, not just shape the request
4. Migrate the 60+ existing `www.ceronrod.com`-hosted images plus the
   relative-path ones to S3
5. Update `toPublicImageUrl()` to prefer the CDN URL when available

**Pros:** real-time uploads, no redeploy gap, scales to thousands
of products, separates content from code.
**Cons:** ~2-4 hours infra work, monthly S3 + CloudFront bill (~$5-50
depending on volume), migration risk on existing images.

## Path B — Document the storefront-redeploy workflow

1. Write `docs/IMAGE_UPLOAD_WORKFLOW.md` documenting the current
   "commit to storefront `public/`, push, wait for build" path
2. Build a small admin tool: `app/(dashboard)/products/upload-images/page.tsx`
   that takes a folder of images, writes them to a temp S3-compatible
   place (could even be a per-tenant R2 bucket on the studio side),
   then auto-generates the storefront PR via `gh pr create`
3. Delete the dead `lib/s3.ts` and `/api/upload` plumbing — they're
   misleading scaffolding
4. Document the redeploy expectation in the operator runbook:
   "vendor batch images take ~3min from upload to live"

**Pros:** zero infra cost, leverages existing Amplify pipeline,
auditable (git commits = image diffs).
**Cons:** redeploy gap stays. Real-time uploads impossible. PR-per-batch
adds a step.

## Recommended: Path B (for now)

The redeploy gap is annoying but not blocking; the BFR site is not
high-traffic enough to need real-time image upload. Path A is
strictly better long-term but is also a 1-day infra project, which
this batch isn't sized for.

When BFR scales (or another tenant wants self-serve image upload),
revisit and pick Path A.

## Files to touch (Path B)

- (new) `creatorain/buyfishingrod-admin/docs/IMAGE_UPLOAD_WORKFLOW.md`
  — the runbook
- (new) `creatorain/buyfishingrod-admin/app/(dashboard)/products/upload-images/page.tsx`
  + `_client.tsx` — folder upload UI that stages to a temp location
  and emits the storefront PR
- `creatorain/buyfishingrod-admin/lib/s3.ts` — DELETE or reduce to a
  stub that throws "image upload now goes via the workflow at
  /products/upload-images"
- `creatorain/buyfishingrod-admin/app/api/upload/route.ts` — DELETE
  or 410-Gone with a pointer to the new workflow

## Acceptance criteria

- [ ] An operator can drop a folder of images at
      `/products/upload-images` and get a "we opened PR #N for you"
      response within 30s
- [ ] The PR auto-merges once Amplify build succeeds (or stays open
      for a human to merge — design choice)
- [ ] The runbook explicitly says "expect 3min from PR open to live"
- [ ] `lib/s3.ts` is gone (or stubbed) — no more dead code references
- [ ] `/api/upload` returns 410-Gone with a JSON body pointing at the
      new workflow

## Implementation notes

- This iteration is the smallest one that USEFULLY closes the
  infrastructure ambiguity. The full Path A migration is its own
  phase
- The PR-creation step needs a GitHub token with `contents:write` —
  use a fine-grained PAT scoped to the storefront repo. Store on
  Amplify env as `STOREFRONT_GH_TOKEN`
- Stage uploads to R2 temporarily (existing `R2_BUCKET_FF_BRAND_STUDIO`
  bucket can host a separate prefix `bfr-storefront-staging/`)
- The auto-PR description should list every changed file, including
  `manifest.csv` if generated, so reviewers can spot-check

## Out of scope (do NOT do this iteration)

- Path A (S3 bucket creation, CloudFront setup) — separate phase
- Image optimization in the upload pipeline (resize, webp, etc.) —
  defer; the existing `sharp` pipeline already does this for FF Studio
- Per-tenant CDN bucket isolation — overkill for BFR-only deploy
- Two-step approval workflow (PR opened, operator approves) — start
  with auto-merge; add gating if abuse emerges
