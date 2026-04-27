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

import { eq } from "drizzle-orm";
import type { DbClient } from "../db/client.js";
import {
  products,
  productReferences,
  productVariants,
  sellerProfiles,
  launchRuns,
  type Product,
} from "../db/schema.js";
import { planSkuLaunch, type LaunchPlatform, type PlannedWork } from "./planner.js";
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
}

export async function runLaunchPipeline(
  db: DbClient,
  input: LaunchPipelineInput
): Promise<LaunchPipelineResult> {
  const startedAt = Date.now();
  const notes: string[] = [];

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

  // ── 2. Insert launch_runs row up front ─────────────────────────────────
  const inserted = await db
    .insert(launchRuns)
    .values({
      productId: product.id,
      orchestratorModel: "claude-sonnet-4-6",
      status: "pending",
      totalCostCents: 0,
      hitlInterventions: 0,
    })
    .returning();
  const runId = inserted[0].id;

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
      .values({ productId: product.id, color: null, pattern: null })
      .returning();
    variantId = newVar[0].id;
    notes.push(`auto-created default product_variant ${variantId}`);
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

  for (const target of plan.adapter_targets) {
    const canonical = pickCanonicalForSlot(target.slot, adapterPool);
    if (!canonical) {
      notes.push(
        `skipped (${target.platform}, ${target.slot}) — no canonical available`
      );
      continue;
    }

    const eo = await runEvaluatorOptimizer({
      db,
      variant_id: variantId,
      product_id: product.id,
      product_sku: product.sku,
      initial_canonical: canonical,
      platform: target.platform,
      slot: target.slot,
      vision_pass: input.vision_pass,
      anthropic_api_key: input.anthropic_api_key,
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
  } else if (!input.anthropic_api_key && input.include_seo !== false) {
    notes.push("seo_pipeline skipped (no ANTHROPIC_API_KEY)");
  }

  // ── 7. Finalize launch_runs ─────────────────────────────────────────────
  const durationMs = Date.now() - startedAt;
  const totalCostCents = workerCostCents + evaluatorCostCents + seoCostCents;
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
  };
}
