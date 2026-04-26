# API Contract — dashboard ↔ Worker

The single source of truth for the dashboard's view of the Worker. Schemas live in `packages/types/src/api.ts` (Zod); both sides import from `@ff/types`.

If we ever split this monorepo, `@ff/types` becomes the only thing that has to be a published npm package. The boundary is already that clean.

---

## Endpoints (all `https://ff-brand-studio-mcp.creatorain.workers.dev`)

### `GET /health`

Production health check. Returns 200 on `ok` or `degraded`; 503 on hard `error`.

```json
{
  "status": "ok" | "degraded" | "error",
  "server": "ff-brand-studio-mcp",
  "version": "0.2.0",
  "environment": "production",
  "checks": {
    "db": "ok" | "timeout" | "error",
    "anthropic_key": "set" | "missing",
    "fal_key": "set" | "missing",
    "openai_key": "set" | "missing",
    "langfuse_public_key": "set" | "missing",
    "r2_public_url": "set" | "missing"
  },
  "ping_ms": 42,
  "timestamp": "2026-04-26T..."
}
```

DB ping has a 1s timeout; on miss, status drops to `degraded` (not `error`) so a hung Postgres doesn't fail Cloudflare's edge health checks.

---

### `GET /api/assets`

Most recent 50 asset rows (DAM publish-to-DAM output). Schema: `ApiAssetsResponse`.

```json
{
  "assets": [
    {
      "id": "uuid",
      "r2Key": "heroes/...",
      "assetType": "hero_image" | "infographic" | ...,
      "campaign": "string | null",
      "platform": "string | null",
      "locale": "string | null",
      "brandScore": 0-100 | null,
      "metadata": { /* tool-specific */ },
      "createdAt": "ISO 8601 string | null"
    }
  ]
}
```

On error, returns `{"assets": []}` with HTTP 200 (UI-tolerant; doesn't break dashboard render).

---

### `GET /api/runs`

Most recent 30 run_costs rows. Schema: `ApiRunsResponse`.

```json
{
  "runs": [
    {
      "id": "uuid",
      "campaign": "string | null",
      "runAt": "ISO 8601 string | null",
      "gptImage2Calls": 0,
      "fluxCalls": 0,
      "klingCalls": 0,
      "claudeInputTokens": 0,
      "claudeOutputTokens": 0,
      "totalCostUsd": "0.0000"  // numeric serialized as string
    }
  ]
}
```

`totalCostUsd` comes from Postgres `numeric(10,4)` → serialized as a string by drizzle. Convert with `parseFloat(row.totalCostUsd ?? "0")` on the dashboard side.

---

### `GET /api/costs`

Aggregated cost totals (single row, sum across all `run_costs`). Schema: `ApiCostsResponse`.

```json
{
  "totalSpend": 0.33,    // sum(total_cost_usd) cast to number
  "runs": 9,             // count(*)
  "totalFlux": 6,        // sum(flux_calls)
  "totalGpt": 0,         // sum(gpt_image_2_calls)
  "totalKling": 0        // sum(kling_calls)
}
```

---

## Stability commitments

- **Additive-only changes** without a major version bump. Adding a new optional field is fine; renaming or removing one is a breaking change and requires bumping `version` in `/health` to `1.0.0`.
- **Schema lives in `@ff/types`.** Do NOT define response shapes inline in Worker handlers — import the type. The exception is internal v2 tools (launch_product_sku etc) which are MCP-only and don't need the same stability contract.
- **Dashboard parses on read.** New dashboard pages should call `ApiXxxResponseSchema.parse(await r.json())` to surface drift loudly during development.

## What this contract does NOT cover

- The MCP `/messages` endpoint and its tool I/O (those have their own Zod schemas in `packages/types/src/tools.ts`).
- The `/sse` MCP transport (protocol-level, not application-level).
- The `/demo/run-campaign` endpoint (v1 dashboard form helper; not used by static dashboard).
- v2 launch flow endpoints (Phase 5 dashboard work — will be added when that lands).

## How to add a new endpoint

1. Define the response Zod schema in `packages/types/src/api.ts`.
2. Export from `packages/types/src/index.ts`.
3. Implement the Worker handler in `apps/mcp-server/src/index.ts`. Type its `c.json(...)` argument explicitly to the schema's inferred type.
4. Add the consumer in `apps/dashboard/src/app/.../page.tsx`. Use `Schema.parse(await r.json())` to catch drift.
5. Document the endpoint in this file.
6. (Optional) Add an integration test that hits the deployed Worker URL and validates against the schema.
