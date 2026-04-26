/**
 * v2 Phase 3 adapters — pure-function transforms that take a canonical asset
 * and produce a platform-specific platform_assets row.
 *
 * Phase 3 implementation: read the platform_specs row, derive output
 * dimensions/format/file size from there (not hardcoded), insert the
 * platform_assets row. Actual image transformation (sharp resize +
 * forceWhiteBackground) lands in Phase 2's image_post.ts; for now adapters
 * pass the canonical R2 URL through with the spec-derived metadata.
 *
 * Adapters must be:
 *  - idempotent: re-running yields the same row, not duplicates (DELETE+INSERT
 *    keyed on (variant_id, platform, slot)). Functionally equivalent to upsert.
 *  - cheap: image transforms are CPU-only, no API cost (cost_cents = 0).
 *  - spec-driven: read platform_specs at runtime, no hardcoded dimensions.
 */

import { eq, and } from "drizzle-orm";
import type { DbClient } from "../db/client.js";
import { platformSpecs, platformAssets } from "../db/schema.js";
import type { CanonicalAsset } from "../orchestrator/workers/index.js";

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
  _canonical: CanonicalAsset
): { width: number; height: number } {
  if (spec.minWidth && spec.maxWidth && spec.minWidth === spec.maxWidth) {
    return { width: spec.minWidth, height: spec.minHeight ?? spec.maxHeight ?? spec.minWidth };
  }
  const targetWidth = spec.maxWidth ?? Math.max(spec.minWidth ?? 1000, 2000);
  const targetHeight = spec.maxHeight ?? Math.max(spec.minHeight ?? 1000, 2000);
  return { width: targetWidth, height: targetHeight };
}

function approxFileSize(width: number, height: number, format: string): number {
  if (format === "MP4") return 25 * 1024 * 1024;
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

  // ── Spec validation ──────────────────────────────────────────────────────
  const violations: string[] = [];

  if (spec.fileSizeMaxBytes && fileSize > spec.fileSizeMaxBytes) {
    violations.push(`file size ${fileSize}B > max ${spec.fileSizeMaxBytes}B`);
  }
  if (spec.fileSizeMinBytes && fileSize < spec.fileSizeMinBytes) {
    violations.push(`file size ${fileSize}B < min ${spec.fileSizeMinBytes}B`);
  }
  if (
    spec.formatAllowlist &&
    spec.formatAllowlist.length > 0 &&
    !spec.formatAllowlist.includes(format)
  ) {
    violations.push(
      `format ${format} not in allowlist ${spec.formatAllowlist.join(",")}`
    );
  }

  // P1 #5: validate canonical source dimensions clear the spec floor.
  if (spec.minWidth && canonical.width < spec.minWidth) {
    violations.push(
      `canonical width ${canonical.width}px < spec minWidth ${spec.minWidth}px (would require upscale)`
    );
  }
  if (spec.minHeight && canonical.height < spec.minHeight) {
    violations.push(
      `canonical height ${canonical.height}px < spec minHeight ${spec.minHeight}px (would require upscale)`
    );
  }

  // P1 #6: aspect ratio validation with ±2% tolerance.
  if (spec.aspectRatio) {
    const m = spec.aspectRatio.match(/^([\d.]+):([\d.]+)$/);
    if (m) {
      const targetAspect = parseFloat(m[1]) / parseFloat(m[2]);
      const actualAspect = width / height;
      if (Math.abs(actualAspect - targetAspect) / targetAspect > 0.02) {
        violations.push(
          `aspect ${actualAspect.toFixed(3)} outside ${spec.aspectRatio} ±2%`
        );
      }
    }
  }

  const r2Url =
    canonical.kind === "video"
      ? canonical.r2_url
      : `${canonical.r2_url}#${platform}_${slot}`;

  // P0 #3: DELETE+INSERT keyed on (variant_id, platform, slot). Same effect
  // as upsert with simpler SQL — Drizzle's onConflictDoUpdate had a v0.38
  // wire-format issue with the multi-column unique index in our integration
  // test. DELETE+INSERT is unambiguous and idempotent.
  await db
    .delete(platformAssets)
    .where(
      and(
        eq(platformAssets.variantId, variant_id),
        eq(platformAssets.platform, platform),
        eq(platformAssets.slot, slot)
      )
    );

  // Phase 5: provenance metadata for EU AI Act Art. 50 (binding 2026-08).
  // Captured per-asset so a future audit can reconstruct generation chain.
  // SynthID/C2PA fields populate when upstream models provide them (Nano Banana
  // Pro images carry SynthID natively; Phase 2 wrapper will surface it).
  const provenance = {
    model: canonical.model_used,
    canonical_kind: canonical.kind,
    canonical_url: canonical.r2_url,
    canonical_dims: { width: canonical.width, height: canonical.height },
    adapter_version: "v2-phase3",
    generated_at: new Date().toISOString(),
    synthid_present: false, // Phase 2: set true when Nano Banana Pro returns it
    c2pa_manifest_url: null as string | null,
  };

  const inserted = await db
    .insert(platformAssets)
    .values({
      variantId: variant_id,
      platform,
      slot,
      r2Url,
      width,
      height,
      fileSizeBytes: fileSize,
      format,
      modelUsed: "adapter:phase3",
      costCents: 0,
      status: "draft",
      complianceIssues: violations.length > 0 ? { violations } : null,
      refinementHistory: [],
      generationParams: {
        canonical_kind: canonical.kind,
        canonical_url: canonical.r2_url,
        spec_source: { platform, slot },
        provenance,
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
 */
export function pickCanonicalForSlot(
  slot: string,
  pool: { white_bg?: CanonicalAsset; lifestyles: CanonicalAsset[]; video?: CanonicalAsset }
): CanonicalAsset | null {
  if (slot === "video") return pool.video ?? null;
  if (slot === "lifestyle" || slot === "banner" || slot === "detail") {
    return pool.lifestyles[0] ?? pool.white_bg ?? null;
  }
  return pool.white_bg ?? pool.lifestyles[0] ?? null;
}
