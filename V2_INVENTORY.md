# V2 Inventory — what v1 has, what v2 extends

Generated 2026-04-25 to satisfy `FF_BRAND_STUDIO_V2_ITERATION_PLAN.md` Phase 1 §1.3 acceptance criterion.

This file is the survey of v1's tools, tables, and patterns that the v2 build plan will extend or carry forward unchanged. Read alongside the plan; do not duplicate.

---

## v1 MCP tools (6 total)

All registered in `apps/mcp-server/src/tools/index.ts`. Each is a separate file in `apps/mcp-server/src/tools/`. Input schemas come from `packages/types` (Zod). Wire-in pattern is `register<ToolName>(server, env)`.

| Tool | File | Carries forward in v2? |
|---|---|---|
| `run_campaign` | `tools/run-campaign.ts` | **Stays.** Single-agent ReAct social-content path. v2 adds parallel `launch_product_sku` for product-imagery path; both coexist. |
| `generate_brand_hero` | `tools/generate-brand-hero.ts` | Wraps Flux Pro. v2 keeps and adds `generate_product_white_bg` (Kontext) + `generate_lifestyle_shot` (Nano Banana Pro) as siblings. |
| `generate_bilingual_infographic` | `tools/generate-bilingual-infographic.ts` | GPT Image 2 wrapper, currently 401-blocked per HANDOFF.md. v2 retains and reuses for A+ module generation in §4.2. |
| `localize_to_zh` | `tools/localize-to-zh.ts` | **Direction flipped in v2.** Stays callable for legacy paths; v2 adds `transcreate_zh_to_en_us` (Phase 4 §4.1) as the primary new translation tool for the Chinese-sellers→US framing. |
| `score_brand_compliance` | `tools/score-brand-compliance.ts` | **Extended.** v2 adds a `platform` parameter and composes per-platform compliance scorers (Phase 4 §4.3 / §4.6). |
| `publish_to_dam` | `tools/publish-to-dam.ts` | **Stays unchanged.** Inserts into `assets` table. v2 reuses this rather than writing platform-specific publishers. |

## v1 Postgres tables (3 total — `brand_knowledge` skipped without pgvector)

Defined in two places that must stay in sync:
- `scripts/schema.sql` — DDL, source of truth, idempotent (`CREATE TABLE IF NOT EXISTS`).
- `apps/mcp-server/src/db/schema.ts` — Drizzle TS definitions for query building.

| Table | Purpose | Touched by v2? |
|---|---|---|
| `assets` | Generic DAM record (r2_key, asset_type, campaign, platform, locale, brand_score, metadata jsonb). | **Stays additive.** New v2 tables join via foreign keys; no schema changes to `assets`. |
| `run_costs` | Per-run aggregated cost tracker (gpt_image_2_calls, flux_calls, kling_calls, claude tokens, total_cost_usd). | **Reused.** v2 `launch_runs` joins to it via `run_costs.campaign = launch_runs.id::text` (or we add a launch_run_id column later if join is hot). |
| `brand_knowledge` | Vector embeddings table for future RAG. Skipped on the prod server because pgvector isn't installed. | **Out of scope for v2.** No interaction. |

## v1 patterns to follow when adding v2 tables

1. **Append to `scripts/schema.sql`** with `CREATE TABLE IF NOT EXISTS` — do NOT create a `migrations/` folder. v1 has no migration framework; the project standard is one idempotent schema file replayed via `scripts/setup-db.mjs`. The plan §1.1 mentioned `apps/mcp-server/migrations/` as a placeholder; the actual convention is `scripts/schema.sql`.
2. **Mirror in `apps/mcp-server/src/db/schema.ts`** — add Drizzle `pgTable` definitions matching the SQL exactly. Export `Type = typeof t.$inferSelect; NewType = typeof t.$inferInsert;`.
3. **Apply via `node scripts/setup-db.mjs`** with `PGPASSWORD` set in env. Idempotent — safe to re-run after every schema edit.
4. **Drizzle queries in tools** use `createDbClient(env)` from `db/client.ts`. Connection string comes from env, `ssl: false`, `max: 1` (Workers-friendly).

## v1 packages

| Package | Purpose |
|---|---|
| `packages/types` | Zod schemas for all tool I/O + workflow types. Add v2 schemas here (e.g., `LaunchProductSkuInput`). |
| `packages/brand-rules` | FF brand YAML inlined as a TS object (Workers-safe — no `node:fs`). Per-platform rules, color HEX values. v2 may extend with seller-specific brand voice config, or fork to `packages/seller-brand-rules` for multi-tenant. |
| `packages/media-clients` | Wrappers around fal.ai, OpenAI, R2, Anthropic. v2 adds new model wrappers here: `falNanoBananaPro`, `falFluxKontextPro`, `falFluxLora`, `falFluxLoraTrainer`. Existing `gptImage2`/`fluxPro`/`kling` wrappers are reused. |

## Workflow / orchestration

- v1 uses a plain async chain in `apps/mcp-server/src/workflows/campaign.workflow.ts` (Planner → Copy → Translate → Image → Guardian → Publish). No DSL. Module-level dependency injection via `setScoreFn` for the Brand Guardian.
- **Open question (plan §0.4 / Phase 3):** v2 plan calls for LangGraph orchestrator-worker on Durable Objects. v1 has no LangGraph. **Phase 3 will need explicit human approval before adding LangGraph as a dependency.** Until then, prefer hand-rolled orchestration following the existing `campaign.workflow.ts` pattern.

## Cloudflare bindings (already wired, do not re-provision)

- KV: `SESSION_KV` (id `63a0417c93894f988b1293f6909a7e61`)
- R2: `ff-brand-studio-assets`, public domain on `pub-db3f39e3386347d58359ba96517eec84.r2.dev`
- Postgres: `170.9.252.93:5433` shared with CreatoRain, separate DB `ff_brand_studio`
- 11 secrets uploaded via `wrangler secret bulk`. v2 will need additional secrets only when adopting GPT Image 2 (already there), Nano Banana Pro (uses existing `FAL_KEY`), FLUX.2 LoRA training (existing `FAL_KEY`).

## Build / verify commands

```bash
pnpm install                   # 13s, idempotent
pnpm type-check                # 8/8 green baseline (verified 2026-04-25)
PGPASSWORD=... node scripts/setup-db.mjs   # apply schema (idempotent)
```

Worker dev: `cd apps/mcp-server && pnpm run dev` → `http://localhost:8787`.
Dashboard dev: `pnpm --filter ff-dashboard run dev` → `http://localhost:3000`.

Production smoke tests in `HANDOFF.md` §"One-Line Smoke Tests".

## Plan deltas to flag

The iteration plan was written before this inventory ran. Two corrections to fold back:

1. **Migration folder convention.** Plan §1.1 implied `apps/mcp-server/migrations/`. v1 reality is `scripts/schema.sql` + `scripts/setup-db.mjs`. v2 will follow v1: append to `schema.sql`.
2. **`pnpm db:migrate` command.** Plan §1.3 mentioned this. It doesn't exist. Use `node scripts/setup-db.mjs` with `PGPASSWORD` exported.
