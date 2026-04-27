# FF Brand Studio — Handoff to New Claude Code Instance

**Last updated:** 2026-04-25
**GitHub:** https://github.com/PeterChen12/ff-brand-studio (public)
**Owner:** Peter Chen (PeterChen12 GitHub, peter@creatorain.com)

---

## TL;DR — What this is

A Faraday Future bilingual (EN/ZH) marketing content pipeline.
- **MCP server** on Cloudflare Workers that Claude Desktop talks to over SSE
- **Next.js dashboard** on Cloudflare Pages where you click "+ New Campaign", paste a press release, and get back: 3 key points + LinkedIn/Weibo posts in EN+ZH + a hero image + a brand-compliance scorecard

Pipeline = Planner (Claude Sonnet) → Copy → Translate → Image (Flux Pro / GPT Image 2) → Brand Guardian (Claude Opus vision) → HITL gate at score < 70 → Postgres DAM publish.

---

## Live Production URLs

| Component | URL | Notes |
|---|---|---|
| Dashboard | https://ff-brand-studio.pages.dev | Cloudflare Pages, static export |
| MCP Server | https://ff-brand-studio-mcp.creatorain.workers.dev | Cloudflare Workers + Hono |
| MCP SSE endpoint | `…/sse` | For Claude Desktop |
| Demo HTTP endpoint | `POST …/demo/run-campaign` | For dashboard form + curl tests |
| R2 public URL | https://pub-db3f39e3386347d58359ba96517eec84.r2.dev | Hero images + infographics |
| Postgres DB | `170.9.252.93:5433/ff_brand_studio` | Same physical server as CreatoRain, separate DB |
| Langfuse traces | https://us.cloud.langfuse.com | All LLM calls traced |

---

## What's done ✅

- [x] Monorepo scaffold (pnpm + Turborepo + Biome + TypeScript strict)
- [x] `packages/types` — Zod schemas for all 6 MCP tools + workflow types
- [x] `packages/brand-rules` — FF brand YAML inlined as TS object (Workers-safe, no `node:fs`)
- [x] `packages/media-clients` — fal.ai + OpenAI + R2 + Anthropic wrappers
- [x] `apps/mcp-server` — 6 MCP tools registered, SSE transport with session registry, full pipeline
  - `run_campaign` — orchestrates whole pipeline
  - `generate_brand_hero` — Flux Pro hero image
  - `generate_bilingual_infographic` — GPT Image 2 (account needs OpenAI org verification)
  - `localize_to_zh` — two-pass Claude Sonnet translation
  - `score_brand_compliance` — Claude Opus 4.7 vision
  - `publish_to_dam` — insert to Postgres
- [x] `apps/mcp-server/src/guardian/` — real Brand Guardian (not stub)
- [x] `apps/mcp-server/src/workflows/` — Planner → Copy → Translate → Image → Video → Guardian → Publish steps
- [x] `apps/mcp-server/src/index.ts` — Worker HTTP routes: `/health`, `/sse`, `/messages`, `/demo/run-campaign`, `/api/assets`, `/api/costs`, `/api/runs`
- [x] `apps/dashboard` — Next.js 15 static export deployed to Pages
  - `/` — overview cards (asset count, campaigns, avg score, total spend)
  - `/campaigns/new` — form to run campaigns from the browser
  - `/assets` — grid view with brand scorecard expansion
  - `/costs` — per-run cost table with Recharts
- [x] Postgres `ff_brand_studio` DB created with `assets` and `run_costs` tables (no pgvector — `brand_knowledge` skipped)
- [x] R2 bucket `ff-brand-studio-assets` with managed public domain enabled
- [x] Cloudflare KV namespace `SESSION_KV` (id `63a0417c93894f988b1293f6909a7e61`) for MCP session state
- [x] 11 secrets uploaded to Worker via `wrangler secret bulk`
- [x] Subdomain `creatorain` registered on workers.dev
- [x] Pages project `ff-brand-studio` created with master branch as production
- [x] Public GitHub repo at https://github.com/PeterChen12/ff-brand-studio
- [x] 6 FF-branded hero images generated and live in R2 (scores 75-84)
- [x] End-to-end campaign verified on production: planner → copy → ZH translate → Flux hero → R2 upload → Guardian score 84 → Postgres write
- [x] Claude Desktop config template at `claude_desktop_config.json`
- [x] **GitHub Actions auto-deploy** — `.github/workflows/deploy.yml` triggers after CI succeeds on push to master, deploys both Worker and Pages in parallel. Verified 2026-04-27 (run id 24978977687).

## What's NOT done yet 🚧

- [ ] **Connect Pages project to GitHub natively** — currently auto-deploy goes via wrangler in our Action. Cloudflare's GitHub integration would give per-PR previews but isn't required.
- [ ] **OpenAI key fix** — current key 401s, need to provision a new one (or pivot infographic to fal.ai's GPT Image 2 endpoint per the user's note)
- [ ] **Video step in production** — Kling 2.6 wired but never run end-to-end (slow, 30-90s polling)
- [ ] **AWS Amplify app `d1a431ll6nyfk4`** — created but unused, can be deleted via `aws amplify delete-app --app-id d1a431ll6nyfk4`
- [ ] **pgvector extension + brand_knowledge table** — RAG-future, server doesn't have pgvector installed
- [ ] **Custom domain on Pages** — currently only `ff-brand-studio.pages.dev`
- [ ] **Better error UI in dashboard** — currently shows raw error strings on the campaign form

---

## Env Setup — Files YOU need to create locally

These three files are **gitignored** — copy values from `creatorain/Claude_Code_Context/.env` (or wherever you keep them):

### 1. `.env` (repo root) — for local dev / scripts

```bash
# AI
ANTHROPIC_API_KEY=sk-ant-api03-...        # CreatoRain .env: ANTHROPIC_API_KEY
OPENAI_API_KEY=sk-svcacct-...             # CreatoRain .env: OPENAI_API_KEY (currently 401, may need refresh)
FAL_KEY=f8346a51-...:fde66365...          # CreatoRain .env: FAL_KEY

# Cloudflare (admin scope — needed for wrangler deploy + Pages deploy)
CLOUDFLARE_ACCOUNT_ID=40595082727ca8581658c1f562d5f1ff
CLOUDFLARE_API_TOKEN=cfat_...             # OR use legacy: CLOUDFLARE_EMAIL + CLOUDFLARE_API_KEY
CLOUDFLARE_EMAIL=peter@creatorain.com
CLOUDFLARE_API_KEY=                       # Global API Key from CreatoRain .env

# R2 (admin scope — token from Cloudflare R2 dashboard)
R2_ACCESS_KEY_ID=                         # from R2 API token creation in Cloudflare dashboard
R2_SECRET_ACCESS_KEY=                     # from R2 API token creation
R2_S3_ENDPOINT=https://40595082727ca8581658c1f562d5f1ff.r2.cloudflarestorage.com
R2_BUCKET=ff-brand-studio-assets
R2_PUBLIC_URL=https://pub-db3f39e3386347d58359ba96517eec84.r2.dev

# Postgres (same server as CreatoRain, NEW database ff_brand_studio)
PGHOST=170.9.252.93
PGPORT=5433
PGDATABASE=ff_brand_studio
PGUSER=postgres
PGPASSWORD=                               # CreatoRain .env: PGPASSWORD

# Langfuse
LANGFUSE_PUBLIC_KEY=pk-lf-...                                  # from Langfuse dashboard (public, less sensitive)
LANGFUSE_SECRET_KEY=sk-lf-...                                  # from Langfuse dashboard
LANGFUSE_BASE_URL=https://us.cloud.langfuse.com

# Dashboard FF_-prefixed vars (for Amplify-compatible setups)
FF_PGHOST=170.9.252.93
FF_PGPORT=5433
FF_PGDATABASE=ff_brand_studio
FF_PGUSER=postgres
FF_PGPASSWORD=                            # same as PGPASSWORD

# Local dev
MCP_URL=http://localhost:8787
ENVIRONMENT=development

# AWS (only needed if you ever pivot back to Amplify)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=                        # CreatoRain .env: AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY=                    # CreatoRain .env: AWS_SECRET_ACCESS_KEY
```

### 2. `apps/mcp-server/.dev.vars` — for `wrangler dev` (local Workers)

```bash
ANTHROPIC_API_KEY=sk-ant-api03-...
OPENAI_API_KEY=sk-svcacct-...
FAL_KEY=f8346a51-...:fde66365...
PGHOST=170.9.252.93
PGPORT=5433
PGDATABASE=ff_brand_studio
PGUSER=postgres
PGPASSWORD=
LANGFUSE_PUBLIC_KEY=pk-lf-...                                  # from Langfuse dashboard (public, less sensitive)
LANGFUSE_SECRET_KEY=sk-lf-...                                  # from Langfuse dashboard
LANGFUSE_BASE_URL=https://us.cloud.langfuse.com
R2_PUBLIC_URL=https://pub-db3f39e3386347d58359ba96517eec84.r2.dev
ENVIRONMENT=development
```

### 3. Production secrets (already set on the deployed Worker)

These are **already uploaded** via `wrangler secret bulk`. To rotate or update, run `wrangler secret put SECRET_NAME` from inside `apps/mcp-server/`. Current production secrets in Worker:
- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `FAL_KEY`
- `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`
- `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`

---

## First-time Setup on the New Machine

```bash
# 1. Clone
git clone https://github.com/PeterChen12/ff-brand-studio.git
cd ff-brand-studio

# 2. Install (pnpm 10+ required; install via `npm i -g pnpm`)
pnpm install

# 3. Create the two env files above (.env and apps/mcp-server/.dev.vars)

# 4. Type-check everything (should be 8/8 green)
pnpm type-check

# 5. Run dashboard locally (uses production Worker for data)
pnpm --filter ff-dashboard run dev
# → http://localhost:3000

# 6. (Optional) Run Worker locally
cd apps/mcp-server
pnpm run dev    # → http://localhost:8787
```

---

## Deploy Commands

```bash
# Worker (after code change in apps/mcp-server/)
cd apps/mcp-server
npx wrangler deploy

# Dashboard (after code change in apps/dashboard/)
cd apps/dashboard
pnpm run build
cd ../mcp-server  # wrangler is installed here
npx wrangler pages deploy ../dashboard/out --project-name ff-brand-studio --branch master --commit-dirty
```

For both, set these env vars first:
```powershell
$env:CLOUDFLARE_EMAIL="peter@creatorain.com"
$env:CLOUDFLARE_API_KEY="<your_global_api_key>"
$env:CLOUDFLARE_ACCOUNT_ID="40595082727ca8581658c1f562d5f1ff"
```

---

## Architecture — Why Each Choice

| Decision | Why |
|---|---|
| Cloudflare Workers (not Vercel/Lambda) | SSE-friendly, no cold start, free tier covers MCP traffic |
| Cloudflare Pages with `output: "export"` | Pages doesn't support Node runtime → can't query Postgres directly → dashboard fetches from Worker `/api/*` |
| Worker owns DB connection | Single source of truth for DAM access; client is pure static |
| Existing Postgres at `170.9.252.93` | Reuses CreatoRain infra, no new managed DB cost |
| Plain TS pipeline (not Mastra DSL) | Mastra `Workflow` API too experimental; plain async chain is type-safe and debuggable |
| Brand Guardian on Claude Opus 4.7 vision | Vision quality essential for color/typography/composition scoring |
| Sonnet 4.6 for copy/translate | Cheaper, EN→ZH quality sufficient |
| Module-level `setScoreFn` injection | Dependency injection so workflow compiles with stub during early dev, swaps to real impl at runtime |
| Session registry (`Map<sessionId, Transport>`) for SSE | Workers are stateless per request, but in-memory state survives within a single isolate's lifetime — good enough for MCP session multiplexing |

---

## Known Gotchas / Footguns

1. **OpenAI key returns 401** — current `sk-svcacct-...` key from CreatoRain is rejected. Either get a fresh key or pivot the infographic step to fal.ai's GPT Image 2 endpoint (the user mentioned it's available there now).
2. **Wrangler `--local` mode uses simulated R2** — uploads go to in-memory storage, NOT real R2. Brand Guardian then fails to fetch the URL → falls back to stub scorecard (75/100). To test full pipeline locally, use `--remote` flag or just hit the deployed Worker.
3. **pgvector not installed on Postgres** — `brand_knowledge` table for future RAG is skipped. The setup script already handles this gracefully.
4. **Windows symlink issue with Next.js standalone** — already worked around by removing `output: "standalone"`. Don't add it back unless you switch hosting target.
5. **CRLF warnings on git operations** — cosmetic only, the `.gitattributes` could be added to silence them.
6. **`gh auth token` returns HTML when piped in PowerShell** — workaround in `scripts/deploy-secrets.ps1` is to use `Out-File` then re-read.
7. **The PG password was accidentally committed to history once** (in `DEPLOY_STATUS.md`) — it was `git commit --amend`-ed out of the initial commit before the repo was made public. History is verified clean. Don't re-add it to any tracked file.
8. **`scripts/secrets.json` was created and deleted during deploy** — it's now in `.gitignore` as a defense-in-depth.

---

## Files the New Claude Code Instance Should Know About

| Path | Purpose |
|---|---|
| `CLAUDE.md` | Working agreement + technical spec (golden rule: one step at a time per `plans/active-plan.md`) |
| `plans/active-plan.md` | Step-by-step build plan with acceptance criteria and test commands |
| `README.md` | User-facing project overview with Mermaid architecture |
| `DEPLOY_STATUS.md` | Snapshot of last deploy state (URLs, IDs) |
| `.claude/settings.json` | Stop hook + PostToolUse prettier + UserPromptSubmit plan-context injection |
| `.claude/hooks/enforce-step-discipline.js` | Stop hook that prevents continuing past one step |
| `.claude/commands/{next,review,commit}.md` | Slash commands for the step-by-step workflow |
| `.claude/agents/implementer.md` | Subagent for parallel-safe discrete tasks |
| `orchestrator.mjs` | Headless `claude -p` orchestrator for autonomous overnight runs |
| `scripts/schema.sql` | Postgres DDL (run once) |
| `scripts/setup-db.mjs` | Idempotent DB setup (creates DB + runs schema, gracefully skips pgvector) |
| `scripts/deploy-secrets.ps1` | Push secrets from `.env` to Worker via `wrangler secret put` |
| `scripts/demo-run.ts` | End-to-end test that hits `/demo/run-campaign` |
| `claude_desktop_config.json` | Drop-in for `%APPDATA%\Claude\` to wire MCP into Claude Desktop |

---

## Memory References (auto-loaded across sessions)

The `memory/` system at `~/.claude/projects/C--Users-zihao/memory/` already has:
- `project_ff_brand_studio.md` — this project's high-level context
- `user_peter_chen.md` — user profile (CreatoRain CEO, etc.)
- `reference_api_keys.md` — index of where each company API key lives

The new instance will load these automatically.

---

## What to Do Next (Recommended Order)

1. **Confirm env files** — populate `.env` and `apps/mcp-server/.dev.vars` from values in this doc
2. **Run `pnpm install` + `pnpm type-check`** — should be 8/8 green
3. **Test local dashboard** — `cd apps/dashboard && pnpm run dev` → click around at localhost:3000
4. **Connect GitHub repo to Cloudflare Pages for auto-deploy** — one click in CF dashboard, then every `git push` rebuilds the dashboard
5. **Decide OpenAI fix path** — either rotate the key or rewrite `packages/media-clients/src/openai.ts` to call fal.ai's GPT Image 2
6. **Optional: install AWS Amplify GitHub App** — only if you want Amplify as a backup hosting option
7. **Optional: add a GitHub Action** — `.github/workflows/deploy.yml` that runs `wrangler deploy` + `wrangler pages deploy` on push to master

---

## One-Line Smoke Tests

```bash
# Health check
curl https://ff-brand-studio-mcp.creatorain.workers.dev/health

# Verify DB connectivity through Worker
curl https://ff-brand-studio-mcp.creatorain.workers.dev/api/costs

# Run a real campaign (takes ~30-45s, costs ~$0.06)
curl -X POST https://ff-brand-studio-mcp.creatorain.workers.dev/demo/run-campaign \
  -H "Content-Type: application/json" \
  -d '{"source_text":"FF 91 2.0 hits 1050 hp, 0-60 in 2.4s, Q3 production ramp.","platforms":["linkedin"],"include_infographic":false,"include_video":false}'
```
