# FF Brand Studio — Deploy Status

**Deployed:** 2026-04-24

## ✅ Production MCP Server (LIVE)

- **URL:** https://ff-brand-studio-mcp.creatorain.workers.dev
- **Health:** https://ff-brand-studio-mcp.creatorain.workers.dev/health
- **SSE endpoint for Claude Desktop:** `/sse`
- **Worker ID:** `ff-brand-studio-mcp`
- **KV namespace:** `63a0417c93894f988b1293f6909a7e61` (SESSION_KV)
- **R2 bucket:** `ff-brand-studio-assets` with public URL `https://pub-db3f39e3386347d58359ba96517eec84.r2.dev`
- **Secrets:** 11/11 uploaded (Anthropic, OpenAI, fal, Postgres, Langfuse)

### Verified end-to-end on production
```
POST /demo/run-campaign
→ Planner (Claude Sonnet 4.6) → 3 key points EN/ZH
→ Copy → refined LinkedIn + Weibo EN
→ Translate → LinkedIn + Weibo ZH
→ Image → Flux Pro hero image → R2 (REAL upload, 74KB JPEG)
→ Guardian → Claude Opus 4.7 brand scorecard
→ Publish → Postgres DAM row
```

## ✅ Database (LIVE)

- **Host:** 170.9.252.93:5433 (same as CreatoRain, new DB `ff_brand_studio`)
- **Tables:** `assets`, `run_costs`
- **Schema:** `scripts/schema.sql`

## ⏸️ Dashboard (Amplify app created, GitHub connection needed)

- **Amplify app:** `d1a431ll6nyfk4`
- **Future URL:** `https://main.d1a431ll6nyfk4.amplifyapp.com`
- **Setup needed (click-through):**
  1. Push this repo to GitHub
  2. AWS Amplify console → app `ff-brand-studio-dashboard` → Host web app → Connect repo
  3. Set build spec to `apps/dashboard/amplify.yml`
  4. Add env vars: `FF_PGHOST=170.9.252.93`, `FF_PGPORT=5433`, `FF_PGDATABASE=ff_brand_studio`, `FF_PGUSER=postgres`, `FF_PGPASSWORD=your_pg_password_here`
  5. Deploy

Or run locally any time:
```powershell
cd apps/dashboard
$env:FF_PGPASSWORD="your_pg_password_here"
pnpm run dev
# → http://localhost:3000
```

## 🔌 Use It Now (Claude Desktop)

Copy `claude_desktop_config.json` to:
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Mac:** `~/Library/Application Support/Claude/claude_desktop_config.json`

Restart Claude Desktop, then in a new chat:
> "Use ff-brand-studio to run a campaign for the new FF 91 2.0 launch announcement: 1050 horsepower, 0-60 in 2.4 seconds, Q3 production ramp for China and North America."

Claude Desktop will call `run_campaign` on your Worker → full pipeline runs → you get back 3 key points, bilingual LinkedIn + Weibo posts, a hero image on R2, a brand score, and the asset gets logged to Postgres.

## 🛠️ All 6 MCP Tools Available in Claude Desktop

- `run_campaign` — full pipeline (recommended)
- `generate_brand_hero` — one hero image
- `generate_bilingual_infographic` — one bilingual infographic
- `localize_to_zh` — EN→ZH two-pass translation
- `score_brand_compliance` — Claude Opus vision scoring
- `publish_to_dam` — write to Postgres DAM

## 📊 Observability

- **Langfuse dashboard:** https://us.cloud.langfuse.com (all LLM calls traced)
- **Cloudflare Workers logs:** https://dash.cloudflare.com/40595082727ca8581658c1f562d5f1ff/workers/services/view/ff-brand-studio-mcp
