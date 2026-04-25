/**
 * v2 Phase 4 — Amazon US compliance scorer.
 *
 * Deterministic checks against `platform_specs` + the v2 Amazon main-image
 * rubric. Phase 4 follow-up will add an Opus 4.7 vision pass for text/logo/
 * watermark/category-rule detection (apparel-on-model, shoes-45deg-left etc).
 */
import { eq, and } from "drizzle-orm";
import type { DbClient } from "../db/client.js";
import { platformAssets, platformSpecs, productVariants, products } from "../db/schema.js";
import type {
  PlatformComplianceRatingType,
  PlatformComplianceResultType,
} from "@ff/types";
import { visionScoreAmazonMain } from "./vision_scorer.js";

export interface ScoreAmazonComplianceOptions {
  /**
   * Phase 4-follow: opt in to the Opus 4.7 vision second pass. Default false.
   * Adds ~$0.02 per call; catches text/logos/watermarks/props.
   */
  vision?: boolean;
  /** Anthropic API key (required if vision=true). */
  anthropic_api_key?: string;
}

const RATING_RANK: Record<PlatformComplianceRatingType, number> = {
  EXCELLENT: 4,
  GOOD: 3,
  FAIR: 2,
  POOR: 1,
};

export async function scoreAmazonCompliance(
  db: DbClient,
  asset_id: string,
  opts: ScoreAmazonComplianceOptions = {}
): Promise<PlatformComplianceResultType> {
  const issues: string[] = [];
  const suggestions: string[] = [];
  const metrics: Record<string, unknown> = {};

  const assetRow = await db
    .select()
    .from(platformAssets)
    .where(eq(platformAssets.id, asset_id))
    .limit(1);

  if (assetRow.length === 0) {
    return {
      rating: "POOR",
      issues: [`asset not found: ${asset_id}`],
      suggestions: [],
      metrics: {},
    };
  }
  const a = assetRow[0];
  metrics.platform = a.platform;
  metrics.slot = a.slot;

  if (a.platform !== "amazon") {
    return {
      rating: "POOR",
      issues: [`asset is on platform=${a.platform}, expected 'amazon'`],
      suggestions: ["use score_shopify_compliance for shopify assets"],
      metrics,
    };
  }

  const specRow = await db
    .select()
    .from(platformSpecs)
    .where(
      and(eq(platformSpecs.platform, "amazon"), eq(platformSpecs.slot, a.slot))
    )
    .limit(1);

  if (specRow.length === 0) {
    return {
      rating: "POOR",
      issues: [`platform_specs missing for (amazon, ${a.slot})`],
      suggestions: ["seed the spec via scripts/apply-v2-schema.mjs"],
      metrics,
    };
  }
  const spec = specRow[0];

  metrics.width = a.width;
  metrics.height = a.height;
  if (spec.minWidth && a.width !== null && a.width < spec.minWidth) {
    issues.push(`width ${a.width}px < ${spec.minWidth}px`);
  }
  if (spec.minHeight && a.height !== null && a.height < spec.minHeight) {
    issues.push(`height ${a.height}px < ${spec.minHeight}px`);
  }
  if (spec.maxWidth && a.width !== null && a.width > spec.maxWidth) {
    issues.push(`width ${a.width}px > ${spec.maxWidth}px`);
  }
  if (spec.maxHeight && a.height !== null && a.height > spec.maxHeight) {
    issues.push(`height ${a.height}px > ${spec.maxHeight}px`);
  }

  if (spec.aspectRatio && a.width && a.height) {
    const m = spec.aspectRatio.match(/^([\d.]+):([\d.]+)$/);
    if (m) {
      const target = parseFloat(m[1]) / parseFloat(m[2]);
      const actual = a.width / a.height;
      metrics.aspect_target = target;
      metrics.aspect_actual = actual;
      if (Math.abs(actual - target) / target > 0.02) {
        issues.push(
          `aspect ${actual.toFixed(3)} outside ${spec.aspectRatio} ±2%`
        );
      }
    }
  }

  metrics.file_size_bytes = a.fileSizeBytes;
  if (
    spec.fileSizeMaxBytes &&
    a.fileSizeBytes !== null &&
    a.fileSizeBytes > spec.fileSizeMaxBytes
  ) {
    issues.push(`file size ${a.fileSizeBytes}B > max ${spec.fileSizeMaxBytes}B`);
  }
  if (
    spec.fileSizeMinBytes &&
    a.fileSizeBytes !== null &&
    a.fileSizeBytes < spec.fileSizeMinBytes
  ) {
    issues.push(`file size ${a.fileSizeBytes}B < min ${spec.fileSizeMinBytes}B`);
  }

  metrics.format = a.format;
  if (
    spec.formatAllowlist &&
    spec.formatAllowlist.length > 0 &&
    a.format &&
    !spec.formatAllowlist.includes(a.format)
  ) {
    issues.push(
      `format ${a.format} not in allowlist ${spec.formatAllowlist.join(",")}`
    );
  }

  if (a.slot === "main") {
    suggestions.push(
      "Phase 4 vision pass will sample 20 corner pixels for RGB(255,255,255) and verify product fill >=85% via Opus 4.7."
    );
    if (spec.backgroundRule !== "rgb_255_255_255") {
      issues.push(
        `main image spec missing rgb_255_255_255 background_rule (got '${spec.backgroundRule}')`
      );
    }
  }
  if (a.slot.startsWith("a_plus_")) {
    suggestions.push(
      "Phase 4 OCR + ad-content flagger will check overlay copy for prohibited claims."
    );
  }

  if (a.complianceIssues && typeof a.complianceIssues === "object") {
    const existing = (a.complianceIssues as { violations?: string[] }).violations;
    if (existing && existing.length > 0) {
      for (const v of existing) issues.push(`adapter: ${v}`);
    }
  }

  let rating: PlatformComplianceRatingType =
    issues.length === 0 ? "EXCELLENT" : issues.length <= 2 ? "FAIR" : "POOR";

  // ── Optional Opus 4.7 vision pass ────────────────────────────────────────
  if (opts.vision) {
    if (!opts.anthropic_api_key) {
      issues.push("vision pass requested but anthropic_api_key not provided");
      return { rating: "POOR", issues, suggestions, metrics };
    }

    // Look up category for the rubric hint via the product table chain
    const productRow = await db
      .select({ category: products.category })
      .from(platformAssets)
      .innerJoin(productVariants, eq(productVariants.id, platformAssets.variantId))
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(eq(platformAssets.id, asset_id))
      .limit(1);
    const category = productRow[0]?.category;

    const visionResult = await visionScoreAmazonMain({
      asset_url: a.r2Url,
      category,
      api_key: opts.anthropic_api_key,
    });

    metrics.vision_rating = visionResult.rating;
    metrics.vision_cost_cents = visionResult.cost_cents;
    metrics.vision_issues = visionResult.issues;

    // Merge vision findings — vision can downgrade but not upgrade the rating
    for (const v of visionResult.issues) issues.push(`vision: ${v}`);
    for (const s of visionResult.suggestions) suggestions.push(`vision: ${s}`);
    if (RATING_RANK[visionResult.rating] < RATING_RANK[rating]) {
      rating = visionResult.rating;
    }
  }

  return { rating, issues, suggestions, metrics };
}
