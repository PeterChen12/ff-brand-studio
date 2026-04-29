/**
 * Phase H4 — launch cost prediction.
 *
 * Mirrors ADR-0005 pricing: $0.50/image, $0.10/listing, $1.00/video.
 * Returns predicted cents so the pre-flight modal can show the
 * operator before they fire the launch.
 *
 * Uses the same shape as planner.PlannedWork so the wizard can call
 * /v1/launches/preview with the same body it'll later POST to
 * /v1/launches.
 */

import type { LaunchPlatform } from "./planner.js";

const LISTING_PRICE_CENTS = 10;
const VIDEO_PRICE_CENTS = 100;

// Issue 8 — image price varies by quality preset. The preset gates
// which underlying model gets called per slot (per ADR-0002):
//   budget   = Nano Banana Pro Batch (-50%) + GPT Image 2 medium
//   balanced = Nano Banana Pro standard + GPT Image 2 high (current default)
//   premium  = Nano Banana Pro 4K + GPT Image 2 high
// Markup over wholesale cost stays consistent — operator-facing prices
// chosen so the cost prediction reads honestly against the dispatcher's
// future routing.
//
// TODO(issue-8-dispatcher): Image workers (lifestyle.ts, refine.ts,
// cleanup.ts) don't yet branch on quality_preset. Until they do, the
// refund path in /v1/launches handles the Premium overcharge case
// (refunds the difference if actual < prediction); the Budget undercharge
// case is an absorbed cost while routing rolls out.
export type QualityPreset = "budget" | "balanced" | "premium";
const IMAGE_PRICE_CENTS_BY_PRESET: Record<QualityPreset, number> = {
  budget: 35,
  balanced: 50,
  premium: 70,
};

// Per-platform slot counts — locked decision per Phase I plan.
// Phase I lifts these to the full kind-aware matrix; until then the
// default is 7 Amazon + 5 Shopify (drops packaging + scale).
const SLOTS_PER_PLATFORM: Record<string, number> = {
  amazon: 7,
  shopify: 5,
};

export interface PredictionInput {
  platforms: LaunchPlatform[];
  include_seo: boolean;
  include_video?: boolean;
  // Surfaces × language pairs requested. Default: one per platform in EN.
  surface_count?: number;
  // Issue 8 — model-routing preset. Defaults to "balanced" (current
  // pricing). Affects image per-unit cost; listings + video unchanged.
  quality_preset?: QualityPreset;
}

export interface Prediction {
  total_cents: number;
  breakdown: {
    images: { count: number; per_unit_cents: number; subtotal: number };
    listings: { count: number; per_unit_cents: number; subtotal: number };
    video: { count: number; per_unit_cents: number; subtotal: number };
  };
}

export function predictLaunchCost(input: PredictionInput): Prediction {
  const imageCount = input.platforms.reduce(
    (sum, p) => sum + (SLOTS_PER_PLATFORM[p] ?? 0),
    0
  );
  const listingCount = input.include_seo
    ? input.surface_count ?? input.platforms.length
    : 0;
  const videoCount = input.include_video ? 1 : 0;

  const imagePriceCents =
    IMAGE_PRICE_CENTS_BY_PRESET[input.quality_preset ?? "balanced"];

  const images = {
    count: imageCount,
    per_unit_cents: imagePriceCents,
    subtotal: imageCount * imagePriceCents,
  };
  const listings = {
    count: listingCount,
    per_unit_cents: LISTING_PRICE_CENTS,
    subtotal: listingCount * LISTING_PRICE_CENTS,
  };
  const video = {
    count: videoCount,
    per_unit_cents: VIDEO_PRICE_CENTS,
    subtotal: videoCount * VIDEO_PRICE_CENTS,
  };

  return {
    total_cents: images.subtotal + listings.subtotal + video.subtotal,
    breakdown: { images, listings, video },
  };
}

export const PRODUCT_ONBOARD_CENTS = 50;
