/**
 * v2 Phase C — public API contract for the dashboard ↔ Worker boundary.
 *
 * Three read-only HTTP endpoints. Schemas here are the SINGLE SOURCE OF
 * TRUTH for response shape; the Worker handlers infer their return type
 * from these and the dashboard parses inbound JSON against them. If a
 * Worker handler ever returns a shape the dashboard doesn't expect,
 * type-check + (optional) runtime parse catches it before the user does.
 *
 * See docs/API_CONTRACT.md for endpoint URLs + examples.
 */
import { z } from "zod";

// ── /api/assets — v1 legacy heroes + v2 platform assets joined to SKUs ────

export const AssetRowSchema = z.object({
  id: z.string().uuid(),
  r2Key: z.string(),
  assetType: z.string(),
  campaign: z.string().nullable(),
  platform: z.string().nullable(),
  locale: z.string().nullable(),
  brandScore: z.number().int().nullable(),
  metadata: z.unknown(),
  createdAt: z.string().datetime().nullable(),
});
export type AssetRow = z.infer<typeof AssetRowSchema>;

// v2 platform asset row — joined with the parent product so the dashboard
// can render meaningful titles like "FF-DEMO-ROD-12FT · Amazon · Main"
// instead of raw R2 keys.
export const PlatformAssetRowSchema = z.object({
  id: z.string().uuid(),
  variantId: z.string().uuid(),
  platform: z.string(),
  slot: z.string(),
  r2Url: z.string(),
  thumbUrl: z.string().nullable().optional(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  format: z.string().nullable(),
  complianceScore: z.string().nullable(),
  status: z.string(),
  modelUsed: z.string().nullable(),
  costCents: z.number().int().nullable(),
  createdAt: z.string().datetime().nullable(),
  // Joined product/seller info — null when the join doesn't resolve
  productId: z.string().uuid().nullable(),
  sku: z.string().nullable(),
  productNameEn: z.string().nullable(),
  productNameZh: z.string().nullable(),
  category: z.string().nullable(),
  sellerNameEn: z.string().nullable(),
});
export type PlatformAssetRow = z.infer<typeof PlatformAssetRowSchema>;

export const ApiAssetsResponseSchema = z.object({
  legacy: z.array(AssetRowSchema),
  platformAssets: z.array(PlatformAssetRowSchema),
});
export type ApiAssetsResponse = z.infer<typeof ApiAssetsResponseSchema>;

// ── /api/runs — list of run_costs rows (most-recent 30) ──────────────────────

export const RunCostRowSchema = z.object({
  id: z.string().uuid(),
  campaign: z.string().nullable(),
  runAt: z.string().datetime().nullable(),
  gptImage2Calls: z.number().int().nullable(),
  fluxCalls: z.number().int().nullable(),
  klingCalls: z.number().int().nullable(),
  claudeInputTokens: z.number().int().nullable(),
  claudeOutputTokens: z.number().int().nullable(),
  totalCostUsd: z.string().nullable(), // numeric serialized as string
});
export type RunCostRow = z.infer<typeof RunCostRowSchema>;

export const ApiRunsResponseSchema = z.object({
  runs: z.array(RunCostRowSchema),
});
export type ApiRunsResponse = z.infer<typeof ApiRunsResponseSchema>;

// ── /api/costs — aggregated cost totals across all runs ──────────────────────

export const ApiCostsResponseSchema = z.object({
  totalSpend: z.number(),
  runs: z.number().int(),
  totalFlux: z.number().int(),
  totalGpt: z.number().int(),
  totalKling: z.number().int(),
});
export type ApiCostsResponse = z.infer<typeof ApiCostsResponseSchema>;
