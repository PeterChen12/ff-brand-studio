import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  numeric,
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
