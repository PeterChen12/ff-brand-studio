/**
 * Phase I, I5 — Production-pipeline slot matrix.
 *
 * Emits the per-platform slot list with each slot mapped to the
 * pipeline output it should attach to. The orchestrator iterates
 * the matrix after all pipeline outputs land and writes one
 * platform_assets row per (platform, slot).
 */

import type { LaunchPlatform } from "../orchestrator/planner.js";
import type { TenantFeatures } from "./types.js";

export type PipelineSource =
  | "refine_studio"
  | "refine_crop_A"
  | "refine_crop_B"
  | "refine_crop_C"
  | "lifestyle"
  | "composite_detail_1"
  | "composite_detail_2"
  | "composite_detail_3"
  | "banner";

export interface SlotTarget {
  platform: LaunchPlatform;
  slot: string;
  source: PipelineSource;
  notes?: string;
}

export const AMAZON_SLOTS: SlotTarget[] = [
  { platform: "amazon", slot: "main", source: "refine_studio", notes: "white-bg, ≥85% fill, no text, 2000×2000" },
  { platform: "amazon", slot: "lifestyle", source: "lifestyle", notes: "text-free in-use scene" },
  { platform: "amazon", slot: "a_plus_feature_1", source: "composite_detail_1" },
  { platform: "amazon", slot: "a_plus_feature_2", source: "composite_detail_2" },
  { platform: "amazon", slot: "a_plus_feature_3_grid", source: "composite_detail_3" },
  { platform: "amazon", slot: "close_up", source: "refine_crop_C" },
];

const AMAZON_GRID_OPT_IN: SlotTarget = {
  platform: "amazon",
  slot: "comparison_grid",
  source: "composite_detail_3",
  notes: "tenant.features.amazon_a_plus_grid",
};

export const SHOPIFY_SLOTS: SlotTarget[] = [
  { platform: "shopify", slot: "main", source: "refine_studio" },
  { platform: "shopify", slot: "lifestyle", source: "lifestyle" },
  { platform: "shopify", slot: "detail", source: "composite_detail_1" },
  { platform: "shopify", slot: "close_up", source: "refine_crop_B", notes: "different crop than Amazon close" },
  { platform: "shopify", slot: "banner", source: "banner", notes: "16:9 hero with brand-color extension" },
];

export interface PlanProductionInput {
  platforms: LaunchPlatform[];
  features: TenantFeatures;
}

export function planProductionSlots(input: PlanProductionInput): SlotTarget[] {
  const out: SlotTarget[] = [];
  for (const p of input.platforms) {
    if (p === "amazon") {
      out.push(...AMAZON_SLOTS);
      if (input.features.amazon_a_plus_grid) out.push(AMAZON_GRID_OPT_IN);
    } else if (p === "shopify") {
      out.push(...SHOPIFY_SLOTS);
    }
  }
  return out;
}
