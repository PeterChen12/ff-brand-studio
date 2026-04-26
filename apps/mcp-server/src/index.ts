import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { registerAllTools } from "./tools/index.js";
import { RunCampaignInput } from "@ff/types";
import { runCampaignWorkflow, setScoreFn } from "./workflows/campaign.workflow.js";
import { scoreBrandCompliance } from "./guardian/index.js";
import { createDbClient } from "./db/client.js";
import { assets, runCosts } from "./db/schema.js";
import { desc, sql } from "drizzle-orm";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.use("*", cors({ origin: "*" }));

// Transport registry — keyed by sessionId so GET /sse and POST /messages share state
const transports = new Map<string, Transport>();

app.get("/health", async (c) => {
  // Phase B2 enriched health check — pings the dependencies so production
  // diagnosis is one curl. DB ping has a 1s budget; on timeout we report
  // status=degraded (not error) so a hung Postgres doesn't fail Cloudflare's
  // health check and trigger noisy alerts.
  const startedAt = Date.now();

  let dbStatus: "ok" | "timeout" | "error" = "error";
  try {
    const db = createDbClient(c.env);
    await Promise.race([
      db.execute(sql`select 1 as ping`),
      new Promise((_, rej) => setTimeout(() => rej(new Error("db ping > 1s")), 1000)),
    ]);
    dbStatus = "ok";
  } catch (err) {
    dbStatus = (err instanceof Error && err.message.includes("> 1s")) ? "timeout" : "error";
  }

  const checks = {
    db: dbStatus,
    anthropic_key: c.env.ANTHROPIC_API_KEY ? "set" : "missing",
    fal_key: c.env.FAL_KEY ? "set" : "missing",
    openai_key: c.env.OPENAI_API_KEY ? "set" : "missing",
    langfuse_public_key: c.env.LANGFUSE_PUBLIC_KEY ? "set" : "missing",
    r2_public_url: c.env.R2_PUBLIC_URL ? "set" : "missing",
  } as const;

  const anyMissing = Object.values(checks).some((v) => v === "missing" || v === "error");
  const status: "ok" | "degraded" | "error" =
    dbStatus === "error" ? "error" : anyMissing || dbStatus === "timeout" ? "degraded" : "ok";

  return c.json(
    {
      status,
      server: "ff-brand-studio-mcp",
      version: "0.2.0",
      environment: c.env.ENVIRONMENT,
      checks,
      ping_ms: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    },
    status === "error" ? 503 : 200
  );
});

// SSE endpoint — Claude Desktop connects here for MCP communication
app.get("/sse", async (c) => {
  const sessionId = crypto.randomUUID();
  const mcpServer = new McpServer({ name: "ff-brand-studio", version: "0.1.0" });
  registerAllTools(mcpServer, c.env);

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const transport: Transport = {
    onclose: undefined,
    onerror: undefined,
    onmessage: undefined,

    async start() {
      // Tell the client which URL to POST messages back to (includes sessionId)
      await writer.write(encoder.encode(`event: endpoint\ndata: /messages?sessionId=${sessionId}\n\n`));
    },

    async send(message: JSONRPCMessage) {
      await writer.write(encoder.encode(`data: ${JSON.stringify(message)}\n\n`));
    },

    async close() {
      transports.delete(sessionId);
      await writer.close().catch(() => void 0);
    },
  };

  transports.set(sessionId, transport);
  await mcpServer.connect(transport);

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});

// Message relay for SSE transport — Claude Desktop posts MCP JSON-RPC messages here
app.post("/messages", async (c) => {
  const sessionId = c.req.query("sessionId");
  if (!sessionId) return c.text("Missing sessionId", 400);

  const transport = transports.get(sessionId);
  if (!transport) return c.text("Session not found", 404);

  const body = await c.req.json<JSONRPCMessage>();
  transport.onmessage?.(body);
  return c.text("ok");
});

// Public read-only HTTP endpoints — used by the dashboard UI to fetch DAM data
app.get("/api/assets", async (c) => {
  try {
    const db = createDbClient(c.env);
    const rows = await db.select().from(assets).orderBy(desc(assets.createdAt)).limit(50);
    return c.json({ assets: rows });
  } catch (err) {
    console.error("[/api/assets]", err);
    return c.json({ assets: [] });
  }
});

app.get("/api/costs", async (c) => {
  try {
    const db = createDbClient(c.env);
    const [row] = await db
      .select({
        totalSpend: sql<string>`coalesce(sum(total_cost_usd), 0)`,
        runs: sql<string>`count(*)`,
        totalFlux: sql<string>`coalesce(sum(flux_calls), 0)`,
        totalGpt: sql<string>`coalesce(sum(gpt_image_2_calls), 0)`,
        totalKling: sql<string>`coalesce(sum(kling_calls), 0)`,
      })
      .from(runCosts);
    return c.json({
      totalSpend: Number(row?.totalSpend ?? 0),
      runs: Number(row?.runs ?? 0),
      totalFlux: Number(row?.totalFlux ?? 0),
      totalGpt: Number(row?.totalGpt ?? 0),
      totalKling: Number(row?.totalKling ?? 0),
    });
  } catch (err) {
    console.error("[/api/costs]", err);
    return c.json({ totalSpend: 0, runs: 0, totalFlux: 0, totalGpt: 0, totalKling: 0 });
  }
});

app.get("/api/runs", async (c) => {
  try {
    const db = createDbClient(c.env);
    const rows = await db.select().from(runCosts).orderBy(desc(runCosts.runAt)).limit(30);
    return c.json({ runs: rows });
  } catch (err) {
    console.error("[/api/runs]", err);
    return c.json({ runs: [] });
  }
});

// Demo HTTP endpoint — simulates the run_campaign tool call for testing without Claude Desktop
app.post("/demo/run-campaign", async (c) => {
  const body = await c.req.json();
  const parsed = RunCampaignInput.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  setScoreFn((p) =>
    scoreBrandCompliance({
      assetUrl: p.assetUrl,
      assetType: p.assetType,
      copyEn: p.copyEn,
      copyZh: p.copyZh,
      apiKey: p.apiKey,
    })
  );

  const result = await runCampaignWorkflow(parsed.data, c.env);
  return c.json(result);
});

export default app;
