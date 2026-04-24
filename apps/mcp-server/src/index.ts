import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { registerAllTools } from "./tools/index.js";
import { RunCampaignInput } from "@ff/types";
import { runCampaignWorkflow, setScoreFn } from "./workflows/campaign.workflow.js";
import { scoreBrandCompliance } from "./guardian/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.use("*", cors({ origin: "*" }));

// Transport registry — keyed by sessionId so GET /sse and POST /messages share state
const transports = new Map<string, Transport>();

app.get("/health", (c) => {
  return c.json({
    status: "ok",
    server: "ff-brand-studio-mcp",
    version: "0.1.0",
    environment: c.env.ENVIRONMENT,
  });
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
