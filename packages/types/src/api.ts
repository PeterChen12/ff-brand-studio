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

// ── /api/assets — list of asset rows (most-recent 50) ────────────────────────

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

export const ApiAssetsResponseSchema = z.object({
  assets: z.array(AssetRowSchema),
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
