/**
 * v2 Phase 4 — Shopify DTC compliance scorer.
 *
 * Lighter rubric than Amazon. Checks dimensions/format/file-size against
 * platform_specs; defers alt-text and accessibility checks to a Phase 4
 * vision pass.
 */
import { eq, and } from "drizzle-orm";
import type { DbClient } from "../db/client.js";
import { platformAssets, platformSpecs } from "../db/schema.js";
import type {
  PlatformComplianceRatingType,
  PlatformComplianceResultType,
} from "@ff/types";

export async function scoreShopifyCompliance(
  db: DbClient,
  asset_id: string
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

  if (a.platform !== "shopify") {
    return {
      rating: "POOR",
      issues: [`asset is on platform=${a.platform}, expected 'shopify'`],
      suggestions: ["use score_amazon_compliance for amazon assets"],
      metrics,
    };
  }

  const specRow = await db
    .select()
    .from(platformSpecs)
    .where(
      and(eq(platformSpecs.platform, "shopify"), eq(platformSpecs.slot, a.slot))
    )
    .limit(1);
  if (specRow.length === 0) {
    return {
      rating: "POOR",
      issues: [`platform_specs missing for (shopify, ${a.slot})`],
      suggestions: [],
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

  // Shopify CDN auto-converts to WebP — file size <300KB target for mobile speed
  if (a.fileSizeBytes !== null && a.fileSizeBytes > 300 * 1024) {
    suggestions.push(
      `file size ${(a.fileSizeBytes / 1024).toFixed(0)}KB > 300KB mobile-speed target ` +
        `(non-blocking; Shopify CDN will auto-WebP and re-compress)`
    );
  }

  if (a.slot === "main" || a.slot === "lifestyle") {
    suggestions.push(
      "Phase 4 will generate alt text via Sonnet 4.6 (≤100 chars, descriptive)."
    );
  }

  const rating: PlatformComplianceRatingType =
    issues.length === 0 ? "EXCELLENT" : issues.length <= 2 ? "FAIR" : "POOR";

  return { rating, issues, suggestions, metrics };
}
