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
  productReferences,
  platformAssets,
  platformListings,
  sellerProfiles,
  launchRuns,
  walletLedger,
  auditEvents,
  tenants,
  SAMPLE_TENANT_ID,
  type Product,
  type Tenant,
} from "./db/schema.js";
import { and, desc, sql, eq, inArray } from "drizzle-orm";
import { runSeoPipeline, type SeoSurfaceSpec } from "./orchestrator/seo_pipeline.js";
import { runLaunchPipeline } from "./orchestrator/launch_pipeline.js";
import type { LaunchPlatform } from "./orchestrator/planner.js";
import { predictLaunchCost, PRODUCT_ONBOARD_CENTS } from "./orchestrator/cost.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { requireTenant, type AuthVars } from "./lib/auth.js";
import { rateLimitMiddleware } from "./lib/rate-limit.js";
import { handleClerkWebhook } from "./lib/clerk-webhook.js";
import { presignPutUrl, verifyR2Object } from "./lib/r2-presign.js";
import { chargeWallet, creditWallet, InsufficientFundsError } from "./lib/wallet.js";
import { deriveProductMetadata } from "./lib/derive-product-metadata.js";
import { auditEvent } from "./lib/audit.js";
import { getStripe, priceIdForAmount, checkWebhookIdempotency } from "./lib/stripe.js";
import { nanoid } from "nanoid";

const app = new Hono<{
  Bindings: CloudflareBindings;
  Variables: Partial<AuthVars>;
}>();

/**
 * Helper — for any /api/* read endpoint we treat the legacy-demo Sample
 * tenant as readable to every signed-in tenant (per the locked decision
 * "Sample Catalog visible via tenant.features.has_sample_access"). So
 * the visibility filter is `tenant_id IN (currentTenant, SAMPLE_TENANT)`.
 */
function visibleTenantIds(tenant: Tenant): string[] {
  const features = (tenant.features ?? {}) as { has_sample_access?: boolean };
  const ids = [tenant.id];
  if (features.has_sample_access && tenant.id !== SAMPLE_TENANT_ID) {
    ids.push(SAMPLE_TENANT_ID);
  }
  return ids;
}

app.use(
  "*",
  cors({
    origin: "*",
    allowHeaders: ["Authorization", "Content-Type", "svix-id", "svix-timestamp", "svix-signature"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  })
);

// Phase G — Clerk webhook (must come BEFORE requireTenant since it uses
// svix signature, not a Bearer JWT).
app.post("/v1/clerk-webhook", handleClerkWebhook);

// Phase H3 — Stripe webhook. Open route (Stripe-signature-verified).
app.post("/v1/stripe-webhook", async (c) => {
  const sig = c.req.header("stripe-signature");
  if (!sig) return c.json({ error: "missing_signature" }, 400);

  const rawBody = await c.req.text();
  const stripe = getStripe(c.env);

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      sig,
      c.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("[stripe-webhook] signature verification failed", err);
    return c.json({ error: "invalid_signature" }, 401);
  }

  // Idempotency — Stripe retries every webhook for up to 3 days; KV
  // 24h TTL is enough since by then the original delivery has succeeded
  // and the event_id is no longer in their retry queue.
  const fresh = await checkWebhookIdempotency(c.env, event.id);
  if (!fresh) return c.json({ ok: true, idempotent: true });

  const db = createDbClient(c.env);

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as {
          id: string;
          metadata?: Record<string, string> | null;
          amount_total?: number | null;
        };
        const tenantId = session.metadata?.tenant_id;
        const topUpCents =
          Number(session.metadata?.top_up_cents) || session.amount_total || 0;
        if (!tenantId || !topUpCents) {
          return c.json({ ok: true, ignored: "missing_metadata" });
        }
        const result = await creditWallet(db, {
          tenantId,
          cents: topUpCents,
          reason: "stripe_topup",
          referenceType: "stripe_session",
          referenceId: session.id,
        });
        await auditEvent(db, {
          tenantId,
          actor: null,
          action: "billing.stripe_topup",
          targetType: "stripe_session",
          metadata: {
            session_id: session.id,
            cents: topUpCents,
            balance_after: result.balanceAfterCents,
          },
        });
        return c.json({ ok: true, balance_after: result.balanceAfterCents });
      }
      case "payment_intent.payment_failed":
        // Log only; nothing to revert (Checkout session never completed).
        console.warn("[stripe-webhook] payment_intent.payment_failed", event.id);
        return c.json({ ok: true });
      case "customer.deleted": {
        const customer = event.data.object as { id: string };
        await db
          .update(tenants)
          .set({ stripeCustomerId: null })
          .where(eq(tenants.stripeCustomerId, customer.id));
        return c.json({ ok: true });
      }
      default:
        return c.json({ ok: true, ignored: event.type });
    }
  } catch (err) {
    console.error(`[stripe-webhook ${event.type}]`, err);
    return c.json(
      {
        error: "handler_failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      500
    );
  }
});

// Apply auth middleware to /api/* and /v1/* (except open routes already
// declared above). /health, /sse, /messages, /demo/* stay open for now —
// /demo/* will be removed by the inbox cleanup agent once dashboard
// migrates fully to /v1/launches.
app.use("/api/*", requireTenant);
app.use("/v1/launches", requireTenant);
app.use("/v1/launches/*", requireTenant);
app.use("/v1/listings/*", requireTenant);
app.use("/v1/products", requireTenant);
app.use("/v1/products/*", requireTenant);
app.use("/v1/me/*", requireTenant);
app.use("/v1/billing/*", requireTenant);
app.use("/v1/audit", requireTenant);
app.use("/v1/listings/*", requireTenant);
app.use("/v1/assets/*", requireTenant);
app.use("/v1/skus/*", requireTenant);
app.use("/v1/api-keys", requireTenant);
app.use("/v1/api-keys/*", requireTenant);
app.use("/v1/webhooks", requireTenant);
app.use("/v1/webhooks/*", requireTenant);
app.use("/v1/tenant", requireTenant);
app.use("/v1/tenant/*", requireTenant);

// Phase M1 — rate limit AFTER auth so we have tenant context to scope
// counters by. Open routes (/v1/clerk-webhook, /v1/stripe-webhook,
// /v1/openapi.yaml, /docs) bypass naturally since they're not under
// requireTenant.
app.use("/api/*", rateLimitMiddleware);
app.use("/v1/launches", rateLimitMiddleware);
app.use("/v1/launches/*", rateLimitMiddleware);
app.use("/v1/listings/*", rateLimitMiddleware);
app.use("/v1/products", rateLimitMiddleware);
app.use("/v1/products/*", rateLimitMiddleware);
app.use("/v1/me/*", rateLimitMiddleware);
app.use("/v1/billing/*", rateLimitMiddleware);
app.use("/v1/audit", rateLimitMiddleware);
app.use("/v1/assets/*", rateLimitMiddleware);
app.use("/v1/skus/*", rateLimitMiddleware);
app.use("/v1/api-keys", rateLimitMiddleware);
app.use("/v1/api-keys/*", rateLimitMiddleware);
app.use("/v1/webhooks", rateLimitMiddleware);
app.use("/v1/webhooks/*", rateLimitMiddleware);

// ── Phase H1 — self-serve product upload ─────────────────────────────────

const UploadIntentInput = z.object({
  extensions: z
    .array(z.enum(["jpg", "jpeg", "png", "webp"]))
    .min(1)
    .max(10),
});

app.post("/v1/products/upload-intent", async (c) => {
  const body = await c.req.json();
  const parsed = UploadIntentInput.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const tenant = c.get("tenant") as Tenant;
  const intentId = nanoid(16);
  const urls = await Promise.all(
    parsed.data.extensions.map((ext, i) =>
      presignPutUrl({
        env: c.env,
        tenantId: tenant.id,
        intentId,
        index: i,
        ext,
      })
    )
  );

  // Stash intent metadata in KV for the finalize step to look up.
  await c.env.SESSION_KV.put(
    `upload_intent:${intentId}`,
    JSON.stringify({
      tenant_id: tenant.id,
      keys: urls.map((u) => u.key),
      created_at: Date.now(),
    }),
    { expirationTtl: 3600 } // 1h — generous buffer past the 10-min PUT signature
  );

  return c.json({ intent_id: intentId, urls });
});

const ProductCreateInput = z.object({
  intent_id: z.string().min(1),
  sku: z.string().min(2).max(64).optional(),
  name_en: z.string().min(2).max(200),
  name_zh: z.string().max(200).optional(),
  // Issue 2 — optional long-form description. Cap matches Amazon
  // listing-description max so SEO can use it verbatim where needed.
  description: z.string().max(2000).optional(),
  // Issue 3 — category and kind are now optional. When the dashboard
  // form omits them we derive both server-side via Sonnet (see
  // deriveProductMetadata). Operators can still pass values manually
  // (e.g. integration tests, or a future "edit category" UI).
  category: z.string().min(2).max(80).optional(),
  kind: z.string().min(2).max(40).optional(),
  dimensions: z.record(z.unknown()).optional(),
  materials: z.array(z.string()).optional(),
  colors_hex: z.array(z.string()).optional(),
  uploaded_keys: z.array(z.string()).min(1).max(10),
});

app.post("/v1/products", async (c) => {
  const body = await c.req.json();
  const parsed = ProductCreateInput.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const p = parsed.data;
  const tenant = c.get("tenant") as Tenant;
  const actor = c.get("actor") as string | undefined;

  // 1. Verify intent matches tenant
  const intentRaw = await c.env.SESSION_KV.get(`upload_intent:${p.intent_id}`);
  if (!intentRaw) return c.json({ error: "intent_expired_or_unknown" }, 400);
  const intent = JSON.parse(intentRaw) as { tenant_id: string; keys: string[] };
  if (intent.tenant_id !== tenant.id) {
    return c.json({ error: "intent_tenant_mismatch" }, 403);
  }
  for (const key of p.uploaded_keys) {
    if (!intent.keys.includes(key)) {
      return c.json({ error: "uploaded_key_not_in_intent", key }, 400);
    }
  }

  // 2. HEAD each uploaded key to confirm it actually landed in R2
  for (const key of p.uploaded_keys) {
    const v = await verifyR2Object(c.env, key);
    if (!v.exists) {
      return c.json({ error: "uploaded_object_missing", key }, 400);
    }
    if (v.contentLength !== null && v.contentLength > 5_000_000) {
      return c.json(
        { error: "uploaded_object_too_large", key, size: v.contentLength },
        413
      );
    }
  }

  const db = createDbClient(c.env);

  // 3. Charge the wallet (rejects on insufficient funds)
  try {
    await chargeWallet(db, {
      tenantId: tenant.id,
      cents: PRODUCT_ONBOARD_CENTS,
      reason: "image_gen", // closest existing reason; "product_onboard" added Phase L
      referenceType: "product",
    });
  } catch (err) {
    if (err instanceof InsufficientFundsError) {
      return c.json(
        { error: "wallet_insufficient", balance_cents: err.balanceCents, required_cents: err.requestedCents },
        402
      );
    }
    throw err;
  }

  // 4. Ensure seller_profiles row exists for the tenant
  let sellerId: string;
  const [existingSeller] = await db
    .select({ id: sellerProfiles.id })
    .from(sellerProfiles)
    .where(eq(sellerProfiles.tenantId, tenant.id))
    .limit(1);

  if (existingSeller) {
    sellerId = existingSeller.id;
  } else {
    const [newSeller] = await db
      .insert(sellerProfiles)
      .values({
        tenantId: tenant.id,
        orgNameEn: tenant.name,
        contactEmail: null,
      })
      .returning({ id: sellerProfiles.id });
    sellerId = newSeller.id;
  }

  // 5. Derive category + kind via Sonnet when the dashboard didn't
  //    pass them (Issue 3). Falls back to "other" / "compact_square"
  //    on missing key or model failure so onboarding never blocks.
  let resolvedCategory = p.category;
  let resolvedKind = p.kind;
  if (!resolvedCategory || !resolvedKind) {
    const derived = await deriveProductMetadata({
      name: p.name_zh ?? p.name_en,
      description: p.description ?? null,
      anthropicKey: c.env.ANTHROPIC_API_KEY,
    });
    resolvedCategory = resolvedCategory ?? derived.category;
    resolvedKind = resolvedKind ?? derived.kind;
  }

  // 6. Create product + default variant + reference rows in one go
  const sku = p.sku ?? `${tenant.id.slice(0, 6).toUpperCase()}-${nanoid(8).toUpperCase()}`;

  const [product] = await db
    .insert(products)
    .values({
      tenantId: tenant.id,
      sellerId,
      sku,
      nameEn: p.name_en,
      nameZh: p.name_zh ?? null,
      description: p.description?.trim() || null,
      category: resolvedCategory,
      kind: resolvedKind ?? "compact_square",
      dimensions: p.dimensions ?? null,
      materials: p.materials ?? null,
      colorsHex: p.colors_hex ?? null,
    })
    .returning();

  const [variant] = await db
    .insert(productVariants)
    .values({
      tenantId: tenant.id,
      productId: product.id,
      color: null,
      pattern: null,
    })
    .returning();

  const PUBLIC_HOST = "https://pub-db3f39e3386347d58359ba96517eec84.r2.dev";
  await db.insert(productReferences).values(
    p.uploaded_keys.map((key) => ({
      tenantId: tenant.id,
      productId: product.id,
      r2Url: `${PUBLIC_HOST}/${key}`,
      kind: "uploaded",
      uploadedBy: actor ?? null,
    }))
  );

  await auditEvent(db, {
    tenantId: tenant.id,
    actor: actor ?? null,
    action: "product.create",
    targetType: "product",
    targetId: product.id,
    metadata: {
      sku,
      reference_count: p.uploaded_keys.length,
      onboard_cents: PRODUCT_ONBOARD_CENTS,
    },
  });

  // Clean up the intent (best-effort)
  c.env.SESSION_KV.delete(`upload_intent:${p.intent_id}`).catch(() => {});

  return c.json({
    product_id: product.id,
    sku: product.sku,
    variant_id: variant.id,
    references_created: p.uploaded_keys.length,
    // Issue 3 — surface derived category/kind so the dashboard can
    // show them in the next-step UI (e.g. "AI classified this as a
    // fishing rod"). Operators can override later via product edit.
    category: product.category,
    kind: product.kind,
  });
});

// ── Phase H2 — onboarding state ──────────────────────────────────────────

app.get("/v1/me/state", async (c) => {
  const tenant = c.get("tenant") as Tenant;
  const actor = c.get("actor") as string | undefined;
  const db = createDbClient(c.env);

  const [productCountRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(products)
    .where(eq(products.tenantId, tenant.id));
  const [launchCountRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(launchRuns)
    .where(eq(launchRuns.tenantId, tenant.id));

  const features = (tenant.features ?? {}) as Record<string, boolean>;
  return c.json({
    tenant: {
      id: tenant.id,
      name: tenant.name,
      plan: tenant.plan,
      wallet_balance_cents: tenant.walletBalanceCents,
      features,
    },
    actor: actor ?? null,
    onboarding: {
      has_first_product: (productCountRow?.n ?? 0) > 0,
      has_first_launch: (launchCountRow?.n ?? 0) > 0,
      skipped: features.skipped_onboarding === true,
    },
  });
});

// ── Phase H3 — Stripe top-up checkout session ────────────────────────────

const CheckoutInput = z.object({
  amount_cents: z
    .number()
    .int()
    .min(500) // $5 minimum
    .max(50_000), // $500 max per call
});

app.post("/v1/billing/checkout-session", async (c) => {
  const body = await c.req.json();
  const parsed = CheckoutInput.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const tenant = c.get("tenant") as Tenant;

  if (!c.env.STRIPE_SECRET_KEY) {
    return c.json(
      {
        error: "stripe_not_configured",
        hint:
          "Set STRIPE_SECRET_KEY + STRIPE_PRICE_TOPUP_* via wrangler secret put",
      },
      503
    );
  }

  const stripe = getStripe(c.env);
  const priceId = priceIdForAmount(c.env, parsed.data.amount_cents);

  const session = await stripe.checkout.sessions.create({
    // Stripe SDK v22+ renamed "embedded" → "embedded_page" but the
    // dashboard's <EmbeddedCheckout /> component still consumes the
    // returned client_secret identically.
    ui_mode: "embedded_page",
    mode: "payment",
    line_items: priceId
      ? [{ price: priceId, quantity: 1 }]
      : [
          {
            price_data: {
              currency: "usd",
              product_data: { name: "FF wallet top-up" },
              unit_amount: parsed.data.amount_cents,
            },
            quantity: 1,
          },
        ],
    metadata: {
      tenant_id: tenant.id,
      top_up_cents: String(parsed.data.amount_cents),
    },
    customer: tenant.stripeCustomerId ?? undefined,
    return_url: `${new URL(c.req.url).origin.replace(
      "ff-brand-studio-mcp.creatorain.workers.dev",
      "image-generation.buyfishingrod.com"
    )}/billing?session_id={CHECKOUT_SESSION_ID}`,
  });

  return c.json({ client_secret: session.client_secret });
});

app.get("/v1/billing/ledger", async (c) => {
  const tenant = c.get("tenant") as Tenant;
  const db = createDbClient(c.env);
  const rows = await db
    .select()
    .from(walletLedger)
    .where(eq(walletLedger.tenantId, tenant.id))
    .orderBy(desc(walletLedger.at))
    .limit(100);
  return c.json({
    ledger: rows,
    balance_cents: tenant.walletBalanceCents,
  });
});

// ── Phase H4 — launch preview + versioned launch endpoint ────────────────

// Issue 7+10 — explicit per-surface SEO targeting. When the dashboard
// supplies `surfaces`, it overrides the legacy `platforms` × `include_seo`
// inference and the cost predictor uses the exact surface count. Older
// clients (CLI, integration tests) keep working with the simpler shape.
const SeoSurfaceInput = z.object({
  surface: z.enum(["amazon-us", "shopify", "tmall", "jd"]),
  language: z.enum(["en", "zh"]),
});

const LaunchPreviewInput = z.object({
  platforms: z
    .array(z.enum(["amazon", "shopify"]))
    .min(1)
    .default(["amazon", "shopify"]),
  include_seo: z.boolean().default(true),
  include_video: z.boolean().default(false),
  surfaces: z.array(SeoSurfaceInput).optional(),
});

app.post("/v1/launches/preview", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = LaunchPreviewInput.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const tenant = c.get("tenant") as Tenant;

  const surfaceCount = parsed.data.surfaces?.length;
  const prediction = predictLaunchCost({
    platforms: parsed.data.platforms as LaunchPlatform[],
    include_seo: surfaceCount !== undefined
      ? surfaceCount > 0
      : parsed.data.include_seo,
    include_video: parsed.data.include_video,
    surface_count: surfaceCount,
  });

  return c.json({
    prediction,
    wallet: {
      balance_cents: tenant.walletBalanceCents,
      balance_after_cents: tenant.walletBalanceCents - prediction.total_cents,
      sufficient: tenant.walletBalanceCents >= prediction.total_cents,
    },
  });
});

const LaunchInput = z.object({
  product_id: z.string().uuid(),
  platforms: z
    .array(z.enum(["amazon", "shopify"]))
    .min(1)
    .default(["amazon", "shopify"]),
  dry_run: z.boolean().default(false),
  include_seo: z.boolean().default(true),
  seo_cost_cap_cents: z.number().int().positive().max(500).default(50),
  cost_cap_cents: z.number().int().positive().max(2000).optional(),
  // Issue 7+10 — explicit per-surface SEO targeting. Each marketplace
  // can have one or more languages. When provided, this overrides
  // include_seo (treated as "true if surfaces is non-empty").
  surfaces: z.array(SeoSurfaceInput).optional(),
});

app.post("/v1/launches", async (c) => {
  const body = await c.req.json();
  const parsed = LaunchInput.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const p = parsed.data;
  const tenant = c.get("tenant") as Tenant;
  const actor = c.get("actor") as string | undefined;
  const db = createDbClient(c.env);

  // 1. Verify product belongs to tenant (or is a Sample SKU)
  const [product] = await db
    .select()
    .from(products)
    .where(
      and(
        eq(products.id, p.product_id),
        inArray(products.tenantId, visibleTenantIds(tenant))
      )
    )
    .limit(1);
  if (!product) return c.json({ error: "product_not_found_or_forbidden" }, 404);

  // 2. Pre-flight cost prediction + wallet charge
  const surfaceCount = p.surfaces?.length;
  const prediction = predictLaunchCost({
    platforms: p.platforms as LaunchPlatform[],
    include_seo:
      surfaceCount !== undefined ? surfaceCount > 0 : p.include_seo,
    surface_count: surfaceCount,
  });

  if (!p.dry_run) {
    try {
      await chargeWallet(db, {
        tenantId: tenant.id,
        cents: prediction.total_cents,
        reason: "launch_run",
        referenceType: "launch_run",
      });
    } catch (err) {
      if (err instanceof InsufficientFundsError) {
        return c.json(
          {
            error: "wallet_insufficient",
            balance_cents: err.balanceCents,
            required_cents: err.requestedCents,
          },
          402
        );
      }
      throw err;
    }
  }

  await auditEvent(db, {
    tenantId: tenant.id,
    actor: actor ?? null,
    action: "launch.start",
    targetType: "product",
    targetId: product.id,
    metadata: {
      platforms: p.platforms,
      predicted_cents: prediction.total_cents,
      dry_run: p.dry_run,
    },
  });

  try {
    const result = await runLaunchPipeline(db, {
      product_id: p.product_id,
      platforms: p.platforms as LaunchPlatform[],
      include_video: false,
      dry_run: p.dry_run,
      include_seo:
        surfaceCount !== undefined ? surfaceCount > 0 : p.include_seo,
      seo_surfaces: p.surfaces,
      seo_cost_cap_cents: p.seo_cost_cap_cents,
      cost_cap_cents: p.cost_cap_cents,
      anthropic_api_key: c.env.ANTHROPIC_API_KEY,
      openai_api_key: c.env.OPENAI_API_KEY,
      dataforseo_login: c.env.DATAFORSEO_LOGIN,
      dataforseo_password: c.env.DATAFORSEO_PASSWORD,
      env: c.env,
    });

    // Refund the difference between predicted and actual cost (we charged
    // `prediction.total_cents` up-front; if the run produced fewer assets
    // or finished cheaper, refund the difference).
    if (!p.dry_run) {
      const actualCents = result.total_cost_cents;
      // Convert seo cents (which the pipeline counts as cost-of-goods, not
      // billable) — for now, refund the entire difference between our
      // predicted billable amount and what would have been charged at full
      // adapter completion. Phase L tightens this with per-asset billing.
      const billedDelta = prediction.total_cents - actualCents;
      if (billedDelta > 0) {
        await creditWallet(db, {
          tenantId: tenant.id,
          cents: billedDelta,
          reason: "refund",
          referenceType: "launch_run",
          referenceId: result.run_id,
        });
      }
    }

    await auditEvent(db, {
      tenantId: tenant.id,
      actor: actor ?? null,
      action: result.status === "succeeded" ? "launch.complete" : "launch.failed",
      targetType: "launch_run",
      targetId: result.run_id,
      metadata: {
        status: result.status,
        actual_cents: result.total_cost_cents,
        duration_ms: result.duration_ms,
        hitl_count: result.hitl_count,
      },
    });

    return c.json(result);
  } catch (err) {
    // Refund the entire pre-charge if the pipeline itself crashed.
    if (!p.dry_run) {
      try {
        await creditWallet(db, {
          tenantId: tenant.id,
          cents: prediction.total_cents,
          reason: "refund",
          referenceType: "launch_failure",
        });
      } catch {
        // best effort
      }
    }
    await auditEvent(db, {
      tenantId: tenant.id,
      actor: actor ?? null,
      action: "launch.failed",
      targetType: "product",
      targetId: product.id,
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
    return c.json(
      {
        error: "launch_failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      500
    );
  }
});

app.get("/v1/launches/:runId", async (c) => {
  const runId = c.req.param("runId");
  const tenant = c.get("tenant") as Tenant;
  const db = createDbClient(c.env);

  const [run] = await db
    .select()
    .from(launchRuns)
    .where(
      and(
        eq(launchRuns.id, runId),
        inArray(launchRuns.tenantId, visibleTenantIds(tenant))
      )
    )
    .limit(1);
  if (!run) return c.json({ error: "not_found" }, 404);

  const assetsRows = await db
    .select()
    .from(platformAssets)
    .leftJoin(productVariants, eq(platformAssets.variantId, productVariants.id))
    .where(eq(productVariants.productId, run.productId));

  const listings = await db
    .select()
    .from(platformListings)
    .leftJoin(productVariants, eq(platformListings.variantId, productVariants.id))
    .where(eq(productVariants.productId, run.productId));

  return c.json({ run, assets: assetsRows, listings });
});

// G3 — read endpoint for persisted SEO copy. Tenant-scoped.
app.get("/v1/listings", async (c) => {
  try {
    const db = createDbClient(c.env);
    const tenant = c.get("tenant") as Tenant;
    const tids = visibleTenantIds(tenant);
    const variantId = c.req.query("variant_id");
    const sku = c.req.query("sku");

    if (variantId) {
      const rows = await db
        .select()
        .from(platformListings)
        .where(
          and(
            eq(platformListings.variantId, variantId),
            inArray(platformListings.tenantId, tids)
          )
        )
        .orderBy(desc(platformListings.updatedAt));
      return c.json({ listings: rows });
    }

    if (sku) {
      const rows = await db
        .select({
          id: platformListings.id,
          variantId: platformListings.variantId,
          surface: platformListings.surface,
          language: platformListings.language,
          copy: platformListings.copy,
          rating: platformListings.rating,
          iterations: platformListings.iterations,
          costCents: platformListings.costCents,
          status: platformListings.status,
          updatedAt: platformListings.updatedAt,
        })
        .from(platformListings)
        .leftJoin(productVariants, eq(platformListings.variantId, productVariants.id))
        .leftJoin(products, eq(productVariants.productId, products.id))
        .where(
          and(
            eq(products.sku, sku),
            inArray(platformListings.tenantId, tids)
          )
        )
        .orderBy(desc(platformListings.updatedAt));
      return c.json({ listings: rows });
    }

    return c.json({ error: "variant_id or sku required" }, 400);
  } catch (err) {
    console.error("[/v1/listings]", err);
    return c.json({ listings: [], error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// Phase L2 — OpenAPI 3.1 spec + Redoc renderer (both unauthenticated).
app.get("/v1/openapi.yaml", async (c) => {
  const { getOpenApiYaml } = await import("./openapi.js");
  return new Response(getOpenApiYaml(), {
    headers: { "content-type": "text/yaml; charset=utf-8" },
  });
});

app.get("/docs", async (c) => {
  const { getRedocHtml } = await import("./openapi.js");
  return new Response(getRedocHtml(), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
});

// Phase L2 — single-product fetch, list, and soft-delete.
app.get("/v1/products/:id", async (c) => {
  try {
    const db = createDbClient(c.env);
    const tenant = c.get("tenant") as Tenant;
    const id = c.req.param("id");
    const [row] = await db
      .select()
      .from(products)
      .where(eq(products.id, id))
      .limit(1);
    if (!row || !visibleTenantIds(tenant).includes(row.tenantId)) {
      return c.json({ error: "not_found" }, 404);
    }
    return c.json({ product: row });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

app.get("/v1/products", async (c) => {
  try {
    const db = createDbClient(c.env);
    const tenant = c.get("tenant") as Tenant;
    const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10) || 20, 100);
    const cursor = c.req.query("cursor");
    const filters = [inArray(products.tenantId, visibleTenantIds(tenant))];
    if (cursor) {
      // Cursor is a created_at ISO string; rows older than it.
      filters.push(sql`${products.createdAt} < ${cursor}`);
    }
    const rows = await db
      .select()
      .from(products)
      .where(and(...filters))
      .orderBy(desc(products.createdAt))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    const nextCursor = hasMore && items.length > 0
      ? items[items.length - 1].createdAt?.toISOString() ?? null
      : null;
    return c.json({ products: items, hasMore, nextCursor });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

app.delete("/v1/products/:id", async (c) => {
  try {
    const db = createDbClient(c.env);
    const tenant = c.get("tenant") as Tenant;
    const actor = c.get("actor") as string | undefined;
    const id = c.req.param("id");
    const [row] = await db
      .select()
      .from(products)
      .where(eq(products.id, id))
      .limit(1);
    if (!row || row.tenantId !== tenant.id) {
      return c.json({ error: "not_found" }, 404);
    }
    // Soft delete = mark sku with a tombstone suffix; keeps FKs intact
    // for audit. A future migration can hard-delete after retention.
    const tombstone = `${row.sku}__deleted_${Date.now()}`;
    await db
      .update(products)
      .set({ sku: tombstone })
      .where(eq(products.id, id));
    await auditEvent(db, {
      tenantId: tenant.id,
      actor: actor ?? null,
      action: "product.delete",
      targetType: "product",
      targetId: id,
      metadata: { originalSku: row.sku },
    });
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

app.get("/v1/launches", async (c) => {
  try {
    const db = createDbClient(c.env);
    const tenant = c.get("tenant") as Tenant;
    const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10) || 20, 100);
    const cursor = c.req.query("cursor");
    const status = c.req.query("status");
    const filters = [inArray(launchRuns.tenantId, visibleTenantIds(tenant))];
    if (cursor) filters.push(sql`${launchRuns.createdAt} < ${cursor}`);
    if (status) filters.push(eq(launchRuns.status, status));
    const rows = await db
      .select()
      .from(launchRuns)
      .where(and(...filters))
      .orderBy(desc(launchRuns.createdAt))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    const nextCursor = hasMore && items.length > 0
      ? items[items.length - 1].createdAt?.toISOString() ?? null
      : null;
    return c.json({ launches: items, hasMore, nextCursor });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

app.get("/v1/listings/:id", async (c) => {
  try {
    const db = createDbClient(c.env);
    const tenant = c.get("tenant") as Tenant;
    const id = c.req.param("id");
    const [row] = await db
      .select()
      .from(platformListings)
      .where(eq(platformListings.id, id))
      .limit(1);
    if (!row || !visibleTenantIds(tenant).includes(row.tenantId)) {
      return c.json({ error: "not_found" }, 404);
    }
    return c.json({ listing: row });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// Phase N3 — tenant settings: read + patch.
const TenantPatchInput = z.object({
  brand_hex: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  default_platforms: z.array(z.enum(["amazon", "shopify"])).optional(),
  // gated booleans the operator can self-flip
  amazon_a_plus_grid: z.boolean().optional(),
  rate_limit_per_min: z.number().int().min(10).max(6000).optional(),
  // not self-flippable from the dashboard:
  // production_pipeline, feedback_regen, has_sample_access — operator
  // (you) keeps those behind direct DB access.
});

app.patch("/v1/tenant", async (c) => {
  try {
    const db = createDbClient(c.env);
    const tenant = c.get("tenant") as Tenant;
    const actor = c.get("actor") as string | undefined;
    const body = await c.req.json();
    const parsed = TenantPatchInput.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", detail: parsed.error.flatten() }, 400);
    }
    const patch = parsed.data;
    const currentFeatures = (tenant.features ?? {}) as Record<string, unknown>;
    const nextFeatures = { ...currentFeatures };
    if (patch.brand_hex !== undefined) nextFeatures.brand_hex = patch.brand_hex;
    if (patch.default_platforms !== undefined) nextFeatures.default_platforms = patch.default_platforms;
    if (patch.amazon_a_plus_grid !== undefined) nextFeatures.amazon_a_plus_grid = patch.amazon_a_plus_grid;
    if (patch.rate_limit_per_min !== undefined) nextFeatures.rate_limit_per_min = patch.rate_limit_per_min;

    const [updated] = await db
      .update(tenants)
      .set({ features: nextFeatures })
      .where(eq(tenants.id, tenant.id))
      .returning();

    await auditEvent(db, {
      tenantId: tenant.id,
      actor: actor ?? null,
      action: "tenant.updated",
      targetType: "tenant",
      targetId: tenant.id,
      metadata: { fields: Object.keys(patch), nextFeatures: { ...patch } },
    });

    return c.json({
      tenant: {
        id: updated.id,
        name: updated.name,
        plan: updated.plan,
        features: updated.features,
      },
    });
  } catch (err) {
    console.error("[/v1/tenant PATCH]", err);
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// Phase M5 — per-tenant data export.
app.get("/v1/tenant/export", async (c) => {
  try {
    const db = createDbClient(c.env);
    const tenant = c.get("tenant") as Tenant;
    const { buildTenantExport } = await import("./lib/tenant-export.js");
    const zip = await buildTenantExport(db, { tenantId: tenant.id });
    return new Response(zip, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="tenant-${tenant.id.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.zip"`,
      },
    });
  } catch (err) {
    console.error("[/v1/tenant/export]", err);
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// Phase L4 — webhook subscription CRUD.
app.post("/v1/webhooks", async (c) => {
  try {
    const db = createDbClient(c.env);
    const tenant = c.get("tenant") as Tenant;
    const body = (await c.req.json()) as { url?: string; events?: string[] };
    if (!body.url || typeof body.url !== "string" || !Array.isArray(body.events) || body.events.length === 0) {
      return c.json({ error: "invalid_body", detail: "url + non-empty events[] required" }, 400);
    }
    try {
      new URL(body.url);
    } catch {
      return c.json({ error: "invalid_url" }, 400);
    }
    const { createSubscription } = await import("./lib/webhooks.js");
    const result = await createSubscription(db, {
      tenantId: tenant.id,
      url: body.url,
      events: body.events.map(String).slice(0, 30),
    });
    return c.json({
      subscription: {
        id: result.subscription.id,
        url: result.subscription.url,
        events: result.subscription.events,
        created_at: result.subscription.createdAt,
      },
      secret: result.secret, // returned exactly once
    });
  } catch (err) {
    console.error("[/v1/webhooks POST]", err);
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

app.get("/v1/webhooks", async (c) => {
  try {
    const db = createDbClient(c.env);
    const tenant = c.get("tenant") as Tenant;
    const { listSubscriptions } = await import("./lib/webhooks.js");
    const subs = await listSubscriptions(db, tenant.id);
    return c.json({ subscriptions: subs });
  } catch (err) {
    console.error("[/v1/webhooks GET]", err);
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

app.delete("/v1/webhooks/:id", async (c) => {
  try {
    const db = createDbClient(c.env);
    const tenant = c.get("tenant") as Tenant;
    const id = c.req.param("id");
    const { disableSubscription } = await import("./lib/webhooks.js");
    const ok = await disableSubscription(db, tenant.id, id);
    return c.json({ ok }, ok ? 200 : 404);
  } catch (err) {
    console.error("[/v1/webhooks/:id DELETE]", err);
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// Phase L1 — API key issuance / list / revoke.
app.post("/v1/api-keys", async (c) => {
  try {
    const db = createDbClient(c.env);
    const tenant = c.get("tenant") as Tenant;
    const actor = c.get("actor") as string | undefined;
    const body = (await c.req.json().catch(() => ({}))) as { name?: string };
    const name = (body.name ?? "").trim();
    if (!name || name.length > 80) {
      return c.json({ error: "invalid_name", message: "name required (≤80 chars)" }, 400);
    }
    const { issueApiKey } = await import("./lib/api-keys.js");
    const result = await issueApiKey(db, tenant.id, name, actor ?? null);
    return c.json({
      id: result.id,
      key: result.fullKey, // returned exactly once
      prefix: result.prefix,
      name: result.name,
      created_at: result.createdAt,
    });
  } catch (err) {
    console.error("[/v1/api-keys POST]", err);
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

app.get("/v1/api-keys", async (c) => {
  try {
    const db = createDbClient(c.env);
    const tenant = c.get("tenant") as Tenant;
    const { listApiKeys } = await import("./lib/api-keys.js");
    const keys = await listApiKeys(db, tenant.id);
    return c.json({ keys });
  } catch (err) {
    console.error("[/v1/api-keys GET]", err);
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

app.delete("/v1/api-keys/:id", async (c) => {
  try {
    const db = createDbClient(c.env);
    const tenant = c.get("tenant") as Tenant;
    const actor = c.get("actor") as string | undefined;
    const id = c.req.param("id");
    const { revokeApiKey } = await import("./lib/api-keys.js");
    const result = await revokeApiKey(db, c.env, tenant.id, id, actor ?? null);
    if (!result.ok) return c.json({ error: result.error }, 404);
    return c.json({ ok: true });
  } catch (err) {
    console.error("[/v1/api-keys/:id DELETE]", err);
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// Phase K3 — approve all assets + listings for a SKU.
app.post("/v1/skus/:productId/approve", async (c) => {
  try {
    const db = createDbClient(c.env);
    const tenant = c.get("tenant") as Tenant;
    const actor = c.get("actor") as string | undefined;
    const productId = c.req.param("productId");

    const [product] = await db
      .select()
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    if (!product || !visibleTenantIds(tenant).includes(product.tenantId)) {
      return c.json({ error: "not_found" }, 404);
    }

    const variantsList = await db
      .select({ id: productVariants.id })
      .from(productVariants)
      .where(eq(productVariants.productId, product.id));
    const variantIds = variantsList.map((v) => v.id);
    if (variantIds.length === 0) return c.json({ error: "no_variants" }, 400);

    const now = new Date();
    await db
      .update(platformAssets)
      .set({ approvedAt: now })
      .where(inArray(platformAssets.variantId, variantIds));
    await db
      .update(platformListings)
      .set({ approvedAt: now })
      .where(inArray(platformListings.variantId, variantIds));

    await auditEvent(db, {
      tenantId: product.tenantId,
      actor: actor ?? null,
      action: "listing.publish",
      targetType: "product",
      targetId: product.id,
      metadata: { sku: product.sku, approvedAt: now.toISOString() },
    });

    return c.json({ ok: true, approvedAt: now.toISOString() });
  } catch (err) {
    console.error("[/v1/skus/:productId/approve]", err);
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

app.post("/v1/skus/:productId/unapprove", async (c) => {
  try {
    const db = createDbClient(c.env);
    const tenant = c.get("tenant") as Tenant;
    const actor = c.get("actor") as string | undefined;
    const productId = c.req.param("productId");

    const [product] = await db
      .select()
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    if (!product || !visibleTenantIds(tenant).includes(product.tenantId)) {
      return c.json({ error: "not_found" }, 404);
    }
    const variantsList = await db
      .select({ id: productVariants.id })
      .from(productVariants)
      .where(eq(productVariants.productId, product.id));
    const variantIds = variantsList.map((v) => v.id);

    await db
      .update(platformAssets)
      .set({ approvedAt: null })
      .where(inArray(platformAssets.variantId, variantIds));
    await db
      .update(platformListings)
      .set({ approvedAt: null })
      .where(inArray(platformListings.variantId, variantIds));

    await auditEvent(db, {
      tenantId: product.tenantId,
      actor: actor ?? null,
      action: "listing.unpublish",
      targetType: "product",
      targetId: product.id,
      metadata: { sku: product.sku },
    });
    return c.json({ ok: true });
  } catch (err) {
    console.error("[/v1/skus/:productId/unapprove]", err);
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// Phase K3 — publish a SKU bundle to R2 + email a presigned link.
app.post("/v1/skus/:productId/publish", async (c) => {
  try {
    const db = createDbClient(c.env);
    const tenant = c.get("tenant") as Tenant;
    const actor = c.get("actor") as string | undefined;
    const productId = c.req.param("productId");
    const body = (await c.req.json().catch(() => ({}))) as { target?: string; email?: string };

    const target = body.target ?? "r2_export";
    if (target !== "r2_export") {
      return c.json({ error: "not_implemented", target }, 501);
    }

    const [product] = await db
      .select()
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    if (!product || !visibleTenantIds(tenant).includes(product.tenantId)) {
      return c.json({ error: "not_found" }, 404);
    }

    const { exportSkuToR2 } = await import("./lib/publish/r2-export.js");
    const runId = nanoid(12);
    const result = await exportSkuToR2(c.env, db, {
      tenantId: product.tenantId,
      productId: product.id,
      runId,
    });
    if (!result.ok) {
      return c.json({ error: "export_failed", reason: result.reason }, 500);
    }

    let emailResult: { ok: boolean; id?: string; error?: string } | null = null;
    if (body.email) {
      const { sendEmail, buildPublishEmail } = await import("./lib/email.js");
      const tpl = buildPublishEmail({
        sku: product.sku,
        productName: product.nameEn,
        presignedUrl: result.presignedUrl ?? "",
        amazonAssetCount: 0, // approximated in the manifest already
        shopifyAssetCount: 0,
      });
      emailResult = await sendEmail(c.env, {
        to: body.email,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
      });
    }

    await auditEvent(db, {
      tenantId: product.tenantId,
      actor: actor ?? null,
      action: "listing.publish",
      targetType: "product",
      targetId: product.id,
      metadata: {
        target,
        runId,
        zipKey: result.zipKey,
        fileCount: result.fileCount,
        emailed: !!emailResult?.ok,
      },
    });

    return c.json({
      ok: true,
      runId,
      zipKey: result.zipKey,
      presignedUrl: result.presignedUrl,
      fileCount: result.fileCount,
      email: emailResult,
    });
  } catch (err) {
    console.error("[/v1/skus/:productId/publish]", err);
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// Phase K2 — feedback-driven asset regeneration. Behind tenant.features.feedback_regen.
app.post("/v1/assets/:id/regenerate", async (c) => {
  try {
    const db = createDbClient(c.env);
    const tenant = c.get("tenant") as Tenant;
    const actor = c.get("actor") as string | undefined;
    const id = c.req.param("id");
    const body = (await c.req.json()) as { feedback?: string; chips?: string[] };

    const features = (tenant.features ?? {}) as Record<string, unknown>;
    if (features.feedback_regen !== true) {
      return c.json({ error: "feature_disabled", feature: "feedback_regen" }, 403);
    }

    const { checkRegenCap } = await import("./lib/regen-cap.js");
    const cap = await checkRegenCap(db, tenant.id);
    if (!cap.allowed) {
      return c.json(
        { error: "monthly_cap_reached", used: cap.used, cap: cap.cap },
        429
      );
    }

    const { regenerateAsset } = await import("./lib/regenerate-asset.js");
    const result = await regenerateAsset(c.env, db, {
      assetId: id,
      tenantIdsInScope: visibleTenantIds(tenant),
      tenantId: tenant.id,
      actor: actor ?? null,
      feedback: typeof body.feedback === "string" ? body.feedback : "",
      chips: Array.isArray(body.chips) ? body.chips.slice(0, 6).map(String) : [],
    });
    if (!result.ok) {
      const status = result.reason === "not_found" ? 404
        : result.reason === "wallet" ? 402
        : result.reason === "fal_missing" ? 503
        : 500;
      return c.json({ error: result.reason, message: result.message }, status);
    }
    return c.json({
      asset: result.asset,
      r2Url: result.newR2Url,
      costCents: result.costCents,
      cap: { used: cap.used + 1, cap: cap.cap },
    });
  } catch (err) {
    console.error("[/v1/assets/:id/regenerate]", err);
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// Phase K2 — read current month's regen cap status.
app.get("/v1/assets/regen-cap", async (c) => {
  try {
    const db = createDbClient(c.env);
    const tenant = c.get("tenant") as Tenant;
    const { checkRegenCap } = await import("./lib/regen-cap.js");
    const cap = await checkRegenCap(db, tenant.id);
    return c.json(cap);
  } catch (err) {
    console.error("[/v1/assets/regen-cap]", err);
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// Phase K1 — PATCH a listing with version-trail + brand-rules validation.
app.patch("/v1/listings/:id", async (c) => {
  try {
    const db = createDbClient(c.env);
    const tenant = c.get("tenant") as Tenant;
    const actor = c.get("actor") as string | undefined;
    const id = c.req.param("id");

    const body = await c.req.json();
    if (!body || typeof body !== "object" || typeof body.patch !== "object") {
      return c.json({ error: "patch object required" }, 400);
    }

    const { applyListingEdit } = await import("./lib/listing-edit.js");
    const result = await applyListingEdit(db, {
      listingId: id,
      tenantIdsInScope: visibleTenantIds(tenant),
      actor: actor ?? null,
      patch: body.patch,
    });

    if (!result.ok) {
      return c.json({ error: result.reason, issues: result.issues }, result.reason === "not_found" ? 404 : 400);
    }
    return c.json({ listing: result.listing, rating: result.rating, issues: result.issues });
  } catch (err) {
    console.error("[/v1/listings/:id PATCH]", err);
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// Phase K1 — list version history for a listing.
app.get("/v1/listings/:id/versions", async (c) => {
  try {
    const db = createDbClient(c.env);
    const tenant = c.get("tenant") as Tenant;
    const id = c.req.param("id");
    const { listListingVersions } = await import("./lib/listing-edit.js");
    const versions = await listListingVersions(db, id, visibleTenantIds(tenant));
    if (versions === null) return c.json({ error: "not_found" }, 404);
    return c.json({ versions });
  } catch (err) {
    console.error("[/v1/listings/:id/versions]", err);
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// Phase J3 — paginated audit log for the current tenant.
app.get("/v1/audit", async (c) => {
  try {
    const db = createDbClient(c.env);
    const tenant = c.get("tenant") as Tenant;
    const tids = visibleTenantIds(tenant);

    const limit = Math.min(
      Math.max(parseInt(c.req.query("limit") ?? "100", 10) || 100, 1),
      500
    );
    const offset = Math.max(parseInt(c.req.query("offset") ?? "0", 10) || 0, 0);
    const actionsParam = c.req.query("actions");
    const actorParam = c.req.query("actor");

    const filters = [inArray(auditEvents.tenantId, tids)];
    if (actionsParam) {
      const list = actionsParam
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (list.length > 0) filters.push(inArray(auditEvents.action, list));
    }
    if (actorParam) {
      filters.push(eq(auditEvents.actor, actorParam));
    }

    const format = c.req.query("format");
    const isCsv = format === "csv";
    const fetchLimit = isCsv ? Math.min(limit * 50, 10_000) : limit + 1;

    const rows = await db
      .select()
      .from(auditEvents)
      .where(and(...filters))
      .orderBy(desc(auditEvents.at))
      .limit(fetchLimit)
      .offset(offset);

    if (isCsv) {
      const cols = ["id", "at", "actor", "action", "target_type", "target_id", "metadata"];
      const escape = (s: unknown): string => {
        if (s === null || s === undefined) return "";
        const str = typeof s === "string" ? s : JSON.stringify(s);
        if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
        return str;
      };
      const lines = [cols.join(",")];
      for (const r of rows) {
        lines.push([
          escape(r.id),
          escape(r.at?.toISOString() ?? ""),
          escape(r.actor),
          escape(r.action),
          escape(r.targetType),
          escape(r.targetId),
          escape(r.metadata),
        ].join(","));
      }
      return new Response(lines.join("\n"), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="audit-${tenant.id.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      });
    }

    const hasMore = rows.length > limit;
    return c.json({
      events: rows.slice(0, limit),
      hasMore,
      nextOffset: hasMore ? offset + limit : null,
    });
  } catch (err) {
    console.error("[/v1/audit]", err);
    return c.json(
      { events: [], error: err instanceof Error ? err.message : String(err) },
      500
    );
  }
});

// Transport registry — keyed by sessionId so GET /sse and POST /messages share state
const transports = new Map<string, Transport>();
// Phase L3 — per-session tenant binding. Populated when /sse connects with
// a valid ff_live_* api_key query param. Tools read this via getSessionTenant().
const sessionTenants = new Map<string, { tenantId: string; apiKeyId: string }>();
export function getSessionTenant(sessionId: string): { tenantId: string; apiKeyId: string } | null {
  return sessionTenants.get(sessionId) ?? null;
}

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

// SSE endpoint — Claude Desktop connects here for MCP communication.
// Phase L3 — accepts an optional `?api_key=ff_live_*` query param. When
// present and valid, tools resolve to the bound tenant; without it, the
// session falls through to legacy read-only sample data.
app.get("/sse", async (c) => {
  const sessionId = crypto.randomUUID();
  const apiKey = c.req.query("api_key");
  if (apiKey && apiKey.startsWith("ff_live_")) {
    try {
      const db = createDbClient(c.env);
      const { verifyApiKey } = await import("./lib/api-keys.js");
      const resolved = await verifyApiKey(c.env, db, apiKey);
      if (resolved) {
        sessionTenants.set(sessionId, {
          tenantId: resolved.tenantId,
          apiKeyId: resolved.apiKeyId,
        });
      }
    } catch (err) {
      console.warn("[/sse api_key resolve]", err);
    }
  }
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
      sessionTenants.delete(sessionId);
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
    const tenant = c.get("tenant") as Tenant;
    const tids = visibleTenantIds(tenant);
    const v2Rows = await db
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
        tenantId: platformAssets.tenantId,
      })
      .from(platformAssets)
      .leftJoin(productVariants, eq(platformAssets.variantId, productVariants.id))
      .leftJoin(products, eq(productVariants.productId, products.id))
      .leftJoin(sellerProfiles, eq(products.sellerId, sellerProfiles.id))
      .where(inArray(platformAssets.tenantId, tids))
      .orderBy(desc(platformAssets.createdAt))
      .limit(100);

    // Phase J4 — derive a 250×250 thumb URL when a CF-zone-bound R2 host
    // is configured (R2_THUMB_HOST). Falls back to the original r2Url so
    // the dashboard still renders without the binding.
    const thumbHost = c.env.R2_THUMB_HOST?.replace(/\/$/, "");
    const withThumbs = v2Rows.map((row) => {
      let thumbUrl: string | null = row.r2Url;
      if (thumbHost) {
        try {
          const u = new URL(row.r2Url);
          thumbUrl = `${thumbHost}/cdn-cgi/image/width=250,height=250,fit=cover,quality=80${u.pathname}`;
        } catch {
          thumbUrl = row.r2Url;
        }
      }
      return { ...row, thumbUrl };
    });
    return c.json({ legacy: [], platformAssets: withThumbs });
  } catch (err) {
    console.error("[/api/assets]", err);
    return c.json({ legacy: [], platformAssets: [] });
  }
});

app.get("/api/costs", async (c) => {
  try {
    const db = createDbClient(c.env);
    const tenant = c.get("tenant") as Tenant;
    const tids = visibleTenantIds(tenant);
    const [row] = await db
      .select({
        totalSpend: sql<string>`coalesce(sum(total_cost_usd), 0)`,
        runs: sql<string>`count(*)`,
        totalFlux: sql<string>`coalesce(sum(flux_calls), 0)`,
        totalGpt: sql<string>`coalesce(sum(gpt_image_2_calls), 0)`,
        totalKling: sql<string>`coalesce(sum(kling_calls), 0)`,
      })
      .from(runCosts)
      .where(inArray(runCosts.tenantId, tids));
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
    const tenant = c.get("tenant") as Tenant;
    const tids = visibleTenantIds(tenant);
    const rows = await db
      .select()
      .from(runCosts)
      .where(inArray(runCosts.tenantId, tids))
      .orderBy(desc(runCosts.runAt))
      .limit(30);
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
    const tenant = c.get("tenant") as Tenant;
    const tids = visibleTenantIds(tenant);
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
      .where(inArray(launchRuns.tenantId, tids))
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
    const tenant = c.get("tenant") as Tenant;
    const tids = visibleTenantIds(tenant);
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
        tenantId: products.tenantId,
        isSample: sql<boolean>`${products.tenantId} = ${SAMPLE_TENANT_ID}`,
      })
      .from(products)
      .leftJoin(sellerProfiles, eq(products.sellerId, sellerProfiles.id))
      .where(inArray(products.tenantId, tids))
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
    tenantId: SAMPLE_TENANT_ID, // Phase G — synth path attributes to sample tenant
    sellerId: "00000000-0000-0000-0000-000000000000",
    sku: `DEMO-${Date.now()}`,
    nameEn: p.product_name_en,
    nameZh: p.product_name_zh ?? null,
    description: null,
    category: p.product_category,
    kind: "compact_square",
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
      env: c.env,
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
