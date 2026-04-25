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
} from "drizzle-orm/pg-core";

export const assets = pgTable("assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  r2Key: text("r2_key").notNull().unique(),
  assetType: text("asset_type").notNull(),
  campaign: text("campaign"),
  platform: text("platform"),
  locale: text("locale"),
  brandScore: integer("brand_score"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const runCosts = pgTable("run_costs", {
  id: uuid("id").primaryKey().defaultRandom(),
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
  orgNameEn: text("org_name_en").notNull(),
  orgNameZh: text("org_name_zh"),
  contactEmail: text("contact_email"),
  brandVoice: jsonb("brand_voice"),
  amazonSellerId: text("amazon_seller_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const products = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  sellerId: uuid("seller_id")
    .notNull()
    .references(() => sellerProfiles.id, { onDelete: "cascade" }),
  sku: text("sku").notNull().unique(),
  nameEn: text("name_en").notNull(),
  nameZh: text("name_zh"),
  category: text("category").notNull(),
  dimensions: jsonb("dimensions"),
  materials: text("materials").array(),
  colorsHex: text("colors_hex").array(),
  loraUrl: text("lora_url"),
  triggerPhrase: text("trigger_phrase"),
  brandConfig: jsonb("brand_config"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const productReferences = pgTable("product_references", {
  id: uuid("id").primaryKey().defaultRandom(),
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

export const launchRuns = pgTable("launch_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
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
});

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
