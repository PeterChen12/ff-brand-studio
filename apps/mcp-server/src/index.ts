import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { registerAllTools } from "./tools/index.js";
import { RunCampaignInput } from "@ff/types";
import { runCampaignWorkflow, setScoreFn } from "./workflows/campaign.workflow.js";
import { scoreBrandCompliance } from "./guardian/index.js";
import { createDbClient } from "./db/client.js";
import {
  assets,
  runCosts,
  products,
  productVariants,
  platformAssets,
  sellerProfiles,
  launchRuns,
  type Product,
} from "./db/schema.js";
import { desc, sql, eq } from "drizzle-orm";
import { runSeoPipeline, type SeoSurfaceSpec } from "./orchestrator/seo_pipeline.js";
import { runLaunchPipeline } from "./orchestrator/launch_pipeline.js";
import type { LaunchPlatform } from "./orchestrator/planner.js";
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

// Public read-only HTTP endpoints — used by the dashboard UI to fetch DAM data.
// Returns BOTH v1 social heroes (assets table) and v2 launch platform-assets
// (platform_assets joined to product_variants → products → seller_profiles).
// Frontend buckets them differently: v2 assets group by SKU, v1 fall through
// to a "legacy" section.
app.get("/api/assets", async (c) => {
  try {
    const db = createDbClient(c.env);
    const [legacyRows, v2Rows] = await Promise.all([
      db.select().from(assets).orderBy(desc(assets.createdAt)).limit(50),
      db
        .select({
          id: platformAssets.id,
          variantId: platformAssets.variantId,
          platform: platformAssets.platform,
          slot: platformAssets.slot,
          r2Url: platformAssets.r2Url,
          width: platformAssets.width,
          height: platformAssets.height,
          format: platformAssets.format,
          complianceScore: platformAssets.complianceScore,
          status: platformAssets.status,
          modelUsed: platformAssets.modelUsed,
          costCents: platformAssets.costCents,
          createdAt: platformAssets.createdAt,
          productId: products.id,
          sku: products.sku,
          productNameEn: products.nameEn,
          productNameZh: products.nameZh,
          category: products.category,
          sellerNameEn: sellerProfiles.orgNameEn,
        })
        .from(platformAssets)
        .leftJoin(productVariants, eq(platformAssets.variantId, productVariants.id))
        .leftJoin(products, eq(productVariants.productId, products.id))
        .leftJoin(sellerProfiles, eq(products.sellerId, sellerProfiles.id))
        .orderBy(desc(platformAssets.createdAt))
        .limit(100),
    ]);
    return c.json({ legacy: legacyRows, platformAssets: v2Rows });
  } catch (err) {
    console.error("[/api/assets]", err);
    return c.json({ legacy: [], platformAssets: [] });
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

// Recent launch_runs joined with their parent product. Drives the Overview
// "Recent launches" hero block. v2 vocabulary throughout — campaigns no
// longer applies.
app.get("/api/launches", async (c) => {
  try {
    const db = createDbClient(c.env);
    const rows = await db
      .select({
        id: launchRuns.id,
        productId: launchRuns.productId,
        sku: products.sku,
        productNameEn: products.nameEn,
        productNameZh: products.nameZh,
        category: products.category,
        orchestratorModel: launchRuns.orchestratorModel,
        status: launchRuns.status,
        totalCostCents: launchRuns.totalCostCents,
        durationMs: launchRuns.durationMs,
        hitlInterventions: launchRuns.hitlInterventions,
        createdAt: launchRuns.createdAt,
      })
      .from(launchRuns)
      .leftJoin(products, eq(launchRuns.productId, products.id))
      .orderBy(desc(launchRuns.createdAt))
      .limit(20);
    return c.json({ launches: rows });
  } catch (err) {
    console.error("[/api/launches]", err);
    return c.json({ launches: [] });
  }
});

// List all products with seller info — drives the launch wizard SKU picker.
app.get("/api/products", async (c) => {
  try {
    const db = createDbClient(c.env);
    const rows = await db
      .select({
        id: products.id,
        sku: products.sku,
        nameEn: products.nameEn,
        nameZh: products.nameZh,
        category: products.category,
        materials: products.materials,
        colorsHex: products.colorsHex,
        dimensions: products.dimensions,
        loraUrl: products.loraUrl,
        sellerId: products.sellerId,
        sellerNameEn: sellerProfiles.orgNameEn,
        sellerNameZh: sellerProfiles.orgNameZh,
        createdAt: products.createdAt,
      })
      .from(products)
      .leftJoin(sellerProfiles, eq(products.sellerId, sellerProfiles.id))
      .orderBy(desc(products.createdAt))
      .limit(100);
    return c.json({ products: rows });
  } catch (err) {
    console.error("[/api/products]", err);
    return c.json({ products: [] });
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

// ── SEO preview demo endpoint (D7) ────────────────────────────────────────
// Bypasses the DB entirely — synthesizes a Product from the request body so
// the dashboard SEO panel works before D8 demo SKUs are seeded. Calls the
// same runSeoPipeline used by launch_product_sku, so the output shape is
// identical.
const SeoPreviewInput = z.object({
  product_name_en: z.string().min(2).max(200),
  product_name_zh: z.string().max(200).optional(),
  product_category: z.string().min(2).max(80),
  platforms: z
    .array(z.enum(["amazon", "shopify"]))
    .min(1)
    .default(["amazon", "shopify"]),
  surfaces: z
    .array(
      z.object({
        surface: z.enum(["amazon-us", "tmall", "jd", "shopify"]),
        language: z.enum(["en", "zh"]),
      })
    )
    .optional(),
  cost_cap_cents: z.number().int().positive().max(200).default(50),
});

app.post("/demo/seo-preview", async (c) => {
  const body = await c.req.json();
  const parsed = SeoPreviewInput.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  const p = parsed.data;

  // Synthesize a minimal Product the pipeline can read. None of the fields
  // touch the DB — the pipeline only reads nameEn, nameZh, category.
  const synthProduct: Product = {
    id: "00000000-0000-0000-0000-000000000000",
    sellerId: "00000000-0000-0000-0000-000000000000",
    sku: `DEMO-${Date.now()}`,
    nameEn: p.product_name_en,
    nameZh: p.product_name_zh ?? null,
    category: p.product_category,
    dimensions: null,
    materials: null,
    colorsHex: null,
    loraUrl: null,
    triggerPhrase: null,
    brandConfig: null,
    createdAt: new Date(),
  };

  try {
    const result = await runSeoPipeline({
      product: synthProduct,
      platforms: p.platforms as LaunchPlatform[],
      surfaces: p.surfaces as SeoSurfaceSpec[] | undefined,
      cost_cap_cents: p.cost_cap_cents,
      anthropic_api_key: c.env.ANTHROPIC_API_KEY,
      openai_api_key: c.env.OPENAI_API_KEY,
      dataforseo_login: c.env.DATAFORSEO_LOGIN,
      dataforseo_password: c.env.DATAFORSEO_PASSWORD,
    });
    return c.json(result);
  } catch (err) {
    console.error("[/demo/seo-preview]", err);
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      500
    );
  }
});

// ── Launch SKU demo endpoint (F2) ─────────────────────────────────────────
// Wraps the v2 launch_product_sku orchestrator for dashboard consumption.
// Defaults are tuned for the agency-demo workflow: dry_run=true keeps
// image-generation cost at zero (FAL.ai is paid per call), include_seo=true
// runs the real bilingual SEO pipeline (~$0.10-0.50/SKU). Caller can opt
// into full image gen by passing dry_run=false.
const LaunchSkuInput = z.object({
  product_id: z.string().uuid(),
  platforms: z
    .array(z.enum(["amazon", "shopify"]))
    .min(1)
    .default(["amazon", "shopify"]),
  // Image generation costs real money via FAL.ai — keep dry-run by default
  // for demos. Passing dry_run=false runs the full Phase-2 image stack.
  dry_run: z.boolean().default(true),
  include_seo: z.boolean().default(true),
  seo_cost_cap_cents: z.number().int().positive().max(200).default(50),
});

app.post("/demo/launch-sku", async (c) => {
  const body = await c.req.json();
  const parsed = LaunchSkuInput.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  const p = parsed.data;
  try {
    const db = createDbClient(c.env);
    const result = await runLaunchPipeline(db, {
      product_id: p.product_id,
      platforms: p.platforms as LaunchPlatform[],
      include_video: false,
      dry_run: p.dry_run,
      include_seo: p.include_seo,
      seo_cost_cap_cents: p.seo_cost_cap_cents,
      anthropic_api_key: c.env.ANTHROPIC_API_KEY,
      openai_api_key: c.env.OPENAI_API_KEY,
      dataforseo_login: c.env.DATAFORSEO_LOGIN,
      dataforseo_password: c.env.DATAFORSEO_PASSWORD,
    });
    return c.json(result);
  } catch (err) {
    console.error("[/demo/launch-sku]", err);
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      500
    );
  }
});

export default app;
