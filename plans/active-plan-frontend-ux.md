# FF Brand Studio — Frontend UX/IA Iteration

**Mission rewrite (the one sentence):** Bad product photos + a description in → Amazon-US + Shopify-ready images + bilingual listings out, with per-platform compliance scoring and HITL review.

**Audit summary:** the dashboard still encodes v1 (single-agent social-content campaigns). Two visual refreshes never re-architected what pages are FOR. The v2 flagship flow — `launch_product_sku` orchestrator that fans out images + SEO listings + compliance per platform — has zero UI surface.

---

## Settled decisions (defaults the iteration assumes)

1. **v2 is canonical.** v1 `/campaigns/new` social-campaign flow archived (route deleted; no redirect — UI only).
2. **Persona.** Chinese seller / ecommerce ops operator. (FF interview demo viewer is a secondary audience.)
3. **Pitch.** One sentence (above). Visible in metadata + Overview hero.
4. **Platforms in UI.** Amazon US + Shopify DTC for Phase 1. Tmall/JD remain backend-only until UI requested.
5. **Launch wizard depth.** Batch (submit → spinner → result). Streaming via SSE = future iteration.
6. **Asset semantic-name strategy.** Compute display names in UI by joining product/variant/platform_asset. No schema change.
7. **Brand voice.** Drop decorative atelier/bench/成 layer. Keep functional bilingual labels (section eyebrows like "Launches · 上线" remain).

---

## Phase F1 — Vocabulary + IA cleanup
**Acceptance:** every page reads as v2 ecommerce, no atelier/bench/成 decoration, nav order matches user journey, sidebar prioritizes nav over health-probe.

- F1.1 — Rewrite Shell: drop "成 — chéng / shipping ops" tagline, replace with "for cross-border sellers". Demote health probe to a small dot in the sidebar footer (or hide behind a tooltip). Reorder nav: Overview → Launch → Library → Costs.
- F1.2 — Update root layout metadata: title `FF Brand Studio · Listing Ops`, description matches the pitch.
- F1.3 — Drop atelier copy in PageHeader props across all 5 pages. Replace with literal v2 vocabulary.
- F1.4 — Rename pages in nav + route map:
  - "Overview" stays
  - "Asset Manifest" → "Library"
  - "New Campaign" route → deleted (folded into Launch)
  - "SEO Atelier" → deleted (folded into Launch)
  - "Cost Ledger" → "Costs"
  - **NEW:** "Launch" at `/launch`

## Phase F2 — Launch wizard (replaces /campaigns/new + /seo)
**Acceptance:** a single `/launch` flow takes a product → emits per-platform images + bilingual SEO copy + compliance ratings. Hits one Worker endpoint that runs the v2 orchestrator.

- F2.1 (backend) — New Worker endpoint `GET /api/products` listing seeded SKUs (D8 demo + any future products) with seller info. Read-only, no auth.
- F2.2 (backend) — New Worker endpoint `POST /demo/launch-sku` wrapping `launch_product_sku` with safe defaults (`dry_run=true` for image stage to keep cost zero; `include_seo=true` for real SEO). Returns full pipeline result + cost ledger.
- F2.3 (frontend) — New page `/launch` with stepper:
  1. Pick product (loads from `/api/products`; clicking a row pre-fills the rest)
  2. Pick platforms (Amazon US ✓, Shopify ✓)
  3. Review + Launch (single CTA hits `/demo/launch-sku`)
  4. Result panel: image-plan summary, per-platform copy cards (rating badge, copy preview, issues, regenerate), compliance gate, "Save to Library" CTA
- F2.4 (frontend) — Delete `/campaigns/new` and `/seo` routes. Drop their components after confirming none are imported elsewhere.
- F2.5 — Update home-page CTA from "New Campaign" to "Launch a SKU".

## Phase F3 — Library (was /assets) — smart titles + grouping
**Acceptance:** asset cards show meaningful titles (SKU + platform + slot) instead of raw R2 keys. Cards group by SKU when product info is available.

- F3.1 (backend) — `/api/assets` enhancement: include joined `platform_assets` data when available (variant_id, platform, slot, model_used). Keep legacy v1 assets too (with `legacy: true` flag on rows that come from `assets` table only).
- F3.2 (frontend) — Rewrite `/assets` (now `/library`) to render two sections: (a) "By SKU" grouped accordion of v2 assets, (b) "Legacy" flat list for v1 social heroes.
- F3.3 (frontend) — Update card subcomponent: title is `${sku} · ${platform} · ${slot}` for v2; for v1 fall back to campaign + asset_type.

## Phase F4 — Overview rebalance
**Acceptance:** hero metric is "Recent launches" not cumulative spend. Score-band reference text demoted out of the home grid.

- F4.1 — Hero block becomes "Recent launches" — pull last 5 from `launch_runs` (need new `/api/launches` endpoint), show SKU + status + cost + time. Empty state shows "Run your first launch" CTA.
- F4.2 — Demote "Brand-score thresholds" card into a small footer help link or move to a `/help` route.
- F4.3 — Quick-actions card simplifies to two CTAs: "Launch a SKU" (primary), "Browse library" (secondary).

## Phase F5 — Costs realignment (light touch)
**Acceptance:** at minimum, costs page acknowledges launch_runs. Heavy redesign deferred.

- F5.1 — Add a small "Recent launch runs" section under the existing v1 ribbon, sourced from launch_runs.
- F5.2 — Update copy to use "launches" terminology where relevant.

## Phase F6 — Verify + ship
- F6.1 — Workspace type-check 7/7 green
- F6.2 — Dashboard `pnpm build` succeeds, all routes prerender (was 5; will be 5: `/`, `/launch`, `/library`, `/costs`, `/help` if added)
- F6.3 — Commit per phase, push to master, GitHub Actions auto-deploys to Pages
- F6.4 — Curl-verify live URL renders the new flow

---

## Non-goals (explicitly out of scope this iteration)

- SSE/streaming progress in launch wizard (future)
- Real image generation triggered from UI (cost concern; keep `dry_run` for now)
- Tmall / JD surfaces in UI (backend-only)
- LoRA training UI
- Multi-tenant / seller switching
- Auth
- Dark mode
- v1 route redirects (just delete; old links 404 cleanly)

---

## Dependency map

```
F1 ──→ F2 ──→ F4 ──→ F6
       │
       └──→ F3
       │
       └──→ F5
```

F1 must land first (vocab change). F2 is the largest chunk. F3, F4, F5 are independent after F2 lands.
