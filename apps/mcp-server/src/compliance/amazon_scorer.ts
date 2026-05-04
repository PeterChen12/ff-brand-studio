/**
 * v2 Phase 4 — Amazon US compliance scorer.
 *
 * Deterministic checks against `platform_specs` + the v2 Amazon main-image
 * rubric. Phase 4 follow-up will add an Opus 4.7 vision pass for text/logo/
 * watermark/category-rule detection (apparel-on-model, shoes-45deg-left etc).
 */
import { eq, and } from "drizzle-orm";
import type { DbClient } from "../db/client.js";
import {
  platformAssets,
  platformSpecs,
  productVariants,
  products,
  productReferences,
} from "../db/schema.js";
import type {
  PlatformComplianceRatingType,
  PlatformComplianceResultType,
} from "@ff/types";
import { judgeImage, dualJudgeToComplianceResult } from "./dual_judge.js";

export interface ScoreAmazonComplianceOptions {
  /**
   * Phase 4-follow: opt in to the Image-QA Layer 1 dual-judge pass.
   * Default false. Adds ~$0.012 per call (two parallel Haiku 4.5
   * calls); catches similarity-to-source mismatches + framing /
   * background-integrity failures the deterministic scorer can't see.
   */
  vision?: boolean;
  /** Anthropic API key (required if vision=true). */
  anthropic_api_key?: string;
  /**
   * When set, dual_judge persists each per-judge verdict row to
   * image_qa_judgments. Pass the current evaluator-optimizer iteration
   * number so retries are correlatable.
   */
  persist_iteration?: number;
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

    // Look up category + tenant + reference URLs in one chained query.
    const productRow = await db
      .select({
        category: products.category,
        tenantId: products.tenantId,
        productId: products.id,
      })
      .from(platformAssets)
      .innerJoin(productVariants, eq(productVariants.id, platformAssets.variantId))
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(eq(platformAssets.id, asset_id))
      .limit(1);
    const category = productRow[0]?.category;
    const tenantId = productRow[0]?.tenantId;
    const productId = productRow[0]?.productId;

    // Pull up to 4 reference photos for the similarity judge — the
    // operator's onboarding photos are the canonical source-of-truth.
    const refs = productId
      ? await db
          .select({ r2Url: productReferences.r2Url })
          .from(productReferences)
          .where(eq(productReferences.productId, productId))
          .limit(4)
      : [];

    const visionResult = await judgeImage({
      generated_image_url: a.r2Url,
      reference_image_urls: refs.map((r) => r.r2Url).filter(Boolean) as string[],
      slot_label: `amazon-us · ${a.slot}`,
      category,
      api_key: opts.anthropic_api_key,
      persist:
        tenantId && opts.persist_iteration !== undefined
          ? {
              db,
              tenantId,
              assetId: asset_id,
              iteration: opts.persist_iteration,
            }
          : undefined,
    });
    const compat = dualJudgeToComplianceResult(visionResult);

    metrics.vision_rating = compat.rating;
    metrics.vision_cost_cents = compat.cost_cents;
    metrics.vision_issues = compat.issues;
    metrics.vision_judgments = visionResult.judgments;

    // Merge dual-judge findings — judges can downgrade but not upgrade.
    for (const v of compat.issues) issues.push(`vision: ${v}`);
    for (const s of compat.suggestions) suggestions.push(`vision: ${s}`);
    if (RATING_RANK[compat.rating] < RATING_RANK[rating]) {
      rating = compat.rating;
    }
  }

  return { rating, issues, suggestions, metrics };
}
