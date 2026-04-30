# FF Brand Studio — Working Agreement

You are building a 7-day interview project: an MCP server + Next.js 15 dashboard
for bilingual EN/ZH marketing content generation.
Stack: TypeScript, @modelcontextprotocol/sdk, Mastra, fal.ai (Flux + Kling),
OpenAI GPT Image 2, Cloudflare Workers + R2 + KV, Postgres (pgvector),
Drizzle ORM, shadcn/ui, AWS Amplify, Langfuse.

## The golden rule: one step at a time

The file `plans/active-plan.md` is the source of truth. Every step has acceptance
criteria and a test command.

**Protocol:**
1. When invoked, read `plans/active-plan.md`.
2. Identify the SINGLE next PENDING step.
3. Execute ONLY that step. Do not read ahead or start the next one.
4. Run the step's test command. Fix failures before claiming completion.
5. When acceptance criteria are met, report completion and STOP.
6. The user runs `/review` → `/commit` → `/next`.

**If you finish a step, stop. Do not auto-continue to the next step.**

## Tool boundaries per step

- Each step ≤ 20 minutes of work. If a step feels bigger, STOP and propose
  splitting it in the plan file first.
- Never combine WebFetch with large file writes in the same step.
- After any file edit, run the step's test command. Fix before moving on.

## Subagent delegation

- Use the `Explore` subagent for research that would flood context.
- For parallel-safe discrete tasks, spawn the `implementer` agent.
- Set `CLAUDE_CODE_SUBAGENT_MODEL=claude-sonnet-4-6` so subagents run on Sonnet.

## Commit discipline

- Conventional commits. One commit per step. Never commit on your own —
  tell the user to run `/commit`.
- Never amend or force-push without explicit instruction.

---

# Technical Specification

## Stack Decisions (final — do not re-debate)

| Layer | Choice |
|---|---|
| MCP server | Cloudflare Workers, SSE transport, Hono |
| Asset storage | Cloudflare R2, bucket: `ff-brand-studio-assets` |
| Session cache | Cloudflare Workers KV |
| Dashboard hosting | AWS Amplify WEB_COMPUTE (same account as CreatoRain) |
| Database | Postgres at `170.9.252.93:5433`, db: `ff_brand_studio` |
| ORM | Drizzle ORM + `postgres` driver |
| Photoreal image | fal.ai → `fal-ai/flux-pro/v1.1` |
| Typography image | OpenAI → `gpt-image-2` (requires org verification) |
| Video | fal.ai → `fal-ai/kling-video/v2.1/pro/image-to-video` (polling) |
| Copy + ZH translation | Claude Sonnet 4.6 (existing `ANTHROPIC_API_KEY`) |
| Brand Guardian | Claude Opus 4.7 vision (existing `ANTHROPIC_API_KEY`) |
| Orchestration | Mastra (`@mastra/core`) |
| Observability | Langfuse cloud free tier |
| Publishing | MOCK — writes to Postgres DAM + returns preview card |

## Workspace Package Names

| Path | Name |
|---|---|
| `packages/types` | `@ff/types` |
| `packages/brand-rules` | `@ff/brand-rules` |
| `packages/media-clients` | `@ff/media-clients` |
| `apps/mcp-server` | `ff-mcp-server` |
| `apps/dashboard` | `ff-dashboard` |

Every `package.json` must include `"type-check": "tsc --noEmit"` in scripts.

## Environment Variables

```bash
# Copy from CreatoRain .env
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
FAL_KEY=
CLOUDFLARE_ACCOUNT_ID=

# New — from manual setup
CLOUDFLARE_API_TOKEN=        # scoped Workers+R2 token
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=ff-brand-studio-assets

# Postgres — same server, new database ff_brand_studio
PGHOST=170.9.252.93
PGPORT=5433
PGDATABASE=ff_brand_studio
PGUSER=postgres
PGPASSWORD=

# Langfuse
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
LANGFUSE_BASE_URL=https://cloud.langfuse.com
```

## Postgres Schema (run once manually)

```sql
create extension if not exists vector;
create table assets (
  id uuid primary key default gen_random_uuid(),
  r2_key text not null unique,
  asset_type text not null,
  campaign text, platform text, locale text,
  brand_score integer, metadata jsonb,
  created_at timestamptz default now()
);
create table brand_knowledge (
  id uuid primary key default gen_random_uuid(),
  source_url text not null, chunk_text text not null,
  embedding vector(1536), created_at timestamptz default now()
);
create index on brand_knowledge using ivfflat (embedding vector_cosine_ops) with (lists = 50);
create table run_costs (
  id uuid primary key default gen_random_uuid(),
  campaign text, run_at timestamptz default now(),
  gpt_image_2_calls integer default 0, flux_calls integer default 0,
  kling_calls integer default 0,
  claude_input_tokens integer default 0, claude_output_tokens integer default 0,
  total_cost_usd numeric(10,4)
);
```

## Quality Gates (every step must pass)

- `pnpm type-check` on the affected package: zero TypeScript errors
- Biome lint: `pnpm biome check .`
- No `any` types — use `unknown` + Zod at all API boundaries
- Secrets only from `process.env` / Cloudflare `env` bindings — never hardcoded

## Known Constraints

- Workers KV: all reads/writes must be `await`ed
- GPT Image 2: needs OpenAI org verification (manual, Peter does this)
- Kling video: async polling, 5s intervals, 90s max timeout
- Weibo/LinkedIn publishing: mocked — write to Postgres, return preview
- Drizzle: construct Postgres URL from PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD
- Amplify: blocks env vars starting with `AWS_` — use different prefix
- Brand Guardian (Step 5.1): NOT safe for overnight autonomous execution

---

# Automated Production Workflow (v2 ecommerce pivot)

The "one step at a time / wait for /commit" protocol above is the v1 interview
pattern. v2 iteration sessions ship multi-issue PRs with this routine
**without prompting**:

## Production deploy chain

| Surface | Trigger | Command |
|---|---|---|
| Dashboard (Cloudflare Pages) | `git push origin master` | (auto-deploys) |
| MCP Worker (Cloudflare Workers) | manual `wrangler deploy` | `cd apps/mcp-server && pnpm run deploy` |

Both are pre-authorized in `.claude/settings.local.json`. **Do not ask before
running them** when the user says "ship it" / "move forward to production" /
"deploy". They are routine operations, not destructive ones.

## Quality gates (always run before push)

In order, all from the affected app's directory:
1. `pnpm type-check` — zero errors
2. `pnpm build` — must produce static export (dashboard) or pass tsc (worker)
3. `pnpm test` — worker only; expect 53/53 passing as baseline

If any gate fails, fix before pushing. Do not push broken code to bypass.

## Migration runners

Drizzle migrations are NOT auto-applied on worker deploy. When a `.sql` file
lands in `apps/mcp-server/drizzle/`, write a one-shot runner under `scripts/`
(model: `scripts/apply-product-description-migration.mjs`) and run it
manually with the local `.env`. Required env: PGHOST PGPORT PGUSER
PGPASSWORD PGDATABASE — sourced from `creatorain/Claude_Code_Context/.env`.

## When to STILL ask the user

- Anything destructive: `git reset --hard`, `git push --force`, `rm -rf`,
  `DROP TABLE`, `wrangler delete`, secret rotation.
- Schema changes that aren't backwards-compatible.
- Touching billing / Clerk org config.
- Deploying outside this repo (e.g. CreatoRain).
- Any time live customer data could be affected.
