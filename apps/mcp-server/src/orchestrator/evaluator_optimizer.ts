/**
 * v2 Phase 4-follow — evaluator-optimizer loop (plan §4.5).
 *
 * Wraps each adapter target with an iterate-on-feedback loop:
 *   adapt → score → if POOR && iter < MAX → regenerate canonical
 *   with feedback → re-adapt → re-score (max 3 iterations)
 *   if still POOR after MAX → mark HITL-required
 *
 * For Phase 3 stub workers, regeneration produces the same output (the stub
 * doesn't actually use feedback). The loop scaffold is correct; Phase 2 real
 * generators will use the feedback string to steer FLUX Kontext / Nano Banana
 * Pro re-prompts.
 */

import type { DbClient } from "../db/client.js";
import { runAdapter, type AdapterResult } from "../adapters/index.js";
import {
  generateWhiteBgWorker,
  generateLifestyleWorker,
  generateVideoWorker,
  type CanonicalAsset,
  type WorkerFeedback,
} from "./workers.js";
import { scoreAmazonCompliance } from "../compliance/amazon_scorer.js";
import { scoreShopifyCompliance } from "../compliance/shopify_scorer.js";
import type { PlatformComplianceResultType } from "@ff/types";

export const MAX_REFINEMENT_ITERATIONS = 3;

export interface RefinementHistoryEntry {
  iteration: number;
  rating: string;
  issues: string[];
  model_used: string;
  cost_cents: number;
  timestamp: string;
}

export interface EvaluatorOptimizerInput {
  db: DbClient;
  variant_id: string;
  product_id: string;
  product_sku: string;
  initial_canonical: CanonicalAsset;
  platform: "amazon" | "shopify";
  slot: string;
  /** Anthropic API key — only consulted when vision_pass=true. */
  anthropic_api_key?: string;
  /** Run Opus 4.7 vision pass after the deterministic scorer. */
  vision_pass?: boolean;
}

export interface EvaluatorOptimizerOutput {
  asset: AdapterResult;
  final_score: PlatformComplianceResultType;
  iterations: number;
  history: RefinementHistoryEntry[];
  hitl_required: boolean;
  total_cost_cents: number;
}

async function regenerateCanonical(
  input: {
    product_id: string;
    product_sku: string;
    feedback: WorkerFeedback;
  },
  prior: CanonicalAsset
): Promise<CanonicalAsset> {
  switch (prior.kind) {
    case "white_bg":
      return generateWhiteBgWorker({
        product_id: input.product_id,
        product_sku: input.product_sku,
        feedback: input.feedback,
      });
    case "lifestyle": {
      // Reuse aspect from prior render (read from r2 url shape isn't reliable;
      // default to 1:1 for the scaffold)
      return generateLifestyleWorker({
        product_id: input.product_id,
        product_sku: input.product_sku,
        scene_hint: "regen",
        aspect: "1:1",
        feedback: input.feedback,
      });
    }
    case "video":
      return generateVideoWorker({
        product_id: input.product_id,
        product_sku: input.product_sku,
      });
    default:
      // Variants don't have a regenerate path in Phase 3 (they require LoRA).
      return prior;
  }
}

export async function runEvaluatorOptimizer(
  input: EvaluatorOptimizerInput
): Promise<EvaluatorOptimizerOutput> {
  const history: RefinementHistoryEntry[] = [];
  let canonical = input.initial_canonical;
  let asset: AdapterResult | null = null;
  let final_score: PlatformComplianceResultType | null = null;
  let totalCost = 0;
  let iter = 1;

  for (; iter <= MAX_REFINEMENT_ITERATIONS; iter++) {
    asset = await runAdapter({
      db: input.db,
      variant_id: input.variant_id,
      canonical,
      platform: input.platform,
      slot: input.slot,
    });

    final_score =
      input.platform === "amazon"
        ? await scoreAmazonCompliance(input.db, asset.asset_id, {
            vision: input.vision_pass,
            anthropic_api_key: input.anthropic_api_key,
          })
        : await scoreShopifyCompliance(input.db, asset.asset_id);

    const visionCost =
      typeof final_score.metrics.vision_cost_cents === "number"
        ? (final_score.metrics.vision_cost_cents as number)
        : 0;
    totalCost += canonical.cost_cents + visionCost;

    history.push({
      iteration: iter,
      rating: final_score.rating,
      issues: final_score.issues,
      model_used: canonical.model_used,
      cost_cents: canonical.cost_cents + visionCost,
      timestamp: new Date().toISOString(),
    });

    if (final_score.rating === "EXCELLENT") break;
    if (iter === MAX_REFINEMENT_ITERATIONS) break;

    // Regenerate with feedback for next iteration
    canonical = await regenerateCanonical(
      {
        product_id: input.product_id,
        product_sku: input.product_sku,
        feedback: {
          prior_issues: final_score.issues,
          iteration: iter + 1,
        },
      },
      canonical
    );
  }

  if (asset === null || final_score === null) {
    throw new Error("evaluator-optimizer produced no result — should be unreachable");
  }

  const hitl_required = final_score.rating !== "EXCELLENT";

  return {
    asset,
    final_score,
    iterations: iter,
    history,
    hitl_required,
    total_cost_cents: totalCost,
  };
}
