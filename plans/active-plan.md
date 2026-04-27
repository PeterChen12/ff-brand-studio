# FF Brand Studio v2 — SEO Description Layer

**Goal**: Add bilingual SEO-optimized product description generation to the existing v2 dashboard at https://image-generation.buyfishingrod.com.

**Stack**: Existing MCP server (Cloudflare Workers) + Next.js 15 dashboard. Adding SEO research tools, copy generation tools, and a UI panel.

**Hard constraints**:
- All new tools follow existing MCP pattern in `apps/mcp-server/src/tools/`
- Chinese output runs through compliance flagger before publish
- Per-SKU LLM cost cap: $0.10 (kill switch in orchestrator)
- No new top-level deps in `apps/dashboard`

**Secrets pushed to Worker (verified 2026-04-26):**
- `DATAFORSEO_LOGIN` ✓
- `DATAFORSEO_PASSWORD` ✓
- `APIFY_TOKEN` ✓
- `OPENAI_API_KEY` ✓ (project key, gpt-image-2 access verified)

(Old v1 bootstrap plan preserved at `plans/active-plan-v1-bootstrap.md`.)

---

## D1 — DataForSEO client + research_keywords tool
- `packages/seo-clients/src/dataforseo.ts` — `DataForSEOClient` with `searchVolume`, `relatedKeywords`, `amazonRelated`
- `apps/mcp-server/src/tools/research-keywords.ts` — MCP tool wrapping client
- HTTP Basic auth via `DATAFORSEO_LOGIN` + `DATAFORSEO_PASSWORD`
- Standard queue (3.3× cheaper); Live only for `searchVolume`
- Acceptance: `research_keywords({seed: "wireless car charger", market: "amazon-us"})` returns ≥10 keywords with `searchVolume`. Spend < $0.50.

## D2 — Free autocomplete discovery
- `packages/seo-clients/src/autocomplete.ts` — Amazon + Google + Tmall suggest endpoints
- `apps/mcp-server/src/tools/expand-seed.ts` — alphabet-trick fan-out (`${seed} a..z 0..9`)
- 1-hour LRU cache (in-memory on Worker)
- Acceptance: `expand_seed({seed: "fishing rod holder", market: "amazon-us"})` ≥50 unique phrases. $0 spend.

## D3 — Embeddings + clustering
- OpenAI `text-embedding-3-small` primary ($0.02/1M tokens)
- `packages/seo-clients/src/embeddings.ts` — `embed()` + `clusterByCosine()` agglomerative
- `apps/mcp-server/src/tools/cluster-keywords.ts` — collapses 200 phrases → ~30-40 clusters
- Cluster representative = longest member (proxy for specificity)

## D4 — Bilingual SEO description generator
- `packages/brand-rules/src/seo-prompts.ts` — Amazon US / Tmall / JD / Shopify templates
- Amazon: title ≤200 chars (no word repeated >2× per Jan 2025 policy), 5 bullets ≤500 ea, desc ≤2000, search terms ≤249 bytes
- Tmall: zh chars, PingFang stack, ≤500 zh chars long desc
- Shopify: H1 + meta ≤160 + 200-400 word markdown desc + JSON-LD Product schema + alt text
- Sonnet 4.6 for both en + zh; flag_china_ad_law / flag_us_ad_content gate
- Cost cap: $0.05/call

## D5 — Compliance scorer extension
- `packages/brand-rules/src/seo-rubric.ts`
- Per-platform rubrics; Sonnet evaluator returns `{rating: POOR|FAIR|GOOD|EXCELLENT, issues, suggestions}`

## D6 — Orchestrator integration
- Extend `launch_product_sku` with `includeSEO?: boolean = true`
- Pipeline: `expand_seed` → `cluster_keywords` → `research_keywords` (top reps only) → `generate_seo_description` (per platform × language) → `score_seo_compliance` (loop max 3 iters) → `publish_to_dam`
- Cost cap: $0.50/run total

## D7 — Dashboard SEO panel
- New collapsible "SEO Description Generation" panel in launch wizard
- Streams pipeline state via `useChat` typed message parts
- Per-platform copy cards with HITL edit + ad-law badges + regenerate
- Final "Publish to DAM" gated on all platforms ≥ GOOD

## D8 — Demo SKU pre-seed
- 3 fishing-rod-themed demos (Carbon telescopic 12ft / Spinning reel 4000 / LED bite alarm 4-pack)
- Full asset set + bilingual descriptions
- Live-demo fallback

---

## Cost budget
| Item | Estimated | Hard cap |
|---|---|---|
| DataForSEO research | $1-3 | $5 |
| OpenAI embeddings | $0.10 | $1 |
| Sonnet description gen | $1-2 | $5 |
| Sonnet compliance scoring | $0.50 | $2 |
| Apify (free credit) | $0 | $5 |
| **Total** | **$3-6** | **$18** |

If actuals exceed $20, stop and reassess.

---

## Order of operations
D1 → D8 in order. D1-D6 autonomous-safe. D7-D8 morning-of polish.
