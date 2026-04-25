/**
 * v2 Phase 3 adapters — pure-function transforms that take a canonical asset
 * and produce a platform-specific platform_assets row.
 *
 * Phase 3 implementation: read the platform_specs row, derive output
 * dimensions/format/file size from there (not hardcoded), insert the
 * platform_assets row. Actual image transformation (sharp/jimp resize +
 * forceWhiteBackground) lands in Phase 2's image_post.ts; for now adapters
 * pass the canonical R2 URL through with the spec-derived metadata.
 *
 * Adapters must be:
 *  - idempotent: same canonical + slot → same output (use seeded transforms in Phase 2).
 *  - cheap: image transforms are CPU-only, no API cost (cost_cents = 0).
 *  - spec-driven: read platform_specs at runtime, no hardcoded dimensions.
 */

import { eq, and } from "drizzle-orm";
import type { DbClient } from "../db/client.js";
import { platformSpecs, platformAssets } from "../db/schema.js";
import type { CanonicalAsset } from "../orchestrator/workers.js";

export interface AdapterContext {
  db: DbClient;
  variant_id: string;
  canonical: CanonicalAsset;
  platform: "amazon" | "shopify";
  slot: string;
}

export interface AdapterResult {
  asset_id: string;
  platform: string;
  slot: string;
  r2_url: string;
  width: number;
  height: number;
  format: string;
  file_size_bytes: number;
  spec_compliant: boolean;
  spec_violations: string[];
}

function pickFormat(spec: { formatAllowlist: string[] | null }, kind: string): string {
  if (kind === "video") return "MP4";
  const allow = spec.formatAllowlist ?? ["JPEG"];
  return allow.includes("JPEG") ? "JPEG" : allow[0];
}

function deriveDimensions(
  spec: {
    minWidth: number | null;
    maxWidth: number | null;
    minHeight: number | null;
    maxHeight: number | null;
  },
  canonical: CanonicalAsset
): { width: number; height: number } {
  // If the spec pins both min and max equal, that IS the dimension.
  if (spec.minWidth && spec.maxWidth && spec.minWidth === spec.maxWidth) {
    return { width: spec.minWidth, height: spec.minHeight ?? spec.maxHeight ?? spec.minWidth };
  }
  // Otherwise, scale the canonical down to the spec's recommended size.
  // For Amazon main: minWidth=1000 with no max → use 2000 (the recommended value
  // baked into the seed notes). We pick max(spec.minWidth, 2000) as a heuristic.
  const targetWidth = spec.maxWidth ?? Math.max(spec.minWidth ?? 1000, 2000);
  const targetHeight = spec.maxHeight ?? Math.max(spec.minHeight ?? 1000, 2000);
  return { width: targetWidth, height: targetHeight };
}

function approxFileSize(width: number, height: number, format: string): number {
  if (format === "MP4") return 25 * 1024 * 1024; // 25MB ballpark for 15-30s 1080p
  // ~0.15 bytes per pixel for JPEG q=85 — close enough for capacity validation
  return Math.round(width * height * 0.15);
}

export async function runAdapter(ctx: AdapterContext): Promise<AdapterResult> {
  const { db, variant_id, canonical, platform, slot } = ctx;

  const specRow = await db
    .select()
    .from(platformSpecs)
    .where(and(eq(platformSpecs.platform, platform), eq(platformSpecs.slot, slot)))
    .limit(1);

  if (specRow.length === 0) {
    throw new Error(
      `platform_specs row missing for (${platform}, ${slot}). ` +
        `Phase 1 seed must include this slot before adapting.`
    );
  }
  const spec = specRow[0];

  const format = pickFormat(spec, canonical.kind);
  const { width, height } = deriveDimensions(spec, canonical);
  const fileSize = approxFileSize(width, height, format);

  // Spec validation — would be a hard fail in Phase 4's evaluator-optimizer loop.
  const violations: string[] = [];
  if (spec.fileSizeMaxBytes && fileSize > spec.fileSizeMaxBytes) {
    violations.push(
      `file size ${fileSize}B > max ${spec.fileSizeMaxBytes}B`
    );
  }
  if (spec.fileSizeMinBytes && fileSize < spec.fileSizeMinBytes) {
    violations.push(
      `file size ${fileSize}B < min ${spec.fileSizeMinBytes}B`
    );
  }
  if (
    spec.formatAllowlist &&
    spec.formatAllowlist.length > 0 &&
    !spec.formatAllowlist.includes(format)
  ) {
    violations.push(`format ${format} not in allowlist ${spec.formatAllowlist.join(",")}`);
  }

  const r2Url =
    canonical.kind === "video"
      ? canonical.r2_url
      : `${canonical.r2_url}#${platform}_${slot}`; // Phase 2 will produce a real per-slot URL.

  const inserted = await db
    .insert(platformAssets)
    .values({
      variantId: variant_id,
      platform,
      slot,
      r2Url: r2Url,
      width,
      height,
      fileSizeBytes: fileSize,
      format,
      modelUsed: "adapter:phase3",
      costCents: 0,
      status: violations.length === 0 ? "draft" : "draft",
      complianceIssues: violations.length > 0 ? { violations } : null,
      generationParams: {
        canonical_kind: canonical.kind,
        canonical_url: canonical.r2_url,
        spec_source: { platform, slot },
      },
    })
    .returning();

  return {
    asset_id: inserted[0].id,
    platform,
    slot,
    r2_url: r2Url,
    width,
    height,
    format,
    file_size_bytes: fileSize,
    spec_compliant: violations.length === 0,
    spec_violations: violations,
  };
}

/**
 * Pick the best-fit canonical asset for a given (platform, slot) pair.
 * Slot semantics:
 *  - main:                use white_bg
 *  - a_plus_*:            use white_bg (Phase 4 will overlay text via GPT Image 2)
 *  - lifestyle:           use first lifestyle (or fall back to white_bg)
 *  - banner (shopify):    use first lifestyle
 *  - video (amazon):      use video canonical (skip if not produced)
 */
export function pickCanonicalForSlot(
  slot: string,
  pool: { white_bg?: CanonicalAsset; lifestyles: CanonicalAsset[]; video?: CanonicalAsset }
): CanonicalAsset | null {
  if (slot === "video") return pool.video ?? null;
  if (slot === "lifestyle" || slot === "banner" || slot === "detail") {
    return pool.lifestyles[0] ?? pool.white_bg ?? null;
  }
  // main + a_plus_* default to white_bg
  return pool.white_bg ?? pool.lifestyles[0] ?? null;
}
