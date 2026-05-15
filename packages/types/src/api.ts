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
  // Issue D — true when the row is owned by SAMPLE_TENANT_ID, so the
  // dashboard can badge demo SKUs without leaking the constant. Optional
  // for backwards compat with payloads served before the worker rolled out.
  isSample: z.boolean().optional(),
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

// ── Phase G · G01 — canonical TenantFeatures schema ─────────────────────────
//
// The `tenants.features` column is jsonb. Before this schema, the worker
// (`pipeline/types.ts`) and dashboard (`lib/tenant-context.tsx`) each
// defined their own free-form TenantFeatures interface and diverged.
// One source of truth here. Unknown keys pass through via `.passthrough()`
// so operator-side experiments don't fail the parse for older clients;
// known keys are still validated.
//
// Key buckets:
//   - Operator-managed gates: shipped/closed-flippable features
//   - User-managed preferences: surfaced in Settings → Brand profile
//   - Operational caps: per-tenant limits beyond plan defaults
//   - Pipeline tuning: knobs that override the deriver registry defaults
//   - Adapter destinations: which channels this tenant publishes to
export const TenantFeaturesSchema = z
  .object({
    // Operator-managed gates
    production_pipeline: z.boolean().optional(),
    feedback_regen: z.boolean().optional(),
    has_sample_access: z.boolean().optional(),
    amazon_a_plus_grid: z.boolean().optional(),
    passthrough_enabled: z.boolean().optional(),
    regulated_category: z.boolean().optional(),
    adapter_stage_enabled: z.boolean().optional(),
    developer_mode: z.boolean().optional(),
    skipped_onboarding: z.boolean().optional(),
    // User-managed preferences
    default_platforms: z.array(z.enum(["amazon", "shopify"])).optional(),
    default_output_langs: z.array(z.enum(["en", "zh"])).optional(),
    default_quality_preset: z.enum(["budget", "balanced", "premium"]).optional(),
    language_display: z.enum(["en", "zh", "both"]).optional(),
    brand_hex: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "must be a 6-digit hex like #1C3FAA")
      .optional(),
    // Operational caps
    max_regens_per_month: z.number().int().min(0).max(1000).optional(),
    rate_limit_per_min: z.number().int().min(10).max(6000).optional(),
    rate_limit_disabled: z.boolean().optional(),
    // Pipeline tuning (Phase G · G09 + G11)
    clip_threshold_overrides: z.record(z.string(), z.number().min(0).max(1)).optional(),
    /** Phase G · G11 — RGB channel tolerance for forceWhiteBackground's
     *  near-white snap. Default 8 matches the v2 Python prototype. Brands
     *  with cream/ivory studio backdrops can raise to ~16 so the snap
     *  catches the off-white pack shot. Capped at 64. */
    force_white_bg_tolerance: z.number().int().min(0).max(64).optional(),
    // Adapter destinations
    publish_destinations: z.array(z.string()).optional(),
  })
  .passthrough();
export type TenantFeatures = z.infer<typeof TenantFeaturesSchema>;
