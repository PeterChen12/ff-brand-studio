# FF Brand Studio — Active Plan

**Status legend:** PENDING · IN_PROGRESS · DONE · BLOCKED
**Rule:** Only one step IN_PROGRESS at a time. Update this file at step start and end.
**Orchestrator:** Only runs steps with `Autonomous: YES` and a valid `Test:` command.

---

## Day 1 — Monorepo Foundation

### Step 1.1 — Init monorepo workspace
- **Status:** PENDING
- **Autonomous:** YES
- **Scope:** Create root `package.json` (pnpm workspaces), `pnpm-workspace.yaml`,
  `turbo.json`, `biome.json`, `.gitignore`, `.env.example`. Create directory
  structure: `apps/`, `packages/`, `scripts/`, `logs/`. Do NOT create any app
  code yet.
- **Acceptance:** `pnpm install` succeeds with zero packages installed (empty
  workspaces are fine). `turbo.json` references `build`, `type-check`, `test`
  tasks. Biome config has TypeScript rules enabled.
- **Test:** `node -e "const p=require('./package.json');if(!p.workspaces)throw new Error('no workspaces')"`
- **Do not:** add any AI libraries, create any app code.

### Step 1.2 — packages/types — shared Zod schemas
- **Status:** PENDING
- **Autonomous:** YES
- **Scope:** Create `packages/types/` with `package.json` (name: `@ff/types`),
  `tsconfig.json` (strict, moduleResolution: bundler, composite: true),
  `src/tools.ts` (all 6 tool input schemas + BrandScorecard schema),
  `src/index.ts` (re-exports). Add `"type-check": "tsc --noEmit"` script.
- **Acceptance:** All 6 input schemas exported: `GenerateBrandHeroInput`,
  `GenerateBilingualInfographicInput`, `LocalizeToZhInput`,
  `ScoreBrandComplianceInput`, `PublishToDAMInput`, `RunCampaignInput`.
  `BrandScorecard` Zod schema and `BrandScorecardType` TS type exported.
- **Test:** `pnpm --filter @ff/types run type-check`
- **Do not:** add runtime logic, only type/schema definitions.

### Step 1.3 — packages/brand-rules — FF brand YAML + typed loader
- **Status:** PENDING
- **Autonomous:** YES
- **Scope:** Create `packages/brand-rules/` with `package.json` (name:
  `@ff/brand-rules`), `tsconfig.json`, `ff-brand-rules.yaml` (full FF brand
  rules: colors, typography, logo, imagery, copy, scoring weights),
  `src/index.ts` (YAML loader using `yaml` npm package, exports `brandRules`
  const and `BrandRules` type).
- **Acceptance:** `brandRules.colors.primary_blue` equals `"#1C3FAA"`.
  `brandRules.scoring.pass_threshold` equals `70`. `brandRules.scoring.weights`
  sums to `1.0`.
- **Test:** `pnpm --filter @ff/brand-rules run type-check`

### Step 1.4 — packages/media-clients — fal, openai, r2, anthropic wrappers
- **Status:** PENDING
- **Autonomous:** YES
- **Scope:** Create `packages/media-clients/` (name: `@ff/media-clients`).
  Four source files: `src/fal.ts` (`generateHeroImage`, `generateVideo`,
  `pollVideo`), `src/openai.ts` (`generateBilingualInfographic`),
  `src/r2.ts` (`uploadToR2` — takes `R2Bucket` binding, key, ArrayBuffer,
  contentType), `src/anthropic.ts` (`createAnthropicClient`,
  `createLangfuse`). `src/index.ts` re-exports all. No API calls — just typed
  wrappers that read credentials from params (not process.env directly).
- **Acceptance:** All functions exported with correct TypeScript signatures.
  `generateHeroImage` returns `Promise<{ url: string; seed: number }>`.
  `generateBilingualInfographic` returns `Promise<{ b64: string }>`.
  `uploadToR2` takes `(bucket: R2Bucket, key: string, data: ArrayBuffer, contentType: string) => Promise<string>`.
- **Test:** `pnpm --filter @ff/media-clients run type-check`

---

## Day 2 — MCP Server Core

### Step 2.1 — apps/mcp-server scaffold
- **Status:** PENDING
- **Autonomous:** YES
- **Scope:** Create `apps/mcp-server/` with: `package.json` (name:
  `ff-mcp-server`, deps: `@modelcontextprotocol/sdk`, `hono`, `zod`,
  `drizzle-orm`, `postgres`; devDeps: `wrangler`, `@cloudflare/workers-types`,
  `typescript`), `wrangler.toml` (name: `ff-brand-studio-mcp`, R2 + KV
  bindings), `tsconfig.json` (strict, target ES2022), `src/index.ts` (Hono
  app with `/sse`, `/messages`, `/health` routes), `src/types/bindings.d.ts`
  (CloudflareBindings interface with all env vars).
- **Acceptance:** TypeScript compiles without errors. `src/index.ts` imports
  `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js` and `SSEServerTransport`.
  `CloudflareBindings` interface has: `R2: R2Bucket`, `SESSION_KV: KVNamespace`,
  and all string env var fields.
- **Test:** `pnpm --filter ff-mcp-server run type-check`

### Step 2.2 — Tool: generate_brand_hero
- **Status:** PENDING
- **Autonomous:** YES
- **Scope:** Create `apps/mcp-server/src/tools/generate-brand-hero.ts`.
  Register with `server.tool("generate_brand_hero", GenerateBrandHeroInput.shape, handler)`.
  Handler: build prompt from params, call `generateHeroImage` from
  `@ff/media-clients/fal`, fetch buffer from URL, upload to R2 via
  `uploadToR2`, return JSON with `r2_key`, `image_url`, `seed`, `prompt`.
  R2 key format: `heroes/{timestamp}-{seed}.jpg`.
- **Acceptance:** Tool function compiles. Handler returns
  `{ content: [{ type: "text", text: JSON.stringify({...}) }] }`.
  Prompt builds correctly for `FF91` + `dramatic` mood.
- **Test:** `pnpm --filter ff-mcp-server run type-check`

### Step 2.3 — Tool: generate_bilingual_infographic
- **Status:** PENDING
- **Autonomous:** YES
- **Scope:** Create `apps/mcp-server/src/tools/generate-bilingual-infographic.ts`.
  Build GPT Image 2 prompt that specifies exact layout: dark navy gradient
  background, EN title in Inter 48px white, ZH title in Source Han Sans SC
  32px `#00A8E8`, numbered content blocks with EN white + ZH `#00A8E8`, gold
  accent line `#C9A84C` at bottom. Call `generateBilingualInfographic` from
  `@ff/media-clients/openai`, decode base64, upload to R2 as PNG.
  R2 key format: `infographics/{timestamp}.png`.
- **Acceptance:** Tool compiles. Prompt template includes all 5 color values.
  Returns `{ content: [{ type: "text", text: JSON.stringify({r2_key, image_url, prompt_used}) }] }`.
- **Test:** `pnpm --filter ff-mcp-server run type-check`

### Step 2.4 — Tool: localize_to_zh
- **Status:** PENDING
- **Autonomous:** YES
- **Scope:** Create `apps/mcp-server/src/tools/localize-to-zh.ts`.
  Two-pass translation using Claude Sonnet (no DashScope).
  Pass 1: translate with luxury automotive ZH marketing system prompt.
  Pass 2: review with "native ZH marketing editor" persona.
  Platform rules: LinkedIn = 书面语, Weibo = ≤140 chars conversational.
  Preserve: `FF91`, `FF81`, `FF71`, `FFID`, `FARADAY FUTURE` in original case.
  Returns `{ translation: string, reviewed: string, platform: string }`.
- **Acceptance:** Tool compiles. System prompt includes platform rules for all
  4 platforms. Technical terms list is preserved. Both passes use
  `claude-sonnet-4-6` model.
- **Test:** `pnpm --filter ff-mcp-server run type-check`

### Step 2.5 — Tools: score_brand_compliance (stub) + publish_to_dam
- **Status:** PENDING
- **Autonomous:** YES
- **Scope:**
  `score-brand-compliance.ts`: Stub that returns a placeholder scorecard
  with `overall_score: 0`, `pass: false`, and a message: "Brand Guardian not
  yet wired. Implement Step 5.1 to activate."
  `publish-to-dam.ts`: Full implementation — connects to Postgres via Drizzle,
  inserts row into `assets` table, returns confirmation with mock LinkedIn/Weibo
  preview object `{ platform_previews: { linkedin: {...}, weibo: {...} } }`.
  Use `postgres` driver to connect: URL constructed from PGHOST/PGPORT/etc.
- **Acceptance:** Both tools compile. `publish_to_dam` imports Drizzle schema
  from `src/db/schema.ts` (to be created in this step). DB schema file defines
  `assets` table matching Postgres schema.
- **Test:** `pnpm --filter ff-mcp-server run type-check`

### Step 2.6 — Tool: run_campaign (stub) + registerAllTools
- **Status:** PENDING
- **Autonomous:** YES
- **Scope:**
  `run-campaign.ts`: Stub that returns `{ message: "Campaign workflow not yet
  wired. Implement Step 3.1 to activate.", source_text_length: number }`.
  `tools/index.ts`: `registerAllTools(server, env)` that imports and registers
  all 6 tools.
  `src/index.ts`: Update to call `registerAllTools(server, env)` in the SSE
  handler.
- **Acceptance:** `registerAllTools` calls all 6 tool registration functions.
  `src/index.ts` compiles without errors. No circular imports.
- **Test:** `pnpm --filter ff-mcp-server run type-check`

---

## Day 3 — Mastra Orchestrator

### Step 3.1 — Mastra workflow: planner + copy steps
- **Status:** PENDING
- **Autonomous:** YES
- **Scope:** Install `@mastra/core`. Create
  `src/workflows/campaign.workflow.ts` (Mastra Workflow skeleton with 7 steps
  chained). Create `src/workflows/steps/planner.ts`: calls Claude Sonnet with
  the planner system prompt (3 key points extraction), returns structured JSON.
  Create `src/workflows/steps/copy.ts`: writes EN LinkedIn draft + EN Weibo
  draft from planner output. Create `src/workflows/prompts/planner.md`
  (system prompt file, loaded at runtime with `readFileSync`).
- **Acceptance:** Workflow compiles. `plannerStep` has correct input/output
  Zod schemas. `copyStep` consumes planner output. No runtime API calls in
  this step — only code structure.
- **Test:** `pnpm --filter ff-mcp-server run type-check`

### Step 3.2 — Mastra workflow: translate + image + video steps
- **Status:** PENDING
- **Autonomous:** YES
- **Scope:**
  `src/workflows/steps/translate.ts`: calls `localize-to-zh` logic (reuse
  Anthropic client, CN system prompt) for LinkedIn and Weibo drafts.
  `src/workflows/steps/image.ts`: calls `generateHeroImage` (Flux) for hero
  shot + `generateBilingualInfographic` (GPT Image 2) if
  `include_infographic: true`. Uploads to R2. Returns array of asset objects.
  `src/workflows/steps/video.ts`: submits Kling job via `generateVideo`,
  polls with `pollVideo` every 5s up to 90s, returns video URL or null on
  timeout.
- **Acceptance:** All 3 step files compile. Image step correctly handles both
  hero + infographic with proper R2 keys. Video step implements polling with
  `setInterval`/`clearInterval` or `setTimeout` loop.
- **Test:** `pnpm --filter ff-mcp-server run type-check`

### Step 3.3 — Mastra workflow: guardian + HITL + publish steps
- **Status:** PENDING
- **Autonomous:** YES
- **Scope:**
  `src/workflows/steps/guardian.ts`: calls `scoreBrandCompliance` from
  `src/guardian/index.ts` (stub for now — returns placeholder scorecard). Runs
  on each asset from image step output.
  `src/workflows/steps/hitl.ts`: if any asset `brand_score < 70`, suspends
  workflow and returns an interrupt result with full scorecard to Claude Desktop.
  Otherwise passes through.
  `src/workflows/steps/publish.ts`: calls `publish_to_dam` logic for each
  approved asset, logs to `run_costs` table.
  Wire all steps in `campaign.workflow.ts` with `.step().then().then()...`.
- **Acceptance:** Full workflow chain compiles end-to-end. `hitlStep` correctly
  checks score threshold. `run_campaign` tool updated to call
  `campaignWorkflow.execute(params)` instead of returning stub message.
- **Test:** `pnpm --filter ff-mcp-server run type-check`

### Step 3.4 — Langfuse tracing integration
- **Status:** PENDING
- **Autonomous:** YES
- **Scope:** Create `src/lib/langfuse.ts` — singleton factory that returns a
  Langfuse client (reads `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`,
  `LANGFUSE_BASE_URL` from env). Wrap all Claude API calls in all workflow
  steps with `langfuse.trace()` → `trace.span()` → `span.end()`. Call
  `langfuse.flushAsync()` at end of `runStep`. Add Langfuse types to
  CloudflareBindings.
- **Acceptance:** Every Anthropic `messages.create()` call in the codebase
  is wrapped in a Langfuse span. `flushAsync()` is called once per workflow
  run. No new TypeScript errors.
- **Test:** `pnpm --filter ff-mcp-server run type-check`

### Step 3.5 — Brand KB seeder script
- **Status:** PENDING
- **Autonomous:** YES
- **Scope:** Create `scripts/seed-brand-kb.ts`. Hardcode 10 FF press release
  URLs (use real prnewswire.com/businesswire.com URLs that are publicly
  accessible). For each: fetch text, chunk into ~500-token segments
  (split by paragraph, max 500 words), embed with OpenAI
  `text-embedding-3-small`, upsert to Postgres `brand_knowledge` table.
  Use `postgres` npm package directly (not Drizzle — simpler for a script).
  Add `"seed": "tsx scripts/seed-brand-kb.ts"` script to root `package.json`.
- **Acceptance:** Script has all 10 hardcoded URLs. Chunking logic splits text
  correctly. Postgres upsert uses `ON CONFLICT (id) DO UPDATE`. Script does
  NOT auto-run — only when user executes it manually.
- **Test:** `node -e "require('./scripts/seed-brand-kb.ts')" 2>&1 | head -1 || npx tsx --check scripts/seed-brand-kb.ts`

---

## Day 4 — Brand Guardian

### Step 4.1 — Brand Guardian vision scorer (MANUAL REVIEW REQUIRED)
- **Status:** PENDING
- **Autonomous:** NO
- **Scope:** Create `apps/mcp-server/src/guardian/index.ts` — full Brand
  Guardian implementation using Claude Opus 4.7 vision. Load brand rules
  YAML, build structured scoring prompt, call Claude with image URL + copy,
  parse JSON scorecard, validate with `BrandScorecard` Zod schema, compute
  `overall_score` as weighted average. Replace stub in
  `score_brand_compliance` tool with real implementation.
- **Acceptance:** `scoreBrandCompliance({assetUrl, assetType})` returns a
  valid `BrandScorecardType`. Overall score is computed from dimension weights
  in `ff-brand-rules.yaml`. `pass` field correctly reflects `score >= 70`.
- **Test:** `pnpm --filter ff-mcp-server run type-check`
- **Why NO:** Vision-LLM scoring requires human calibration of the scoring
  prompt. A mistuned prompt silently gives wrong scores — must be reviewed.

### Step 4.2 — Wire Brand Guardian into workflow
- **Status:** PENDING
- **Autonomous:** YES
- **Scope:** Update `src/workflows/steps/guardian.ts` to call the real
  `scoreBrandCompliance` (replacing the placeholder stub). Update
  `score_brand_compliance` MCP tool to call the real implementation.
  Add error handling: if vision call fails, return a `500`-level scorecard
  with a clear error message rather than crashing the workflow.
- **Acceptance:** `guardianStep` calls `scoreBrandCompliance` for each asset.
  `score_brand_compliance` MCP tool returns real BrandScorecard JSON.
  Workflow correctly suspends on HITL when score < 70.
- **Test:** `pnpm --filter ff-mcp-server run type-check`
- **Depends on:** Step 4.1 DONE

---

## Day 5 — Dashboard

### Step 5.1 — Next.js 15 dashboard scaffold
- **Status:** PENDING
- **Autonomous:** YES
- **Scope:** Create `apps/dashboard/` with: `package.json` (name:
  `ff-dashboard`), `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`
  (FF brand colors: `ff.blue`, `ff.electric`, `ff.black`, `ff.gold`),
  `components.json` (shadcn config), `amplify.yml` (WEB_COMPUTE build spec),
  `src/app/layout.tsx`, `src/app/page.tsx` (nav with links to /assets and
  /costs). Install: `next`, `react`, `react-dom`, `drizzle-orm`, `postgres`,
  `recharts`, `langfuse`. Run `shadcn init` equivalent config.
- **Acceptance:** `pnpm --filter ff-dashboard run type-check` passes.
  `next.config.ts` exists. `tailwind.config.ts` includes FF brand colors.
  `amplify.yml` specifies `WEB_COMPUTE` platform with pnpm commands.
- **Test:** `pnpm --filter ff-dashboard run type-check`

### Step 5.2 — Drizzle schema + DB client for dashboard
- **Status:** PENDING
- **Autonomous:** YES
- **Scope:** Create `apps/dashboard/src/db/schema.ts` (Drizzle table
  definitions mirroring `assets` and `run_costs` Postgres tables).
  Create `apps/dashboard/src/db/client.ts` (singleton Drizzle client using
  `postgres` driver, URL from env vars, `ssl: false` since internal server).
- **Acceptance:** Both tables defined with correct Drizzle column types.
  `client.ts` exports `db` as the Drizzle instance. Compiles without errors.
- **Test:** `pnpm --filter ff-dashboard run type-check`

### Step 5.3 — Asset library page
- **Status:** PENDING
- **Autonomous:** YES
- **Scope:** Create `src/app/assets/page.tsx` (server component, queries
  `assets` table via Drizzle). Create `src/components/asset-card.tsx` (shows
  thumbnail, brand score badge, platform tag, locale tag). Score badge color:
  green ≥85, yellow 70–84, red <70. Create `src/app/assets/[id]/page.tsx`
  (asset detail page with full metadata JSON).
- **Acceptance:** Page renders asset grid. `asset-card` component uses shadcn
  `Card` + `Badge`. Score badge correctly maps score ranges to colors.
- **Test:** `pnpm --filter ff-dashboard run build`

### Step 5.4 — BrandScorecard radar chart component
- **Status:** PENDING
- **Autonomous:** YES
- **Scope:** Create `src/components/brand-scorecard.tsx` — client component.
  Recharts `RadarChart` with 5 axes: Color, Typography, Logo, Image Quality,
  Copy Tone. Violations list with colored `Badge` per severity (critical=red,
  warning=yellow, info=blue). Suggestions list. Overall score ring using
  `RadialBarChart`. Props: `scorecard: BrandScorecardType`.
- **Acceptance:** Component renders without TypeScript errors. Uses
  `"use client"` directive. Imports `BrandScorecardType` from `@ff/types`.
- **Test:** `pnpm --filter ff-dashboard run type-check`

### Step 5.5 — Cost tracker page
- **Status:** PENDING
- **Autonomous:** YES
- **Scope:** Create `src/app/costs/page.tsx` (server component). Summary
  card: total this week, last run cost. Table of recent `run_costs` rows with
  breakdown by provider. Hardcode cost constants: GPT Image 2 = $0.09/image,
  Flux Pro = $0.055/image, Kling 5s = $0.18/video, Claude Opus vision =
  $0.018/scorecard. Show computed totals.
- **Acceptance:** Page compiles. Queries `run_costs` with `orderBy(desc)`.
  Cost summary card shows week total.
- **Test:** `pnpm --filter ff-dashboard run build`

---

## Day 6 — Scripts, Polish, README

### Step 6.1 — schema.sql + demo-run.ts + .env.example
- **Status:** PENDING
- **Autonomous:** YES
- **Scope:**
  `scripts/schema.sql`: The full Postgres DDL (pgvector extension + 3 tables).
  `scripts/demo-run.ts`: Hardcode 200-word YT Jia investor update placeholder.
  Import and call the Mastra campaign workflow directly (not via MCP). Print
  results to console.
  `.env.example`: All env vars with blank values + comments explaining each.
  `claude_desktop_config.template.json`: Template for Claude Desktop config.
- **Acceptance:** All 4 files exist. `demo-run.ts` imports from
  `apps/mcp-server/src/workflows/campaign.workflow.ts`. `.env.example` has
  all 14 env var keys.
- **Test:** `node -e "const fs=require('fs');['scripts/schema.sql','scripts/demo-run.ts','.env.example','claude_desktop_config.template.json'].forEach(f=>{if(!fs.existsSync(f))throw new Error(f+' missing')})"`

### Step 6.2 — README + architecture diagram + Loom script
- **Status:** PENDING
- **Autonomous:** YES
- **Scope:** Write `README.md` with: project overview (1 paragraph),
  architecture Mermaid diagram (Claude Desktop → Workers → Mastra → fal.ai +
  GPT Image 2 + Kling → R2 → Amplify dashboard), prerequisites list,
  Day-1 setup commands, demo walkthrough (verbatim commands for the interview),
  decision log (why Amplify over Vercel, why existing Postgres over Supabase,
  why Claude Sonnet for ZH over DashScope).
  Write `scripts/loom-script.md`: 4-minute Loom recording script with time
  markers (0:00 intro, 0:30 Claude Desktop demo, 2:00 dashboard walkthrough,
  3:00 brand guardian score, 3:30 closing).
- **Acceptance:** `README.md` has Mermaid diagram block. Decision log has
  3 entries. Loom script has time markers.
- **Test:** `node -e "const fs=require('fs');if(!fs.existsSync('README.md'))throw new Error('README missing')"`

---

## Classification Summary

| Step | Title | Autonomous | Reason |
|------|-------|------------|--------|
| 1.1 | Init monorepo workspace | YES | Pure config/scaffold, no API calls |
| 1.2 | packages/types | YES | Type-only, no runtime |
| 1.3 | packages/brand-rules | YES | YAML + typed loader only |
| 1.4 | packages/media-clients | YES | Typed wrappers, no API calls |
| 2.1 | MCP server scaffold | YES | Config + boilerplate only |
| 2.2 | Tool: generate_brand_hero | YES | Pure code, no live API calls |
| 2.3 | Tool: generate_bilingual_infographic | YES | Pure code, no live API calls |
| 2.4 | Tool: localize_to_zh | YES | Pure code, no live API calls |
| 2.5 | Tools: score stub + publish_to_dam | YES | Stub + DB write code only |
| 2.6 | Tool: run_campaign + registerAllTools | YES | Wiring only |
| 3.1 | Mastra: planner + copy steps | YES | Code structure, no API calls |
| 3.2 | Mastra: translate + image + video | YES | Code structure, no API calls |
| 3.3 | Mastra: guardian + HITL + publish | YES | Wiring only |
| 3.4 | Langfuse tracing | YES | Instrumentation code only |
| 3.5 | Brand KB seeder | YES | Script only, not executed |
| 4.1 | Brand Guardian vision scorer | **NO** | Vision-LLM prompt needs human tuning |
| 4.2 | Wire Brand Guardian into workflow | YES | Wiring (depends on 4.1 DONE) |
| 5.1 | Next.js dashboard scaffold | YES | Config + layout boilerplate |
| 5.2 | Drizzle schema + DB client | YES | Schema mirroring, no API calls |
| 5.3 | Asset library page | YES | Server component + Drizzle query |
| 5.4 | BrandScorecard radar chart | YES | UI component, no API calls |
| 5.5 | Cost tracker page | YES | Server component + math |
| 6.1 | schema.sql + demo-run + .env.example | YES | File writes, no API calls |
| 6.2 | README + diagram + Loom script | YES | Documentation writing |
