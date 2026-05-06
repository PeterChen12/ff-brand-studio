/**
 * v2 Phase 3 orchestrator — hand-rolled fan-out for one SKU launch.
 *
 * NOT LangGraph. The plan §3.1 calls for LangGraph + Durable Objects but
 * V2_INVENTORY explicitly defers that adoption pending human approval (v1
 * uses plain async chains in workflows/campaign.workflow.ts). This file
 * follows the same plain-async pattern. If/when LangGraph is approved,
 * the planner→workers→adapters→evaluator shape here ports cleanly to
 * Send()-based fan-out without changing tool signatures.
 *
 * Pipeline (Phase 3 with stubbed Phase 2 generators):
 *
 *   load product
 *     → planner.planSkuLaunch (heuristic; Phase 4 swaps in Sonnet)
 *     → parallel workers: white_bg, lifestyles[], variants[], video?
 *     → ensure default product_variant exists (one per launch for now)
 *     → for each adapter_target (platform, slot): adapter inserts platform_assets row
 *     → mark launch_runs row as succeeded with totals
 *
 * Phase 4 will inject evaluator-optimizer between workers and adapters.
 */

import { eq, and, inArray, sql as drizzleSql } from "drizzle-orm";
import type { DbClient } from "../db/client.js";
import {
  products,
  productReferences,
  productVariants,
  sellerProfiles,
  launchRuns,
  platformAssets,
  platformListings,
  tenants,
  type Product,
} from "../db/schema.js";
import { checkBatchConsistency } from "../compliance/batch_consistency.js";
import { getLangfuse } from "../lib/langfuse.js";
import type Langfuse from "langfuse";
import { planSkuLaunch, type LaunchPlatform, type PlannedWork } from "./planner.js";
import { runProductionPipeline } from "../pipeline/index.js";
import type { TenantFeatures, PipelineCtx } from "../pipeline/types.js";
import type { KindType } from "@ff/types";
import {
  generateWhiteBgWorker,
  generateLifestyleWorker,
  generateVariantWorker,
  generateVideoWorker,
  type CanonicalAsset,
} from "./workers/index.js";
import { pickCanonicalForSlot } from "../adapters/index.js";
import { runEvaluatorOptimizer } from "./evaluator_optimizer.js";
import {
  runSeoPipeline,
  type SeoPipelineResult,
  type SeoSurfaceSpec,
} from "./seo_pipeline.js";

export interface LaunchPipelineInput {
  product_id: string;
  platforms: LaunchPlatform[];
  include_video: boolean;
  dry_run: boolean;
  /** Phase 4-follow: enable Opus 4.7 vision pass per asset (~$0.02/each).
   *  Default false to keep test cost zero. */
  vision_pass?: boolean;
  /** Phase 5: hard cap per launch (cents). Halt + flag if exceeded. */
  cost_cap_cents?: number;
  /** Anthropic key — required for vision_pass and SEO description generation. */
  anthropic_api_key?: string;
  /** SEO Layer · D6: run bilingual SEO description pipeline after image gen.
   *  Default true. Halts gracefully on missing OPENAI_API_KEY/DataForSEO. */
  include_seo?: boolean;
  /** SEO sub-pipeline cost cap in cents. Default 50¢. */
  seo_cost_cap_cents?: number;
  /** Override surfaces — defaults to platforms→en mapping. */
  seo_surfaces?: SeoSurfaceSpec[];
  /** SEO secrets — passed through from env. */
  openai_api_key?: string;
  dataforseo_login?: string;
  dataforseo_password?: string;
  /** Phase I — pass the Worker env so the production pipeline (when
   *  flag is on) can reach R2, AI binding, FAL, OpenAI, Anthropic, sidecar.
   *  When undefined, the legacy stub pipeline runs regardless of flag. */
  env?: CloudflareBindings;
  /**
   * P0-4 — when set, the pipeline UPDATES this existing launch_runs row
   * instead of inserting a new one. The handler creates the row up
   * front so the wallet charge always references a real run, and a
   * crash before the orchestrator's first update leaves the row in
   * 'pending' rather than missing entirely.
   */
  existing_run_id?: string;
}

export interface LaunchPipelineResult {
  run_id: string;
  product_id: string;
  product_sku: string;
  status: "succeeded" | "failed" | "hitl_blocked" | "cost_capped";
  duration_ms: number;
  total_cost_cents: number;
  plan: PlannedWork;
  canonicals: CanonicalAsset[];
  adapter_results: Array<{
    platform: string;
    slot: string;
    asset_id: string;
    spec_compliant: boolean;
    spec_violations: string[];
    final_rating?: string;
    iterations?: number;
    hitl_required?: boolean;
  }>;
  hitl_count: number;
  notes: string[];
  /** SEO Layer · D6 — present when include_seo=true. */
  seo?: SeoPipelineResult;
  /**
   * P1-5 — surfaces of (`amazon-us:en`, `shopify:zh`, …) whose
   * platform_listings persist failed. Empty array on a clean run.
   * The dashboard's Listings tab uses this to show a "2 of 4 listings
   * saved" warning instead of silently rendering only the survivors.
   */
  partial_listings?: string[];
}

export async function runLaunchPipeline(
  db: DbClient,
  input: LaunchPipelineInput
): Promise<LaunchPipelineResult> {
  const startedAt = Date.now();
  const notes: string[] = [];
  // P1-5 — surfaces whose platform_listings INSERT failed; non-empty
  // means the run gets demoted to hitl_blocked so the operator sees
  // partial state.
  const partialListings: string[] = [];

  // ── 1. Load product + references + seller flag ─────────────────────────
  const productRow = await db
    .select()
    .from(products)
    .where(eq(products.id, input.product_id))
    .limit(1);

  if (productRow.length === 0) {
    throw new Error(`product not found: ${input.product_id}`);
  }
  const product: Product = productRow[0];
  const tenantId = product.tenantId; // Phase G — every row stamped with this

  const refsCount = await db
    .select({ id: productReferences.id })
    .from(productReferences)
    .where(eq(productReferences.productId, input.product_id));

  const seller = await db
    .select()
    .from(sellerProfiles)
    .where(eq(sellerProfiles.id, product.sellerId))
    .limit(1);
  const hasAmazonSellerId = !!seller[0]?.amazonSellerId;

  // ── 2. Insert (or reuse) launch_runs row ────────────────────────────────
  // P0-4 — when the handler created the row up front (so the wallet
  // charge could reference it atomically), reuse that runId and flip
  // status from 'pending' to 'running'. Otherwise insert a new row
  // with status='pending'.
  let runId: string;
  if (input.existing_run_id) {
    runId = input.existing_run_id;
    await db
      .update(launchRuns)
      .set({ status: "running" })
      .where(eq(launchRuns.id, runId));
  } else {
    const inserted = await db
      .insert(launchRuns)
      .values({
        tenantId,
        productId: product.id,
        orchestratorModel: "claude-sonnet-4-6",
        status: "pending",
        totalCostCents: 0,
        hitlInterventions: 0,
      })
      .returning();
    runId = inserted[0].id;
  }

  // P1-9 — Langfuse trace wires the whole orchestrator into the
  // observability dashboard. The trace id is the runId so any future
  // /v1/launches/:id lookup can deep-link to the trace. Sub-steps emit
  // spans below. All Langfuse calls are best-effort: the SDK's network
  // I/O is buffered and flushed at the end, so a misconfigured Langfuse
  // never blocks the launch.
  let langfuse: Langfuse | null = null;
  let trace: ReturnType<Langfuse["trace"]> | null = null;
  if (input.env) {
    try {
      langfuse = getLangfuse(input.env);
      trace = langfuse.trace({
        id: runId,
        name: "launch",
        userId: tenantId,
        metadata: {
          product_id: product.id,
          product_sku: product.sku,
          platforms: input.platforms,
          dry_run: input.dry_run,
          include_seo: input.include_seo !== false,
          existing_run_id: input.existing_run_id ?? null,
        },
      });
      // Persist the trace id so support can grep `langfuse_trace_id =
      // <run_id>` and find the same row from either side.
      await db
        .update(launchRuns)
        .set({ langfuseTraceId: runId })
        .where(eq(launchRuns.id, runId))
        .catch(() => {});
    } catch (err) {
      // Langfuse misconfigured — proceed without tracing. The
      // production env-check in lib/langfuse.ts only throws on missing
      // baseUrl in production, which is intentional.
      console.warn(
        "[launch_pipeline] langfuse init failed",
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  // ── 3. Plan ────────────────────────────────────────────────────────────
  const plan = planSkuLaunch({
    product,
    reference_count: refsCount.length,
    has_amazon_seller_id: hasAmazonSellerId,
    platforms: input.platforms,
    include_video: input.include_video,
  });
  notes.push(
    `plan: 1 white_bg + ${plan.lifestyles.length} lifestyles + ${plan.variants.length} variants` +
      (plan.produce_video ? " + 1 video" : "") +
      (plan.train_lora ? " (LoRA training queued)" : "")
  );

  if (input.dry_run) {
    // F2: dry-run skips paid image generation but STILL runs the SEO
    // pipeline — agencies want bilingual listings even when they're
    // bringing their own product photos.
    let seoResult: SeoPipelineResult | undefined;
    if (input.include_seo !== false && input.anthropic_api_key) {
      try {
        seoResult = await runSeoPipeline({
          product,
          platforms: input.platforms,
          surfaces: input.seo_surfaces,
          cost_cap_cents: input.seo_cost_cap_cents,
          anthropic_api_key: input.anthropic_api_key,
          openai_api_key: input.openai_api_key,
          dataforseo_login: input.dataforseo_login,
          dataforseo_password: input.dataforseo_password,
        });
        notes.push(
          `seo_pipeline (dry-run) → ${seoResult.surfaces.length} surfaces, ${seoResult.total_cost_cents}¢ (${seoResult.status})`
        );
      } catch (e) {
        notes.push(`seo_pipeline failed: ${String(e).slice(0, 200)}`);
      }
    }
    const seoCostCents = seoResult?.total_cost_cents ?? 0;
    await db
      .update(launchRuns)
      .set({
        status: "succeeded",
        durationMs: Date.now() - startedAt,
        totalCostCents: Math.round(seoCostCents),
      })
      .where(eq(launchRuns.id, runId));
    return {
      run_id: runId,
      product_id: product.id,
      product_sku: product.sku,
      status: "succeeded",
      duration_ms: Date.now() - startedAt,
      total_cost_cents: seoCostCents,
      plan,
      canonicals: [],
      adapter_results: [],
      hitl_count: 0,
      notes: [...notes, "dry_run=true — skipped image workers and adapters"],
      seo: seoResult,
    };
  }

  // ── 4. Workers (parallel, allSettled — partial failure tolerated) ──────
  // P0 #2 fix: a single worker error must not abort the whole launch.
  // Phase 4's evaluator-optimizer wraps regeneration; Phase 3 just records
  // which canonicals succeeded and continues with what we have.
  // P1-9 — single span across the fan-out so latency p95 is queryable.
  const workersSpan = trace?.span({
    name: "workers",
    metadata: {
      lifestyles: plan.lifestyles.length,
      variants: plan.variants.length,
      produce_video: plan.produce_video,
    },
  });
  const workerSettled = await Promise.allSettled([
    generateWhiteBgWorker({ product_id: product.id, product_sku: product.sku }),
    ...plan.lifestyles.map((l) =>
      generateLifestyleWorker({
        product_id: product.id,
        product_sku: product.sku,
        scene_hint: l.scene_hint,
        aspect: l.aspect,
      })
    ),
    ...plan.variants.map((v) =>
      generateVariantWorker({
        product_id: product.id,
        product_sku: product.sku,
        scene_hint: v.scene_hint,
        lora_url: product.loraUrl,
      })
    ),
    plan.produce_video
      ? generateVideoWorker({ product_id: product.id, product_sku: product.sku })
      : Promise.resolve(null as CanonicalAsset | null),
  ]);

  const canonicals: CanonicalAsset[] = [];
  let workerFailures = 0;
  let whiteBg: CanonicalAsset | null = null;
  const lifestyles: CanonicalAsset[] = [];
  let video: CanonicalAsset | null = null;

  // Reconstruct typed slots from the flattened settled list. Order matches
  // the array we passed in: [whiteBg, ...lifestyles, ...variants, video?]
  const lifestyleEnd = 1 + plan.lifestyles.length;
  const variantEnd = lifestyleEnd + plan.variants.length;
  for (let i = 0; i < workerSettled.length; i++) {
    const settled = workerSettled[i];
    if (settled.status === "rejected") {
      workerFailures++;
      notes.push(`worker[${i}] failed: ${String(settled.reason).slice(0, 200)}`);
      continue;
    }
    const value = settled.value;
    if (!value) continue;
    canonicals.push(value);
    if (i === 0) whiteBg = value;
    else if (i < lifestyleEnd) lifestyles.push(value);
    else if (i < variantEnd) {
      // variants — currently no slot uses them in the adapter pool
    } else video = value;
  }

  // P1-8 — low-confidence demotion. If more than half the workers
  // failed, even if at least one succeeded, the result set is too thin
  // to ship without review. Mark the run hitl_blocked rather than
  // letting the existing finalize logic call it "succeeded" — the
  // operator deserves to see "3 of 4 workers failed; review before
  // publishing" instead of a quietly-degraded launch.
  // Note: hitlCount is declared later for clarity in the eo loop;
  // we capture the demotion count here and apply it at finalize.
  const expectedWorkers = workerSettled.length;
  const lowConfidence =
    canonicals.length > 0 &&
    expectedWorkers > 0 &&
    canonicals.length < expectedWorkers * 0.5;
  const lowConfidenceHitl = lowConfidence ? workerFailures : 0;
  if (lowConfidence) {
    notes.push(
      `low_confidence: ${canonicals.length}/${expectedWorkers} workers succeeded — demoting to hitl_blocked`
    );
  }
  workersSpan?.end({
    output: {
      canonicals: canonicals.length,
      failures: workerFailures,
      low_confidence: lowConfidence,
    },
  });

  if (canonicals.length === 0) {
    await db
      .update(launchRuns)
      .set({ status: "failed", durationMs: Date.now() - startedAt })
      .where(eq(launchRuns.id, runId));
    return {
      run_id: runId,
      product_id: product.id,
      product_sku: product.sku,
      status: "failed",
      duration_ms: Date.now() - startedAt,
      total_cost_cents: 0,
      plan,
      canonicals: [],
      adapter_results: [],
      hitl_count: 0,
      notes: [...notes, `all ${workerSettled.length} workers failed — aborting launch`],
    };
  }

  const workerCostCents = canonicals.reduce((sum, c) => sum + c.cost_cents, 0);

  // ── 5. Ensure a default product_variant row exists for the platform_assets FK ──
  let variantId: string;
  const existingVariant = await db
    .select()
    .from(productVariants)
    .where(eq(productVariants.productId, product.id))
    .limit(1);
  if (existingVariant.length > 0) {
    variantId = existingVariant[0].id;
  } else {
    const newVar = await db
      .insert(productVariants)
      .values({ tenantId, productId: product.id, color: null, pattern: null })
      .returning();
    variantId = newVar[0].id;
    notes.push(`auto-created default product_variant ${variantId}`);
  }

  // ── 5.5 Phase I — production pipeline dispatch ────────────────────────
  // When tenant.features.production_pipeline is true AND the caller passed
  // env, route to the production pipeline. Otherwise fall through to the
  // legacy stub workers. This branch writes platform_assets directly,
  // skips the canonical pool + adapter loop, and returns the launch result.
  if (input.env) {
    const [tenantRow] = await db
      .select({ features: tenants.features })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    const features = (tenantRow?.features ?? {}) as TenantFeatures;
    if (features.production_pipeline) {
      const refRows = await db
        .select({ r2Url: productReferences.r2Url })
        .from(productReferences)
        .where(eq(productReferences.productId, product.id));
      // Convert public URLs back to R2 keys: strip the public host prefix.
      const r2Public = input.env.R2_PUBLIC_URL.replace(/\/$/, "");
      const referenceR2Keys = refRows
        .map((r) => r.r2Url.replace(`${r2Public}/`, "").replace(/^https?:\/\/[^/]+\//, ""))
        .filter((k) => k.length > 0);

      const ctx: PipelineCtx = {
        tenantId,
        productId: product.id,
        variantId,
        runId,
        sku: product.sku,
        productName: product.nameEn,
        productNameZh: product.nameZh,
        category: product.category,
        kind: (product.kind ?? "compact_square") as KindType,
        referenceR2Keys,
        features,
        perLaunchCapCents: input.cost_cap_cents ?? 1000, // default $10 ceiling
      };

      const pipelineRes = await runProductionPipeline(input.env, db, {
        ctx,
        platforms: input.platforms,
        product: {
          id: product.id,
          nameEn: product.nameEn,
          category: product.category,
          dimensions: product.dimensions,
          materials: product.materials,
        },
      });

      const status: LaunchPipelineResult["status"] = pipelineRes.ok
        ? pipelineRes.fairCount > 0
          ? "hitl_blocked"
          : "succeeded"
        : "failed";

      // dual_judge.tokenCostCents returns tenths of a cent (e.g. 90.57)
      // so the running total accumulates a fractional value. The
      // launch_runs.total_cost_cents column is integer — round at the
      // storage boundary. Same value goes into the handler's
      // delta-refund calc, so the wallet ledger (also integer) stays
      // consistent.
      const actualTotalCents = Math.round(pipelineRes.totalCostCents);

      await db
        .update(launchRuns)
        .set({
          status,
          totalCostCents: actualTotalCents,
          hitlInterventions: pipelineRes.fairCount,
          durationMs: Date.now() - startedAt,
        })
        .where(eq(launchRuns.id, runId));

      return {
        run_id: runId,
        product_id: product.id,
        product_sku: product.sku,
        status,
        duration_ms: Date.now() - startedAt,
        total_cost_cents: actualTotalCents,
        plan,
        canonicals: [],
        adapter_results: [],
        hitl_count: pipelineRes.fairCount,
        notes: [
          ...notes,
          `production_pipeline: ${pipelineRes.slotsWritten} slot(s) written, ` +
            `${pipelineRes.fairCount} FAIR, ${actualTotalCents}¢ spent`,
          ...pipelineRes.errors.map((e) => `pipeline error: ${e}`),
        ],
      };
    }
  }

  // ── 6. Evaluator-optimizer per adapter target ──────────────────────────
  // Each target runs through the loop in adapters/index.ts → score →
  // regenerate-with-feedback (max 3 iters). HITL flag set when max reached.
  const adapterPool = {
    white_bg: whiteBg ?? undefined,
    lifestyles,
    video: video ?? undefined,
  };
  const adapterResults: LaunchPipelineResult["adapter_results"] = [];
  let hitlCount = 0;
  let evaluatorCostCents = 0;
  let costCapped = false;

  // P1-7 — average cost per adapter target. Used as a pre-flight
  // estimate to short-circuit BEFORE invoking the next adapter when
  // we'd exceed the cap. This is heuristic (the real cost varies by
  // model + iterations); the post-call check below remains as a
  // belt-and-braces guard.
  // Default to a conservative ~50c per target if no prior data exists.
  const PRE_FLIGHT_PER_TARGET_ESTIMATE = 50;
  for (const target of plan.adapter_targets) {
    // P1-7 — pre-flight cap. Estimate the next adapter's cost from the
    // running average of completed targets (or fall back to the
    // conservative constant on the first iteration). If projected total
    // would exceed the cap, halt before paying for the call.
    if (input.cost_cap_cents) {
      const completed = adapterResults.length;
      const estimatedNext =
        completed > 0
          ? Math.round(evaluatorCostCents / completed)
          : PRE_FLIGHT_PER_TARGET_ESTIMATE;
      const projected = workerCostCents + evaluatorCostCents + estimatedNext;
      if (projected > input.cost_cap_cents) {
        costCapped = true;
        notes.push(
          `cost cap ${input.cost_cap_cents}c projected hit (${projected}c with ${estimatedNext}c estimate for ${target.platform}:${target.slot}) — halting before call`
        );
        break;
      }
    }

    const canonical = pickCanonicalForSlot(target.slot, adapterPool);
    if (!canonical) {
      notes.push(
        `skipped (${target.platform}, ${target.slot}) — no canonical available`
      );
      continue;
    }

    const eoSpan = trace?.span({
      name: `eo:${target.platform}:${target.slot}`,
      metadata: {
        platform: target.platform,
        slot: target.slot,
        canonical_kind: canonical.kind,
      },
    });
    const eo = await runEvaluatorOptimizer({
      db,
      tenant_id: tenantId,
      variant_id: variantId,
      product_id: product.id,
      product_sku: product.sku,
      initial_canonical: canonical,
      platform: target.platform,
      slot: target.slot,
      vision_pass: input.vision_pass,
      anthropic_api_key: input.anthropic_api_key,
    });
    eoSpan?.end({
      output: {
        rating: eo.final_score.rating,
        iterations: eo.iterations,
        cost_cents: eo.total_cost_cents,
        hitl_required: eo.hitl_required,
      },
    });

    evaluatorCostCents += eo.total_cost_cents;
    if (eo.hitl_required) hitlCount++;

    adapterResults.push({
      platform: eo.asset.platform,
      slot: eo.asset.slot,
      asset_id: eo.asset.asset_id,
      spec_compliant: eo.asset.spec_compliant,
      spec_violations: eo.asset.spec_violations,
      final_rating: eo.final_score.rating,
      iterations: eo.iterations,
      hitl_required: eo.hitl_required,
    });

    // Post-call check — catches any case where the heuristic estimate
    // under-shot reality (e.g. unexpectedly high regen iterations).
    if (
      input.cost_cap_cents &&
      workerCostCents + evaluatorCostCents > input.cost_cap_cents
    ) {
      costCapped = true;
      notes.push(
        `cost cap ${input.cost_cap_cents}c hit at total ${
          workerCostCents + evaluatorCostCents
        }c — halting remaining adapter targets`
      );
      break;
    }
  }

  // ── 6b. SEO sub-pipeline (Layer D6) ─────────────────────────────────────
  // Runs after image adapters so we have a stable canonical pool to point
  // copy at, but before launch_runs is finalized so the cost ledger sums in.
  let seoResult: SeoPipelineResult | undefined;
  let seoCostCents = 0;
  if (input.include_seo !== false && !costCapped && input.anthropic_api_key) {
    const seoSpan = trace?.span({
      name: "seo_pipeline",
      metadata: {
        platforms: input.platforms,
        surface_count: input.seo_surfaces?.length ?? 0,
      },
    });
    try {
      seoResult = await runSeoPipeline({
        product,
        platforms: input.platforms,
        surfaces: input.seo_surfaces,
        cost_cap_cents: input.seo_cost_cap_cents,
        anthropic_api_key: input.anthropic_api_key,
        openai_api_key: input.openai_api_key,
        dataforseo_login: input.dataforseo_login,
        dataforseo_password: input.dataforseo_password,
      });
      seoCostCents = seoResult.total_cost_cents;
      notes.push(
        `seo_pipeline → ${seoResult.surfaces.length}/${input.platforms.length} surfaces, ${seoResult.total_cost_cents}¢ (${seoResult.status})`
      );

      // ── G3 — persist platform_listings rows for each surface ─────────────
      // One row per (variant, surface, language). Re-runs upsert (DO UPDATE)
      // so the live row always reflects the latest copy + rating.
      // P1-5 — track persist failures so we can demote the run status to
      // hitl_blocked (the dashboard then shows "X of Y listings saved" so
      // the operator triages instead of seeing silently-missing rows).
      for (const surface of seoResult.surfaces) {
        try {
          await db
            .insert(platformListings)
            .values({
              tenantId,
              variantId,
              surface: surface.surface,
              language: surface.language,
              copy: (surface.copy ?? {}) as Record<string, unknown>,
              flags: surface.flags as unknown as Record<string, unknown>[],
              violations: surface.violations as unknown as string[],
              rating: surface.rating ?? null,
              iterations: surface.iterations,
              costCents: Math.round(surface.cost_cents),
              status: "draft",
              updatedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: [
                platformListings.variantId,
                platformListings.surface,
                platformListings.language,
              ],
              set: {
                copy: (surface.copy ?? {}) as Record<string, unknown>,
                flags: surface.flags as unknown as Record<string, unknown>[],
                violations: surface.violations as unknown as string[],
                rating: surface.rating ?? null,
                iterations: surface.iterations,
                costCents: Math.round(surface.cost_cents),
                updatedAt: new Date(),
              },
            });
        } catch (persistErr) {
          const surfaceLabel = `${surface.surface}:${surface.language}`;
          partialListings.push(surfaceLabel);
          notes.push(
            `platform_listings persist failed for ${surfaceLabel} — ${
              persistErr instanceof Error ? persistErr.message : String(persistErr)
            }`
          );
        }
      }
      // Honor the run-level cost cap retroactively.
      if (
        input.cost_cap_cents &&
        workerCostCents + evaluatorCostCents + seoCostCents > input.cost_cap_cents
      ) {
        costCapped = true;
        notes.push(
          `cost cap ${input.cost_cap_cents}¢ exceeded after SEO pipeline (total ${
            workerCostCents + evaluatorCostCents + seoCostCents
          }¢)`
        );
      }
    } catch (e) {
      notes.push(`seo_pipeline failed: ${String(e).slice(0, 200)}`);
    }
    seoSpan?.end({
      output: seoResult
        ? {
            surfaces_returned: seoResult.surfaces.length,
            cost_cents: seoCostCents,
            status: seoResult.status,
          }
        : { error: "seo_pipeline_failed" },
    });
  } else if (!input.anthropic_api_key && input.include_seo !== false) {
    notes.push("seo_pipeline skipped (no ANTHROPIC_API_KEY)");
  }

  // ── 6.5 Image QA Layer 2 — batch consistency check ─────────────────────
  // Runs ONCE after every image has passed Layer 1's per-image dual judge.
  // Verifies cross-image properties Layer 1 cannot see (same product
  // across all shots, uniform background style, no near-duplicates).
  // V1 behavior on overall_approved=false: demote to hitl_blocked and
  // attach per-image issues to the result notes; auto-regenerate the
  // inconsistent images is deferred to a later iteration.
  let batchConsistencyCostCents = 0;
  let batchInconsistencyCount = 0;
  if (
    input.vision_pass &&
    input.anthropic_api_key &&
    adapterResults.length > 1
  ) {
    const consistencySpan = trace?.span({
      name: "batch_consistency",
      metadata: { image_count: adapterResults.length },
    });
    try {
      const assetIds = adapterResults.map((r) => r.asset_id);
      const rows = await db
        .select({
          id: platformAssets.id,
          platform: platformAssets.platform,
          slot: platformAssets.slot,
          r2Url: platformAssets.r2Url,
        })
        .from(platformAssets)
        .where(inArray(platformAssets.id, assetIds));
      const consistencyResult = await checkBatchConsistency({
        api_key: input.anthropic_api_key,
        images: rows.map((r) => ({
          asset_id: r.id,
          platform: r.platform,
          slot: r.slot,
          url: r.r2Url,
        })),
        persist: { db, tenantId },
      });
      batchConsistencyCostCents = consistencyResult.cost_cents;
      batchInconsistencyCount = consistencyResult.per_image.filter(
        (j) => !j.approved
      ).length;
      notes.push(
        `batch_consistency: overall=${consistencyResult.overall_approved ? "approve" : "reject"} (${consistencyResult.overall_reason}); ${batchInconsistencyCount} image(s) flagged`
      );
      for (const j of consistencyResult.per_image) {
        if (!j.approved && j.issue) {
          notes.push(
            `batch_consistency reject [${j.asset_id.slice(0, 8)}…]: ${j.issue}`
          );
        }
      }
      if (!consistencyResult.overall_approved) {
        // Demote run-level HITL count by adding the inconsistency
        // count; the pipeline's finalStatus logic below catches this
        // and ends up `hitl_blocked` if hitlCount > 0.
        hitlCount += Math.max(1, batchInconsistencyCount);
      }
      consistencySpan?.end({
        output: {
          overall_approved: consistencyResult.overall_approved,
          inconsistencies: batchInconsistencyCount,
          cost_cents: batchConsistencyCostCents,
        },
      });
    } catch (err) {
      // Layer 2 failure must not tank an otherwise-clean launch — the
      // per-image floor (Layer 1) still stands. Log and move on.
      notes.push(
        `batch_consistency skipped: ${err instanceof Error ? err.message : String(err)}`
      );
      consistencySpan?.end({
        output: { error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  // ── 7. Finalize launch_runs ─────────────────────────────────────────────
  const durationMs = Date.now() - startedAt;
  const totalCostCents =
    workerCostCents +
    evaluatorCostCents +
    seoCostCents +
    batchConsistencyCostCents;
  // P1-5 — partial-listings persistence failure demotes to hitl_blocked
  // (so the dashboard's Listings tab can surface "X of Y listings saved"
  // instead of pretending the missing rows never existed).
  if (partialListings.length > 0) {
    hitlCount += partialListings.length;
  }
  // P1-8 — apply the low-confidence demotion captured during the
  // worker fan-out earlier in the function.
  if (lowConfidenceHitl > 0) {
    hitlCount += lowConfidenceHitl;
  }
  const finalStatus: LaunchPipelineResult["status"] = costCapped
    ? "cost_capped"
    : hitlCount > 0
      ? "hitl_blocked"
      : "succeeded";

  await db
    .update(launchRuns)
    .set({
      status: finalStatus,
      durationMs,
      totalCostCents: Math.round(totalCostCents),
      hitlInterventions: hitlCount,
    })
    .where(eq(launchRuns.id, runId));

  trace?.update({
    output: {
      status: finalStatus,
      duration_ms: durationMs,
      total_cost_cents: Math.round(totalCostCents),
      hitl_count: hitlCount,
    },
  });

  // P1-9 — flush buffered Langfuse events. Workers can recycle before
  // events post otherwise. Fire-and-forget so the response isn't blocked
  // on the network round-trip.
  if (langfuse) {
    langfuse.flushAsync().catch((flushErr) =>
      console.warn(
        "[launch_pipeline] langfuse flush failed",
        flushErr instanceof Error ? flushErr.message : String(flushErr)
      )
    );
  }

  return {
    run_id: runId,
    product_id: product.id,
    product_sku: product.sku,
    status: finalStatus,
    duration_ms: durationMs,
    total_cost_cents: totalCostCents,
    plan,
    canonicals,
    adapter_results: adapterResults,
    hitl_count: hitlCount,
    notes,
    seo: seoResult,
    partial_listings: partialListings.length > 0 ? partialListings : undefined,
  };
}
