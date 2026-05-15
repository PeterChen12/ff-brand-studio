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
import { scoreReference } from "../lib/best-of-input.js";
import { dhash, hammingDistance, NEAR_DUPLICATE_HAMMING } from "../lib/dhash.js";

// Phase G · G04 — composite scoring for multi-reference best-of pick.
// Resolution dominates because everything downstream upscales from it;
// fill ratio in the passthrough sweet spot is rewarded; whiteness
// breaks ties. Weights tuned on the SAMPLE_TENANT corpus; if a tenant
// reliably picks the wrong reference, log the metrics + reorder weights.
function scoreReferenceComposite(m: { longestSide: number; fillRatio: number; whiteness: number }): number {
  // Cap longest side at 3000 — beyond that, more pixels don't help.
  const resolutionScore = Math.min(m.longestSide, 3000) / 3000;
  // Reward fills in [0.55, 0.85]; both too-small (low fill) and too-tight
  // (no whitespace for crop expansion) are penalized.
  const idealFill = 0.7;
  const fillScore = 1 - Math.min(Math.abs(m.fillRatio - idealFill) / idealFill, 1);
  // Whiteness is a 0-1 cleanliness signal already.
  return resolutionScore * 0.5 + fillScore * 0.3 + m.whiteness * 0.2;
}

async function pickBestReference(
  env: CloudflareBindings,
  keys: string[]
): Promise<string> {
  if (keys.length === 1) return keys[0];
  // Bound the scoring work — score up to 6 references so an operator
  // dumping 50 photos doesn't burn 15s scoring them all.
  const candidates = keys.slice(0, 6);
  const scored = await Promise.all(
    candidates.map(async (key) => {
      try {
        const obj = await env.R2.get(key);
        if (!obj) return { key, score: -1 };
        const buf = Buffer.from(await obj.arrayBuffer());
        const m = await scoreReference(buf);
        return { key, score: scoreReferenceComposite(m) };
      } catch {
        return { key, score: -1 };
      }
    })
  );
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.key ?? keys[0];
}

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

  // Phase G · G04/G05 — when a product has multiple reference images,
  // pick the one most likely to produce a clean studio shot (highest
  // composite score: longest side + fill in passthrough sweet spot +
  // whiteness). Then run a fail-fast quality gate: if even the BEST
  // reference is below abort thresholds, refuse the run so we don't
  // burn $0.30 of FAL spend producing garbage.
  if (ctx.referenceR2Keys.length === 0) {
    return {
      ok: false,
      outputs,
      slotsWritten: 0,
      totalCostCents: 0,
      fairCount: 0,
      errors: ["no reference image attached to product"],
    };
  }
  const sourceR2Key = await pickBestReference(env, ctx.referenceR2Keys).catch(
    (err) => {
      // If best-of scoring fails (R2 read error, decoder crash) we fall
      // back to the first reference rather than aborting — losing the
      // "best" optimization is better than refusing a launch on a bug
      // in our own scoring code.
      console.warn("[pipeline] best-of-reference scoring failed:", err);
      return ctx.referenceR2Keys[0];
    }
  );
  // Score the selected reference for the abort gate. We re-fetch the
  // buffer here because pickBestReference may have used a sampled subset.
  try {
    const { scoreReference, isAbortQuality } = await import(
      "../lib/best-of-input.js"
    );
    const refObj = await env.R2.get(sourceR2Key);
    if (refObj) {
      const refBuffer = Buffer.from(await refObj.arrayBuffer());
      const metrics = await scoreReference(refBuffer);
      const verdict = isAbortQuality(metrics);
      if (verdict.abort) {
        await auditEvent(db, {
          tenantId: ctx.tenantId,
          actor: null,
          action: "launch.start",
          targetType: "pipeline_step",
          targetId: ctx.runId,
          metadata: {
            step: "input_quality_abort",
            source_key: sourceR2Key,
            metrics,
            reasons: verdict.reasons,
          },
        });
        return {
          ok: false,
          outputs,
          slotsWritten: 0,
          totalCostCents: 0,
          fairCount: 0,
          errors: [
            `reference image quality too low to process: ${verdict.reasons.join("; ")}`,
          ],
        };
      }
    }
  } catch (qualityErr) {
    // Same fallback policy as pickBestReference — log + continue. A
    // scoring bug shouldn't refuse a launch.
    console.warn("[pipeline] input-quality check skipped:", qualityErr);
  }

  // ── Phase F · Iter 03 — Best-of-input passthrough gate ─────────────
  // First real consumer of runQualityGate (F1's abstraction). Pure
  // judge-only mode (no fix function) — if the reference scores
  // publish-ready, skip cleanup for the studio shot (and the downstream
  // refine flows from the same passthrough source). Saves ~$0.50 per
  // launch on clean inputs.
  //
  // Tenant-gated: tenant.features.passthrough_enabled (defaults true
  // unless explicitly false). Audit-logged so we can monitor rate over
  // time. Any failure falls through to the normal pipeline — never
  // poison the run on a passthrough check error.
  const passthroughEnabled =
    (ctx.features as { passthrough_enabled?: boolean }).passthrough_enabled !==
    false;
  let passthroughHit = false;
  if (passthroughEnabled) {
    try {
      const { runQualityGate } = await import("../lib/quality-gate.js");
      const { scoreReference, isPublishReadyReference, failureReasons } =
        await import("../lib/best-of-input.js");
      const refObj = await env.R2.get(sourceR2Key);
      if (refObj) {
        const refBuffer = Buffer.from(await refObj.arrayBuffer());
        const gateResult = await runQualityGate({
          initial: refBuffer,
          judge: async (buf) => {
            const metrics = await scoreReference(buf);
            return {
              pass: isPublishReadyReference(metrics),
              reasons: failureReasons(metrics),
              cost_cents: 0,
              metadata: { metrics },
            };
          },
          // Pure judge-only mode (no fix). Either passthrough or fall
          // through to the full pipeline.
        });
        if (gateResult.passed) {
          passthroughHit = true;
          outputs.refine_studio = sourceR2Key;
          outputs.cleanup_studio = sourceR2Key;
          await auditEvent(db, {
            tenantId: ctx.tenantId,
            actor: null,
            action: "launch.start",
            targetType: "pipeline_step",
            targetId: ctx.runId,
            metadata: {
              step: "passthrough_publish_ready",
              source_key: sourceR2Key,
              metrics: gateResult.history[0]?.judge.metadata?.metrics,
              saved_cents: 50,
            },
          });
        }
      }
    } catch (passthroughErr) {
      // Opportunistic — falls through to normal pipeline.
      console.warn("[pipeline] passthrough check skipped:", passthroughErr);
    }
  }

  // ── Step 2: cleanup ────────────────────────────────────────────────
  // Skipped entirely when passthrough hit — the reference IS the cleanup
  // output. Derive still runs because we need crop_A/B/C for the close-
  // up + detail slots regardless. After this block, outputs.cleanup_studio
  // is set in both paths.
  let cleanupCostCents = 0;
  if (!passthroughHit) {
    await setPhase("cleanup");
    const cleanupRes = await cleanupStep(env, ctx, sourceR2Key);
    if (cleanupRes.status !== "ok") {
      errors.push(`cleanup failed: ${stepError(cleanupRes)}`);
      return finalize(false);
    }
    if (!chargeAndAccount("cleanup", cleanupRes.costCents)) return finalize(false);
    outputs.cleanup_studio = cleanupRes.outputR2Key;
    cleanupCostCents = cleanupRes.costCents;

    await auditEvent(db, {
      tenantId: ctx.tenantId,
      actor: null,
      action: "launch.start",
      targetType: "pipeline_step",
      targetId: ctx.runId,
      metadata: {
        step: "cleanup",
        costCents: cleanupRes.costCents,
        outputR2Key: cleanupRes.outputR2Key,
      },
    });
  }
  // Invariant: outputs.cleanup_studio is now set (either by passthrough
  // earlier or by the cleanup step above). Used as the source for derive.
  const cleanupStudioKey = outputs.cleanup_studio;
  if (!cleanupStudioKey) {
    errors.push("internal: cleanup_studio not set after step 2");
    return finalize(false);
  }

  // ── Step 3: derive (sidecar) ──────────────────────────────────────
  await setPhase("derive");
  const deriveRes = await deriveStep(env, ctx, cleanupStudioKey);
  if (deriveRes.result.status !== "ok" || !deriveRes.outputs) {
    errors.push(`derive failed: ${stepError(deriveRes.result)}`);
    return finalize(false);
  }
  outputs.derive_studio = deriveRes.outputs.studioR2Key;
  outputs.derive_crop_A = deriveRes.outputs.cropAKey;
  outputs.derive_crop_B = deriveRes.outputs.cropBKey;
  outputs.derive_crop_C = deriveRes.outputs.cropCKey;

  // ── Step 4 + 5 + 6: refine each crop with iter loop ──────────────
  // Phase F · Iter 03 — skip the studio refine when passthrough hit;
  // outputs.refine_studio is already set to the reference and we'd
  // pay $0.30 to overwrite it with a near-duplicate.
  const allCropTargets: Array<{ tag: "studio" | "A" | "B" | "C"; cropKey: string }> = [
    { tag: "studio", cropKey: deriveRes.outputs.studioR2Key }, // self-paired refine for the canonical
    { tag: "A", cropKey: deriveRes.outputs.cropAKey },
    { tag: "B", cropKey: deriveRes.outputs.cropBKey },
    { tag: "C", cropKey: deriveRes.outputs.cropCKey },
  ];
  const cropTargets = passthroughHit
    ? allCropTargets.filter((t) => t.tag !== "studio")
    : allCropTargets;

  await setPhase("refine_all_crops");
  // Refine all 4 crops in parallel — sequential was ~95s each × 4 = 6+ min
  // wallclock, which busts Cloudflare Workers' 5-min request cap. Each
  // refineWithIteration manages its own per-crop budget (passed in
  // `remainingBudgetCents`); the worst case is N × per-crop spend, but
  // per-crop spend is bounded ~100¢ so 4 crops max ~400¢ < cost_cap_cents.
  // Subrequest count is the same as sequential (Workers counts the total,
  // not concurrency), so we don't hit a different limit.
  const studioKey = deriveRes.outputs.studioR2Key;
  const cleanupKey = cleanupStudioKey;
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

  // ── Phase G · G06 — Cross-slot dedup detection ────────────────────
  // After the refine fan-out, hash each output and look for near-duplicate
  // pairs. The 4 outputs (studio + A/B/C) should be visually distinct
  // because each came from a different crop + deriver prompt. Pairs with
  // Hamming distance ≤ NEAR_DUPLICATE_HAMMING usually mean the FAL model
  // produced a near-copy of the input rather than a per-crop refine.
  //
  // Detection-only for now — audit warning lands in the run's metadata so
  // ops can quantify how often this fires before we wire auto-regen.
  try {
    const refineOutputs: Array<{ slot: string; key: string }> = [];
    if (outputs.refine_studio) refineOutputs.push({ slot: "studio", key: outputs.refine_studio });
    if (outputs.refine_crop_A) refineOutputs.push({ slot: "crop_A", key: outputs.refine_crop_A });
    if (outputs.refine_crop_B) refineOutputs.push({ slot: "crop_B", key: outputs.refine_crop_B });
    if (outputs.refine_crop_C) refineOutputs.push({ slot: "crop_C", key: outputs.refine_crop_C });
    if (refineOutputs.length >= 2) {
      const hashed = await Promise.all(
        refineOutputs.map(async (r) => {
          const obj = await env.R2.get(r.key);
          if (!obj) return { slot: r.slot, hash: null as string | null };
          const buf = Buffer.from(await obj.arrayBuffer());
          try {
            return { slot: r.slot, hash: await dhash(buf) };
          } catch {
            return { slot: r.slot, hash: null };
          }
        })
      );
      const duplicates: Array<{ a: string; b: string; distance: number }> = [];
      for (let i = 0; i < hashed.length; i++) {
        for (let j = i + 1; j < hashed.length; j++) {
          const a = hashed[i];
          const b = hashed[j];
          if (!a.hash || !b.hash) continue;
          const d = hammingDistance(a.hash, b.hash);
          if (d <= NEAR_DUPLICATE_HAMMING) {
            duplicates.push({ a: a.slot, b: b.slot, distance: d });
          }
        }
      }
      if (duplicates.length > 0) {
        await auditEvent(db, {
          tenantId: ctx.tenantId,
          actor: null,
          action: "launch.start",
          targetType: "pipeline_step",
          targetId: ctx.runId,
          metadata: {
            step: "cross_slot_dedup_warning",
            duplicates,
            hashes: hashed.map((h) => ({ slot: h.slot, dhash: h.hash })),
          },
        });
        errors.push(
          `near-duplicate refine outputs detected: ${duplicates
            .map((d) => `${d.a}≈${d.b} (d=${d.distance})`)
            .join(", ")}`
        );
      }
    }
  } catch (dedupErr) {
    // Best-effort: dedup detection failures never block the pipeline.
    console.warn("[pipeline] cross-slot dedup check skipped:", dedupErr);
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
