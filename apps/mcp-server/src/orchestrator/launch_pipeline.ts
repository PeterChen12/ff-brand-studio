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
} from "./workers.js";
import { runAdapter, pickCanonicalForSlot } from "../adapters/index.js";

export interface LaunchPipelineInput {
  product_id: string;
  platforms: LaunchPlatform[];
  include_video: boolean;
  dry_run: boolean;
}

export interface LaunchPipelineResult {
  run_id: string;
  product_id: string;
  product_sku: string;
  status: "succeeded" | "failed" | "hitl_blocked";
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
  }>;
  notes: string[];
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
    await db
      .update(launchRuns)
      .set({ status: "succeeded", durationMs: Date.now() - startedAt })
      .where(eq(launchRuns.id, runId));
    return {
      run_id: runId,
      product_id: product.id,
      product_sku: product.sku,
      status: "succeeded",
      duration_ms: Date.now() - startedAt,
      total_cost_cents: 0,
      plan,
      canonicals: [],
      adapter_results: [],
      notes: [...notes, "dry_run=true — skipped workers and adapters"],
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

  // ── 6. Adapters (sequential to keep DB writes ordered + observable) ────
  const adapterPool = {
    white_bg: whiteBg ?? undefined,
    lifestyles,
    video: video ?? undefined,
  };
  const adapterResults: LaunchPipelineResult["adapter_results"] = [];
  for (const target of plan.adapter_targets) {
    const canonical = pickCanonicalForSlot(target.slot, adapterPool);
    if (!canonical) {
      notes.push(
        `skipped (${target.platform}, ${target.slot}) — no canonical available`
      );
      continue;
    }
    const result = await runAdapter({
      db,
      variant_id: variantId,
      canonical,
      platform: target.platform,
      slot: target.slot,
    });
    adapterResults.push({
      platform: result.platform,
      slot: result.slot,
      asset_id: result.asset_id,
      spec_compliant: result.spec_compliant,
      spec_violations: result.spec_violations,
    });
  }

  // ── 7. Finalize launch_runs ─────────────────────────────────────────────
  const durationMs = Date.now() - startedAt;
  const totalCostCents = workerCostCents; // Phase 4 adds evaluator/scorer cost.
  await db
    .update(launchRuns)
    .set({
      status: "succeeded",
      durationMs,
      totalCostCents,
    })
    .where(eq(launchRuns.id, runId));

  return {
    run_id: runId,
    product_id: product.id,
    product_sku: product.sku,
    status: "succeeded",
    duration_ms: durationMs,
    total_cost_cents: totalCostCents,
    plan,
    canonicals,
    adapter_results: adapterResults,
    notes,
  };
}
