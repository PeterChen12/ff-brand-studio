import type { Product } from "../db/schema.js";

/**
 * v2 Phase 3 planner — decides the work list for one SKU launch.
 *
 * Pure JS heuristic for the Phase 3 stub. Phase 4+ will swap in a Sonnet 4.6
 * call (see system prompt skeleton at end of file) when the planner needs
 * to reason about reference-image quality, brand voice, or category nuance.
 *
 * Heuristics encode the v2 plan's defaults (§3.3):
 *  - apparel/hat: 2 lifestyle scenes
 *  - drinkware:   3 lifestyle scenes
 *  - tech-acc:    1 lifestyle scene
 *  - default:     2 lifestyle scenes
 *  - LoRA train:  yes if ≥15 references and no existing lora_url
 *  - video:       only if seller has amazon_seller_id AND category != tech-acc
 */

export type LaunchPlatform = "amazon" | "shopify";

export interface PlanInput {
  product: Product;
  reference_count: number;
  has_amazon_seller_id: boolean;
  platforms: LaunchPlatform[];
  include_video: boolean;
}

export interface PlannedWork {
  white_bg: { product_id: string; aspect: "1:1" };
  lifestyles: Array<{ product_id: string; scene_hint: string; aspect: "1:1" | "3:4" | "16:9" }>;
  variants: Array<{ product_id: string; scene_hint: string }>;
  train_lora: boolean;
  produce_video: boolean;
  platforms: LaunchPlatform[];
  // Set of (platform, slot) tuples the adapter layer will fan out to.
  adapter_targets: Array<{ platform: LaunchPlatform; slot: string }>;
}

const LIFESTYLE_COUNT_BY_CATEGORY: Record<string, number> = {
  apparel: 2,
  hat: 2,
  drinkware: 3,
  "tech-acc": 1,
  bag: 2,
  other: 2,
};

const ADAPTER_SLOTS: Record<LaunchPlatform, string[]> = {
  amazon: [
    "main",
    "a_plus_feature_1",
    "a_plus_feature_2",
    "a_plus_feature_3_grid",
    "lifestyle",
  ],
  shopify: ["main", "lifestyle", "banner", "detail"],
};

export function planSkuLaunch(input: PlanInput): PlannedWork {
  const { product, reference_count, has_amazon_seller_id, platforms, include_video } = input;

  const lifestyleCount =
    LIFESTYLE_COUNT_BY_CATEGORY[product.category] ?? 2;
  const lifestyles = Array.from({ length: lifestyleCount }, (_, i) => ({
    product_id: product.id,
    scene_hint: `default_lifestyle_${i + 1}`,
    aspect: (i === 0 ? "1:1" : "3:4") as "1:1" | "3:4",
  }));

  const train_lora = reference_count >= 15 && !product.loraUrl;

  const produce_video =
    include_video && has_amazon_seller_id && product.category !== "tech-acc";

  // P0 #1 fix: only generate variants when a real LoRA exists. train_lora
  // signals that *next* run should produce them (after async training
  // completes); skipping here prevents FLUX.2 Dev from running without a LoRA
  // and producing generic outputs that diverge from the SKU.
  const variants: PlannedWork["variants"] = [];
  if (product.loraUrl) {
    const colors = (product.colorsHex ?? []).slice(0, 5);
    for (const hex of colors) {
      variants.push({ product_id: product.id, scene_hint: `variant_${hex}` });
    }
  }

  const adapter_targets: PlannedWork["adapter_targets"] = [];
  for (const platform of platforms) {
    for (const slot of ADAPTER_SLOTS[platform]) {
      adapter_targets.push({ platform, slot });
    }
  }
  if (produce_video && platforms.includes("amazon")) {
    adapter_targets.push({ platform: "amazon", slot: "video" });
  }

  return {
    white_bg: { product_id: product.id, aspect: "1:1" },
    lifestyles,
    variants,
    train_lora,
    produce_video,
    platforms,
    adapter_targets,
  };
}

/**
 * Phase 4+ Sonnet 4.6 planner system prompt — wire when ready to upgrade
 * from heuristic to LLM-driven planning.
 *
 * NOTE: keep this string in source so prompt-cache hits work. Do NOT inline
 * dynamic seller/product names — those go in the user message, not the system.
 */
export const PLANNER_SYSTEM_PROMPT = `You are the planner for FF Brand Studio v2.
Given a product row, decide:
1. How many lifestyle scenes to generate (default 2 for apparel/hat, 3 for drinkware, 1 for tech-acc).
2. Whether to train a LoRA now (yes if product has ≥15 references and no existing lora_url).
3. Whether to commission a video (only if seller_profiles.amazon_seller_id is set AND category != 'tech-acc').
4. Per platform, which slots to fill.

Output a JSON plan matching the PlannedWork schema. Do not generate copy or images yourself; you only decide the work list.`;
