import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  numeric,
  boolean,
  primaryKey,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { desc } from "drizzle-orm";

// ── Phase G: tenancy ───────────────────────────────────────────────────────

export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkOrgId: text("clerk_org_id").notNull().unique(),
    name: text("name").notNull(),
    stripeCustomerId: text("stripe_customer_id"),
    walletBalanceCents: integer("wallet_balance_cents").notNull().default(500),
    plan: text("plan").notNull().default("free"),
    features: jsonb("features").notNull().default({}),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    clerkOrgIdx: index("idx_tenants_clerk_org_id").on(t.clerkOrgId),
  })
);

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    r2Key: text("r2_key").notNull().unique(),
    assetType: text("asset_type").notNull(),
    campaign: text("campaign"),
    platform: text("platform"),
    locale: text("locale"),
    brandScore: integer("brand_score"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    // P2-4 — list reads filter by tenant + sort by created_at
    tenantCreatedIdx: index("idx_assets_tenant_created").on(
      t.tenantId,
      desc(t.createdAt)
    ),
  })
);

export const runCosts = pgTable("run_costs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  campaign: text("campaign"),
  runAt: timestamp("run_at").defaultNow(),
  gptImage2Calls: integer("gpt_image_2_calls").default(0),
  fluxCalls: integer("flux_calls").default(0),
  klingCalls: integer("kling_calls").default(0),
  claudeInputTokens: integer("claude_input_tokens").default(0),
  claudeOutputTokens: integer("claude_output_tokens").default(0),
  totalCostUsd: numeric("total_cost_usd", { precision: 10, scale: 4 }),
});

export type Asset = typeof assets.$inferSelect;
export type NewAsset = typeof assets.$inferInsert;
export type RunCost = typeof runCosts.$inferSelect;
export type NewRunCost = typeof runCosts.$inferInsert;

// ── v2 ecommerce-imagery schema (Phase 1) ──────────────────────────────────

export const sellerProfiles = pgTable("seller_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  orgNameEn: text("org_name_en").notNull(),
  orgNameZh: text("org_name_zh"),
  contactEmail: text("contact_email"),
  brandVoice: jsonb("brand_voice"),
  amazonSellerId: text("amazon_seller_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    sellerId: uuid("seller_id")
      .notNull()
      .references(() => sellerProfiles.id, { onDelete: "cascade" }),
    sku: text("sku").notNull().unique(),
    nameEn: text("name_en").notNull(),
    nameZh: text("name_zh"),
    description: text("description"),
    category: text("category").notNull(),
    kind: text("kind").notNull().default("compact_square"),
    dimensions: jsonb("dimensions"),
    materials: text("materials").array(),
    colorsHex: text("colors_hex").array(),
    loraUrl: text("lora_url"),
    triggerPhrase: text("trigger_phrase"),
    brandConfig: jsonb("brand_config"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    // P1-3 — composite index drives /v1/products cursor pagination.
    tenantCreatedIdx: index("idx_products_tenant_created").on(
      t.tenantId,
      desc(t.createdAt)
    ),
  })
);

export const productReferences = pgTable("product_references", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),
  r2Url: text("r2_url").notNull(),
  kind: text("kind").notNull(),
  uploadedBy: text("uploaded_by"),
  approvedAt: timestamp("approved_at"),
});

export const productVariants = pgTable("product_variants", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),
  color: text("color"),
  pattern: text("pattern"),
  generatedCount: integer("generated_count").default(0),
});

export const platformAssets = pgTable(
  "platform_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    slot: text("slot").notNull(),
    r2Url: text("r2_url").notNull(),
    width: integer("width"),
    height: integer("height"),
    fileSizeBytes: integer("file_size_bytes"),
    format: text("format"),
    complianceScore: text("compliance_score"),
    complianceIssues: jsonb("compliance_issues"),
    // P1 #7: default to [] so Phase 4 evaluator-optimizer appends without
    // null-checks on every iteration.
    refinementHistory: jsonb("refinement_history").default([]),
    status: text("status").notNull().default("draft"),
    modelUsed: text("model_used"),
    costCents: integer("cost_cents"),
    generationParams: jsonb("generation_params"),
    approvedAt: timestamp("approved_at"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    // P0 #3: declare the unique index here so Drizzle's onConflictDoUpdate
    // knows about it. Matches the SQL `platform_assets_uniq_variant_slot`.
    uniqVariantSlot: uniqueIndex("platform_assets_uniq_variant_slot").on(
      t.variantId,
      t.platform,
      t.slot
    ),
  })
);

export const platformSpecs = pgTable(
  "platform_specs",
  {
    platform: text("platform").notNull(),
    slot: text("slot").notNull(),
    minWidth: integer("min_width"),
    maxWidth: integer("max_width"),
    minHeight: integer("min_height"),
    maxHeight: integer("max_height"),
    aspectRatio: text("aspect_ratio"),
    fileSizeMinBytes: integer("file_size_min_bytes"),
    fileSizeMaxBytes: integer("file_size_max_bytes"),
    colorProfile: text("color_profile"),
    backgroundRule: text("background_rule"),
    allowsText: boolean("allows_text"),
    allowsProps: boolean("allows_props"),
    formatAllowlist: text("format_allowlist").array(),
    notes: text("notes"),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.platform, t.slot] }),
  })
);

export const launchRuns = pgTable(
  "launch_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    orchestratorModel: text("orchestrator_model").notNull(),
    totalCostCents: integer("total_cost_cents").default(0),
    durationMs: integer("duration_ms"),
    hitlInterventions: integer("hitl_interventions").default(0),
    status: text("status").default("pending"),
    langfuseTraceId: text("langfuse_trace_id"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    // P1-4 — drives /v1/launches cursor pagination + /api/launches list
    tenantCreatedIdx: index("idx_launch_runs_tenant_created").on(
      t.tenantId,
      desc(t.createdAt)
    ),
  })
);

export type SellerProfile = typeof sellerProfiles.$inferSelect;
export type NewSellerProfile = typeof sellerProfiles.$inferInsert;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type ProductReference = typeof productReferences.$inferSelect;
export type NewProductReference = typeof productReferences.$inferInsert;
export type ProductVariant = typeof productVariants.$inferSelect;
export type NewProductVariant = typeof productVariants.$inferInsert;
export type PlatformAsset = typeof platformAssets.$inferSelect;
export type NewPlatformAsset = typeof platformAssets.$inferInsert;
export type PlatformSpec = typeof platformSpecs.$inferSelect;
export type NewPlatformSpec = typeof platformSpecs.$inferInsert;
export type LaunchRun = typeof launchRuns.$inferSelect;
export type NewLaunchRun = typeof launchRuns.$inferInsert;

// ── Phase G: SEO copy persistence + wallet + audit ────────────────────────

export const platformListings = pgTable(
  "platform_listings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    surface: text("surface").notNull(),
    language: text("language").notNull(),
    copy: jsonb("copy").notNull(),
    flags: jsonb("flags").notNull().default([]),
    violations: jsonb("violations").notNull().default([]),
    rating: text("rating"),
    iterations: integer("iterations").notNull().default(1),
    costCents: integer("cost_cents").notNull().default(0),
    status: text("status").notNull().default("draft"),
    approvedAt: timestamp("approved_at"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (t) => ({
    uniqVariantSurfaceLang: uniqueIndex("uniq_variant_surface_lang").on(
      t.variantId,
      t.surface,
      t.language
    ),
    tenantIdx: index("idx_listings_tenant").on(t.tenantId),
  })
);

export const platformListingsVersions = pgTable(
  "platform_listings_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parentListingId: uuid("parent_listing_id")
      .notNull()
      .references(() => platformListings.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    variantId: uuid("variant_id").notNull(),
    surface: text("surface").notNull(),
    language: text("language").notNull(),
    copy: jsonb("copy").notNull(),
    flags: jsonb("flags").notNull().default([]),
    violations: jsonb("violations").notNull().default([]),
    rating: text("rating"),
    iterations: integer("iterations").notNull().default(1),
    costCents: integer("cost_cents").notNull().default(0),
    status: text("status").notNull(),
    version: integer("version").notNull(),
    archivedAt: timestamp("archived_at").defaultNow(),
  },
  (t) => ({
    parentIdx: index("idx_listings_versions_parent").on(
      t.parentListingId,
      t.version
    ),
  })
);

// Image QA Layer 1 + Layer 3 — observable trail of every per-image
// judgment. Layer 1 writes 'similarity' + 'framing' rows from Haiku
// 4.5; Layer 3 writes 'client' rows when the operator iterates via the
// chat panel; Layer 2 (later) writes 'consistency' rows.
export const imageQaJudgments = pgTable(
  "image_qa_judgments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => platformAssets.id, { onDelete: "cascade" }),
    judgeId: text("judge_id").notNull(),
    verdict: text("verdict").notNull(),
    reason: text("reason"),
    model: text("model"),
    costCents: integer("cost_cents").notNull().default(0),
    iteration: integer("iteration").notNull().default(1),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    assetCreatedIdx: index("idx_image_qa_asset_created").on(
      t.assetId,
      desc(t.createdAt)
    ),
    assetJudgeIdx: index("idx_image_qa_asset_judge").on(t.assetId, t.judgeId),
    tenantCreatedIdx: index("idx_image_qa_tenant_created").on(
      t.tenantId,
      desc(t.createdAt)
    ),
  })
);

export const walletLedger = pgTable(
  "wallet_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    deltaCents: integer("delta_cents").notNull(),
    reason: text("reason").notNull(),
    referenceType: text("reference_type"),
    referenceId: uuid("reference_id"),
    balanceAfterCents: integer("balance_after_cents").notNull(),
    at: timestamp("at").defaultNow(),
  },
  (t) => ({
    tenantAtIdx: index("idx_wallet_ledger_tenant_at").on(t.tenantId, t.at),
  })
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    prefix: text("prefix").notNull(),
    hash: text("hash").notNull(),
    name: text("name").notNull(),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").defaultNow(),
    lastUsedAt: timestamp("last_used_at"),
    revokedAt: timestamp("revoked_at"),
  },
  (t) => ({
    prefixIdx: index("idx_api_keys_prefix").on(t.prefix),
    tenantIdx: index("idx_api_keys_tenant").on(t.tenantId),
  })
);

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;

export const webhookSubscriptions = pgTable(
  "webhook_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    url: text("url").notNull(),
    events: text("events").array().notNull(),
    secret: text("secret").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    disabledAt: timestamp("disabled_at"),
  },
  (t) => ({
    tenantIdx: index("idx_webhook_subs_tenant").on(t.tenantId),
  })
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => webhookSubscriptions.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    statusCode: integer("status_code"),
    responseBody: text("response_body"),
    attempt: integer("attempt").notNull().default(1),
    deliveredAt: timestamp("delivered_at"),
    nextAttemptAt: timestamp("next_attempt_at"),
  },
  (t) => ({
    subIdx: index("idx_webhook_deliv_sub").on(t.subscriptionId),
  })
);

export type WebhookSubscription = typeof webhookSubscriptions.$inferSelect;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    actor: text("actor"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: uuid("target_id"),
    metadata: jsonb("metadata").notNull().default({}),
    at: timestamp("at").defaultNow(),
  },
  (t) => ({
    tenantAtIdx: index("idx_audit_events_tenant_at").on(t.tenantId, t.at),
    actionIdx: index("idx_audit_events_action").on(t.action, t.at),
  })
);

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type PlatformListing = typeof platformListings.$inferSelect;
export type NewPlatformListing = typeof platformListings.$inferInsert;
export type PlatformListingVersion = typeof platformListingsVersions.$inferSelect;
export type WalletLedgerEntry = typeof walletLedger.$inferSelect;
export type NewWalletLedgerEntry = typeof walletLedger.$inferInsert;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;

/**
 * Hard-coded UUID for the legacy-demo "Sample Catalog" tenant. Every row
 * created before Phase G is owned by this tenant; new signups also see
 * it as a read-only sample via tenant.features.has_sample_access.
 */
export const SAMPLE_TENANT_ID = "00000000-0000-0000-0000-000000000001";
