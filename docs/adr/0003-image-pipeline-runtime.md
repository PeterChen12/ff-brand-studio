# ADR-0003 — Image pipeline runtime: Worker orchestrator + Node sidecar for sharp ops

**Status:** accepted (2026-04-27, Phase I).
**Supersedes:** the original ADR-0003 draft inside `plans/active-plan-saas-I.md`
which proposed running `sharp` inside the Cloudflare Worker.

## Decision

Phase I image pipeline runs in two pieces:

1. **Cloudflare Worker** owns orchestration, billing, audit, all HTTP-call
   steps (gpt-image-2 cleanup, Nano Banana Pro refine, Workers AI CLIP
   triage, Anthropic Opus 4.7 vision adjudication, iter loop, planner,
   adapters, R2 reads/writes for byte handoff).
2. **Node companion sidecar** (`apps/image-sidecar/`) owns the four
   `sharp`-backed pixel ops: `/derive` (kind-aware crops with
   adaptive padding), `/composite-text` (SVG-overlay infographics for
   the Amazon A+ feature slots), `/banner-extend` (16:9 hero with
   brand-color gradient extension for Shopify), `/force-white`
   (the Phase 2 white-bg compliance snap).

Communication is Worker → sidecar HTTPS with HMAC-SHA256 of
`{ts}.{r2_key}` over `IMAGE_SIDECAR_SECRET` in the `X-FF-Signature`
header. R2 keys flow as the only payload — no image bytes cross the
hop. Sidecar reads/writes R2 via the same SigV4 credentials as the
Worker (`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`).

## Why the original "sharp inside Worker" plan failed

`sharp` is a native module bound to `libvips` (C++). Cloudflare Workers
run in a V8 isolate with no native-module loader; even with
`compatibility_flags = ["nodejs_compat"]` the loader rejects native
.node addons. The `sharp` dep already in `apps/mcp-server/package.json`
is referenced only by `src/lib/image_post.ts`, which has no runtime
caller — confirmed by grep at the time of this ADR. Phase 2's
`forceWhiteBackground` was effectively dead code. Shipping Phase I
with sharp-in-Worker would have type-checked and built cleanly, then
produced an `Error: Cannot find module 'sharp'` at first invocation
in production.

## Why a sidecar over the alternatives

| Option | Verdict |
|---|---|
| **Cloudflare Image Resizing** for crops/resize | Insufficient. No SVG overlay → I4 composite would have to call gpt-image-2 with text in the prompt, which is non-deterministic and hits the OpenAI text-rendering failure modes (typos, kerning artifacts, color drift). |
| **Workers Container binding** (recently GA) | Viable, but tied to Cloudflare's container scheduler which is still beta-priced and lacks the standard observability surface (Sentry, Render dashboards). Adds a CF-specific runtime to the failure surface. |
| **Modal Labs Python** | The plan's I1.5 fallback. Higher fidelity to `lykan_upload`, but cold-start (3–10 s) and dual-language ops cost. Reserve for if a future kind needs scipy bbox detection. |
| **Node + sharp on Render/Fly** (chosen) | Stable runtime, $0–7/mo at our volume, single language, Dockerfile-portable, easy to point at Modal later if a kind needs scipy. |

## Consequences

- **Two services to operate.** Worker stays the source of truth for
  tenant/billing/audit; sidecar is stateless. Sidecar down ⇒ pipeline
  fails fast; production_pipeline flag guarantees no tenant is auto-
  routed to it.
- **One extra deploy target.** Render free tier (or Fly $5/mo) hosts
  the sidecar. Health check at `/healthz`. The sidecar repo lives
  inside the monorepo at `apps/image-sidecar/`.
- **HMAC + R2-only payload.** The sidecar never receives JWTs or
  Clerk session state. Auth is HMAC over a small fingerprint, which
  caps blast radius if the sidecar is compromised.
- **Cache + idempotency.** Sidecar caches outputs in R2 keyed by
  `sha256(input_key + op_params)`; same input twice = same R2 output
  key, no recomputation.
- **Cost gating.** All paid steps (cleanup, refine, vision, lifestyle)
  charge wallet via the Worker; sidecar ops are free CPU.
- **Migration path.** If a kind needs scipy/Pillow, swap the sidecar
  for the Modal Python service from the original I1.5; the Worker
  contract is the same four endpoints.

## Spike numbers (to be filled after the user runs the spike)

| SKU kind | Cleanup ¢ | Refine ¢ | Vision ¢ | Lifestyle ¢ | Composite ¢ | Total ¢ | Wall ms |
|---|---|---|---|---|---|---|---|
| rod (long_thin_vertical) | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ |
| drinkware (compact_square) | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ |
| handbag (compact_square) | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ |

Target: ≤$2.70 raw COGS per SKU per Phase H pricing (~$6.20 charged ⇒
~61% margin). Spike acceptance gates the production_pipeline flag
flipping default-on for new tenants.
