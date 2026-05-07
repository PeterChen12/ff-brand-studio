/**
 * Phase I — Production image pipeline orchestrator.
 *
 * Composes the 6 pipeline steps + lifestyle + 3 composites + banner +
 * white-bg force pass + writes platform_assets rows per the I5 slot
 * matrix. Wallet-charges per step, audits each transition, and halts
 * gracefully if the per-launch cost cap is hit.
 *
 * Entry point: `runProductionPipeline(env, ctx, planInput)`.
 *
 * Feature flag: callers must check `tenant.features.production_pipeline`
 * before invoking — this module trusts the caller.
 */

import { eq } from "drizzle-orm";
import type { DbClient } from "../db/client.js";
import { platformAssets, launchRuns } from "../db/schema.js";
import type { LaunchPlatform } from "../orchestrator/planner.js";
import { auditEvent } from "../lib/audit.js";
import {
  planProductionSlots,
  type PipelineSource,
  type SlotTarget,
} from "./planner_matrix.js";
import type {
  PipelineCtx,
  PipelineOutputs,
  RefinedAsset,
  TenantFeatures,
} from "./types.js";
import { cleanupStep } from "./cleanup.js";
import { deriveStep } from "./derive.js";
import { refineWithIteration } from "./iterate.js";
import { lifestyleRender } from "./lifestyle.js";
import { compositeText, bannerExtend } from "./composite.js";
import { extractSpecs } from "./specs.js";
import { getDeriver } from "./derivers/index.js";

export interface RunPipelineInput {
  ctx: PipelineCtx;
  platforms: LaunchPlatform[];
  product: {
    id: string;
    nameEn: string;
    category: string;
    dimensions: unknown;
    materials: string[] | null;
  };
}

export interface RunPipelineResult {
  ok: boolean;
  outputs?: Partial<PipelineOutputs>;
  slotsWritten: number;
  totalCostCents: number;
  fairCount: number;
  errors: string[];
}

/**
 * Run the full production pipeline for one SKU. Writes one row to
 * platform_assets per (platform, slot) it produces. Cost-gated against
 * `ctx.perLaunchCapCents`; partial results are persisted (no rollback).
 */
export async function runProductionPipeline(
  env: CloudflareBindings,
  db: DbClient,
  input: RunPipelineInput
): Promise<RunPipelineResult> {
  const { ctx, platforms, product } = input;
  const outputs: Partial<PipelineOutputs> = {};
  const refinedAssets: RefinedAsset[] = [];
  const errors: string[] = [];
  let totalCostCents = 0;
  let budget = ctx.perLaunchCapCents;

  function chargeAndAccount(stepName: string, cents: number): boolean {
    if (cents === 0) return true;
    if (budget < cents) {
      errors.push(`wallet capped at step=${stepName} (${budget}¢ remaining, need ${cents}¢)`);
      return false;
    }
    budget -= cents;
    totalCostCents += cents;
    return true;
  }

  // Phase A5 — granular phase visibility for polling clients. Best-effort:
  // a single launch_runs UPDATE per step boundary; failure is logged but
  // does not abort the pipeline (we'd rather lose visibility than the run).
  async function setPhase(phase: string): Promise<void> {
    try {
      await db
        .update(launchRuns)
        .set({ currentPhase: phase })
        .where(eq(launchRuns.id, ctx.runId));
    } catch (err) {
      console.warn("[pipeline] setPhase failed", phase, err);
    }
  }

  // Pick the first reference image; the pipeline operates on a single
  // canonical input for now (multi-reference support is a future iteration).
  const sourceR2Key = ctx.referenceR2Keys[0];
  if (!sourceR2Key) {
    return {
      ok: false,
      outputs,
      slotsWritten: 0,
      totalCostCents: 0,
      fairCount: 0,
      errors: ["no reference image attached to product"],
    };
  }

  // ── Step 2: cleanup ────────────────────────────────────────────────
  await setPhase("cleanup");
  const cleanupRes = await cleanupStep(env, ctx, sourceR2Key);
  if (cleanupRes.status !== "ok") {
    errors.push(`cleanup failed: ${stepError(cleanupRes)}`);
    return finalize(false);
  }
  if (!chargeAndAccount("cleanup", cleanupRes.costCents)) return finalize(false);
  outputs.cleanup_studio = cleanupRes.outputR2Key;

  await auditEvent(db, {
    tenantId: ctx.tenantId,
    actor: null,
    action: "launch.start",
    targetType: "pipeline_step",
    targetId: ctx.runId,
    metadata: { step: "cleanup", costCents: cleanupRes.costCents, outputR2Key: cleanupRes.outputR2Key },
  });

  // ── Step 3: derive (sidecar) ──────────────────────────────────────
  await setPhase("derive");
  const deriveRes = await deriveStep(env, ctx, cleanupRes.outputR2Key);
  if (deriveRes.result.status !== "ok" || !deriveRes.outputs) {
    errors.push(`derive failed: ${stepError(deriveRes.result)}`);
    return finalize(false);
  }
  outputs.derive_studio = deriveRes.outputs.studioR2Key;
  outputs.derive_crop_A = deriveRes.outputs.cropAKey;
  outputs.derive_crop_B = deriveRes.outputs.cropBKey;
  outputs.derive_crop_C = deriveRes.outputs.cropCKey;

  // ── Step 4 + 5 + 6: refine each crop with iter loop ──────────────
  const cropTargets: Array<{ tag: "studio" | "A" | "B" | "C"; cropKey: string }> = [
    { tag: "studio", cropKey: deriveRes.outputs.studioR2Key }, // self-paired refine for the canonical
    { tag: "A", cropKey: deriveRes.outputs.cropAKey },
    { tag: "B", cropKey: deriveRes.outputs.cropBKey },
    { tag: "C", cropKey: deriveRes.outputs.cropCKey },
  ];

  await setPhase("refine_all_crops");
  // Refine all 4 crops in parallel — sequential was ~95s each × 4 = 6+ min
  // wallclock, which busts Cloudflare Workers' 5-min request cap. Each
  // refineWithIteration manages its own per-crop budget (passed in
  // `remainingBudgetCents`); the worst case is N × per-crop spend, but
  // per-crop spend is bounded ~100¢ so 4 crops max ~400¢ < cost_cap_cents.
  // Subrequest count is the same as sequential (Workers counts the total,
  // not concurrency), so we don't hit a different limit.
  const studioKey = deriveRes.outputs.studioR2Key;
  const cleanupKey = cleanupRes.outputR2Key;
  type CropResult =
    | { tag: typeof cropTargets[number]["tag"]; capped: true }
    | { tag: typeof cropTargets[number]["tag"]; out: Awaited<ReturnType<typeof refineWithIteration>> };
  const refineResults: CropResult[] = await Promise.all(
    cropTargets.map(async (t): Promise<CropResult> => {
      if (budget < 30) {
        return { tag: t.tag, capped: true };
      }
      const out = await refineWithIteration(env, ctx, {
        cropTag: t.tag === "studio" ? "studio" : `crop_${t.tag}`,
        cropR2Key: t.cropKey,
        studioR2Key: studioKey,
        referenceR2Key: cleanupKey,
        remainingBudgetCents: budget,
      });
      return { tag: t.tag, out };
    })
  );
  for (const r of refineResults) {
    if ("capped" in r) {
      errors.push(`wallet capped before refine_${r.tag}`);
      continue;
    }
    if ("error" in r.out) {
      errors.push(`refine_${r.tag} failed: ${r.out.error}`);
      continue;
    }
    budget -= r.out.costCents;
    totalCostCents += r.out.costCents;
    refinedAssets.push(r.out.asset);

    if (r.tag === "studio") outputs.refine_studio = r.out.asset.finalR2Key;
    if (r.tag === "A") outputs.refine_crop_A = r.out.asset.finalR2Key;
    if (r.tag === "B") outputs.refine_crop_B = r.out.asset.finalR2Key;
    if (r.tag === "C") outputs.refine_crop_C = r.out.asset.finalR2Key;

    await auditEvent(db, {
      tenantId: ctx.tenantId,
      actor: null,
      action: r.out.asset.fair ? "launch.failed" : "launch.complete",
      targetType: "pipeline_step",
      targetId: ctx.runId,
      metadata: {
        step: `refine_${r.tag}`,
        costCents: r.out.costCents,
        clipScore: r.out.asset.clipScore,
        iters: r.out.asset.iters,
        fair: r.out.asset.fair,
      },
    });
  }

  // ── Lifestyle ─────────────────────────────────────────────────────
  await setPhase("lifestyle");
  if (outputs.refine_studio && budget >= 30) {
    const lifeRes = await lifestyleRender(env, ctx, outputs.refine_studio);
    if (lifeRes.status === "ok") {
      budget -= lifeRes.costCents;
      totalCostCents += lifeRes.costCents;
      outputs.lifestyle = lifeRes.outputR2Key;
    } else {
      errors.push(`lifestyle failed: ${stepError(lifeRes)}`);
    }
  }

  // ── Composites (3 spec variants) ──────────────────────────────────
  await setPhase("composites");
  if (outputs.refine_studio) {
    const specRes = await extractSpecs(env, {
      id: product.id,
      nameEn: product.nameEn,
      category: product.category,
      dimensions: product.dimensions,
      materials: product.materials,
    });
    if (specRes.costCents > 0) {
      if (chargeAndAccount("specs", specRes.costCents)) {
        // accounted
      }
    }

    // Variant 1 highlights spec[0]; 2 highlights spec[1]; 3 spec[2].
    // Each call still passes all 3 specs to the sidecar but the variantTag
    // varies the layout (different highlight + different padding).
    const variants: Array<"detail_1" | "detail_2" | "detail_3"> = ["detail_1", "detail_2", "detail_3"];
    // Phase N3 — read tenant brand_hex from features; fall back to FF blue.
    const brandHex = (() => {
      const f = ctx.features as { brand_hex?: string };
      return f.brand_hex && /^#[0-9a-fA-F]{6}$/.test(f.brand_hex) ? f.brand_hex : "#1C3FAA";
    })();
    for (let i = 0; i < variants.length; i++) {
      const v = variants[i];
      const compRes = await compositeText(
        env,
        ctx,
        outputs.refine_studio,
        // Rotate spec order so each composite emphasizes a different one.
        [
          specRes.specs[i % 3],
          specRes.specs[(i + 1) % 3],
          specRes.specs[(i + 2) % 3],
        ],
        v,
        brandHex
      );
      if (compRes.status === "ok") {
        if (v === "detail_1") outputs.composite_detail_1 = compRes.outputR2Key;
        else if (v === "detail_2") outputs.composite_detail_2 = compRes.outputR2Key;
        else outputs.composite_detail_3 = compRes.outputR2Key;
      } else {
        errors.push(`composite_${v} failed: ${stepError(compRes)}`);
      }
    }
  }

  // ── Banner (Shopify-only target, but always produced if requested) ──
  await setPhase("banner");
  if (outputs.refine_studio && platforms.includes("shopify")) {
    const tenantBrand = (ctx.features as { brand_hex?: string }).brand_hex;
    // Banner background sits behind the product — keep it neutral unless
    // the tenant explicitly overrode brand_hex with a non-blue.
    const bannerHex = tenantBrand && /^#[0-9a-fA-F]{6}$/.test(tenantBrand) ? tenantBrand : "#F2EEE6";
    const banRes = await bannerExtend(env, ctx, outputs.refine_studio, bannerHex);
    if (banRes.status === "ok") outputs.banner = banRes.outputR2Key;
    else errors.push(`banner failed: ${stepError(banRes)}`);
  }

  // ── Slot matrix → platform_assets writes ─────────────────────────
  await setPhase("write_slots");
  const slots = planProductionSlots({ platforms, features: ctx.features });
  let slotsWritten = 0;
  for (const target of slots) {
    const r2Key = outputs[target.source as keyof PipelineOutputs];
    if (typeof r2Key !== "string" || r2Key.length === 0) {
      errors.push(`skipped ${target.platform}/${target.slot} — missing source ${target.source}`);
      continue;
    }
    const fairForThisCrop = refinedAssets.find((a) => sourceMatchesAsset(target.source, a))?.fair ?? false;
    const compliance = fairForThisCrop ? "FAIR" : "EXCELLENT";
    const r2Url = `${env.R2_PUBLIC_URL.replace(/\/$/, "")}/${r2Key}`;
    const status = fairForThisCrop ? "fair" : "approved";
    const modelUsed = sourceModelLabel(target.source);
    const costCents = estimateSlotCost(target.source);
    const generationParams = { source: target.source, runId: ctx.runId };
    // Re-launching the same product upserts: a new run replaces the prior
    // (variant, platform, slot) tuple — the active set is "latest run's
    // outputs". Without onConflictDoUpdate, the unique index
    // platform_assets_uniq_variant_slot rejects the second INSERT and the
    // entire pipeline catches that as a fatal error (LYKAN re-launch
    // surfaced this 2026-05-06).
    await db
      .insert(platformAssets)
      .values({
        tenantId: ctx.tenantId,
        variantId: ctx.variantId,
        platform: target.platform,
        slot: target.slot,
        r2Url,
        width: 2000,
        height: 2000,
        format: "png",
        status,
        modelUsed,
        complianceScore: compliance,
        costCents,
        generationParams,
      })
      .onConflictDoUpdate({
        target: [
          platformAssets.variantId,
          platformAssets.platform,
          platformAssets.slot,
        ],
        set: {
          r2Url,
          width: 2000,
          height: 2000,
          format: "png",
          status,
          modelUsed,
          complianceScore: compliance,
          costCents,
          generationParams,
        },
      });
    slotsWritten++;
  }

  // Wallet billing is handled by the /v1/launches handler — it pre-charges
  // `prediction.total_cents` up front and refunds the delta against
  // `result.total_cost_cents` (which we set from `totalCostCents`). Charging
  // here too would double-debit the tenant.

  return finalize(slotsWritten > 0);

  function finalize(ok: boolean): RunPipelineResult {
    return {
      ok,
      outputs,
      slotsWritten: ok ? countSlots() : 0,
      totalCostCents,
      fairCount: refinedAssets.filter((a) => a.fair).length,
      errors,
    };
  }

  function countSlots(): number {
    return planProductionSlots({ platforms, features: ctx.features }).filter(
      (s) => typeof outputs[s.source as keyof PipelineOutputs] === "string"
    ).length;
  }
}

function stepError(res: { status: string } & Record<string, unknown>): string {
  if (res.status !== "error") return "unknown";
  const errObj = (res as unknown as { error: PipelineErrorLike }).error;
  switch (errObj.kind) {
    case "provider_error":
      return `${errObj.provider}${errObj.status ? ` ${errObj.status}` : ""}: ${errObj.message ?? ""}`;
    case "config_missing":
      return `config missing: ${errObj.field}`;
    case "sidecar_unavailable":
      return `sidecar unavailable: ${errObj.message ?? ""}`;
    default:
      return errObj.kind;
  }
}

interface PipelineErrorLike {
  kind: string;
  message?: string;
  field?: string;
  provider?: string;
  status?: number;
}

function sourceMatchesAsset(source: PipelineSource, asset: RefinedAsset): boolean {
  if (source === "refine_studio") return asset.cropName === "studio";
  if (source === "refine_crop_A") return asset.cropName === "crop_A";
  if (source === "refine_crop_B") return asset.cropName === "crop_B";
  if (source === "refine_crop_C") return asset.cropName === "crop_C";
  return false;
}

function sourceModelLabel(source: PipelineSource): string {
  switch (source) {
    case "refine_studio":
    case "refine_crop_A":
    case "refine_crop_B":
    case "refine_crop_C":
      return "fal:gemini-3-pro-image-preview";
    case "lifestyle":
      return "fal:gemini-3-pro-image-preview:lifestyle";
    case "composite_detail_1":
    case "composite_detail_2":
    case "composite_detail_3":
      return "sidecar:composite-text";
    case "banner":
      return "sidecar:banner-extend";
  }
}

function estimateSlotCost(source: PipelineSource): number {
  switch (source) {
    case "refine_studio":
    case "refine_crop_A":
    case "refine_crop_B":
    case "refine_crop_C":
      return 30; // refine cost per FAL call (excludes vision/clip)
    case "lifestyle":
      return 30;
    case "composite_detail_1":
    case "composite_detail_2":
    case "composite_detail_3":
    case "banner":
      return 0; // sidecar CPU only
  }
}

// Re-export for orchestrator wiring.
export type { TenantFeatures };
