/**
 * Phase I, Step 6 — Iterate-with-correction loop.
 *
 * Caps at 3 refine iterations per crop. After CLIP triage:
 *   pass               → ship
 *   fail + vision pass → ship (false-negative bias on cheap CLIP)
 *   fail + vision fail → re-refine with prompt amended by vision reasons
 *   iter 3 still fails → ship the best-rated; mark FAIR for HITL
 *
 * Wallet-aware: each refine + each vision call is debited via the
 * orchestrator's running totalCostCents counter; halts if next iter
 * would exceed perLaunchCapCents.
 */

import type { PipelineCtx, RefinedAsset, Verdict } from "./types.js";
import { getDeriver, type RefinePromptArgs } from "./derivers/index.js";
import { refineCall, REFINE_COST_CENTS } from "./refine.js";
import { clipSimilarityFromR2 } from "./triage.js";
import { visionVerdictFromR2, VISION_COST_CENTS } from "./audit.js";

const MAX_ITERS = 3;

export interface IterateInput {
  cropTag: string;
  cropR2Key: string;
  studioR2Key: string;
  /** Reference image to compare against — usually the cleanup_studio. */
  referenceR2Key: string;
  /** Wallet ceiling check — orchestrator subtracts before calling. */
  remainingBudgetCents: number;
}

export interface IterateOutput {
  asset: RefinedAsset;
  /** Cost the orchestrator should record for this crop's refine + audit. */
  costCents: number;
}

export async function refineWithIteration(
  env: CloudflareBindings,
  ctx: PipelineCtx,
  input: IterateInput
): Promise<IterateOutput | { error: string }> {
  const deriver = getDeriver(ctx.kind);
  const promptArgs: RefinePromptArgs = {
    productName: ctx.productName,
    productNameZh: ctx.productNameZh,
    category: ctx.category,
  };
  const basePrompt = deriver.refinePrompt(promptArgs);

  const history: RefinedAsset["history"] = [];
  let iter = 0;
  let totalCost = 0;
  let bestKey: string | null = null;
  let bestScore: number | null = null;
  let lastVerdict: Verdict | null = null;
  let prompt = basePrompt;
  let budget = input.remainingBudgetCents;

  while (iter < MAX_ITERS) {
    if (budget < REFINE_COST_CENTS) {
      // Out of money — return what we have (or report error if we have nothing).
      if (!bestKey) {
        return { error: "wallet_capped before any refine landed" };
      }
      break;
    }
    iter += 1;
    const stepRes = await refineCall(env, ctx, input.studioR2Key, input.cropR2Key, {
      cropTag: input.cropTag,
      iter,
      promptOverride: iter === 1 ? undefined : prompt,
    });
    if (stepRes.status !== "ok") {
      // If iter 1 fails outright, surface the error. Later iter failures
      // fall back to whatever bestKey we already have.
      if (iter === 1) {
        return { error: errToString(stepRes) };
      }
      break;
    }
    totalCost += stepRes.costCents;
    budget -= stepRes.costCents;

    // CLIP triage against the reference.
    const score = await clipSimilarityFromR2(env, input.referenceR2Key, stepRes.outputR2Key);
    history.push({ iter, r2Key: stepRes.outputR2Key, clipScore: score });

    if (bestKey === null || (score !== null && (bestScore === null || score > bestScore))) {
      bestKey = stepRes.outputR2Key;
      bestScore = score;
    }

    if (score !== null && score >= deriver.clipThreshold) {
      // Pass — ship.
      return {
        asset: {
          cropName: input.cropTag,
          finalR2Key: stepRes.outputR2Key,
          iters: iter,
          clipScore: score,
          verdict: null,
          fair: false,
          totalCostCents: totalCost,
          history,
        },
        costCents: totalCost,
      };
    }

    // Below threshold (or CLIP unavailable) — escalate to vision once per crop.
    if (lastVerdict === null) {
      if (budget < VISION_COST_CENTS) break;
      const v = await visionVerdictFromR2(env, ctx, input.referenceR2Key, stepRes.outputR2Key);
      if ("error" in v) {
        // Vision unavailable — fall back to "ship despite low CLIP" with FAIR flag at end.
        lastVerdict = { verdict: "fail", reasons: [v.error], details: {} };
      } else {
        lastVerdict = v.verdict;
        totalCost += v.costCents;
        budget -= v.costCents;
      }
      history[history.length - 1].verdict = lastVerdict;

      if (lastVerdict.verdict === "pass") {
        // CLIP false negative — ship anyway.
        return {
          asset: {
            cropName: input.cropTag,
            finalR2Key: stepRes.outputR2Key,
            iters: iter,
            clipScore: score,
            verdict: lastVerdict,
            fair: false,
            totalCostCents: totalCost,
            history,
          },
          costCents: totalCost,
        };
      }
    }

    // Vision said fail — amend prompt with vision reasons + geometry-correction language.
    const reasons = lastVerdict?.reasons ?? [];
    const reasonBlock = reasons.length
      ? "\nPrior attempt was rejected for these reasons — fix each:\n" +
        reasons.map((r) => `  - ${r}`).join("\n")
      : "";
    const geometryBlock = iter >= 2
      ? "\nThis is a geometry-correction iteration. Hold the identity of the studio reference exactly; only adjust framing to match the second reference."
      : "";
    prompt = basePrompt + reasonBlock + geometryBlock;
  }

  // Hit the ceiling — ship the best we have but mark FAIR.
  if (!bestKey) {
    return { error: "no successful refine after MAX_ITERS" };
  }
  return {
    asset: {
      cropName: input.cropTag,
      finalR2Key: bestKey,
      iters: iter,
      clipScore: bestScore,
      verdict: lastVerdict,
      fair: true,
      totalCostCents: totalCost,
      history,
    },
    costCents: totalCost,
  };
}

function errToString(res: Awaited<ReturnType<typeof refineCall>>): string {
  if (res.status !== "error") return "unknown";
  const e = res.error;
  switch (e.kind) {
    case "provider_error":
      return `${e.provider}${e.status ? ` ${e.status}` : ""}: ${e.message}`;
    case "config_missing":
      return `config missing: ${e.field}`;
    case "wallet_capped":
      return `wallet capped (${e.remainingCents}¢ remaining)`;
    case "sidecar_unavailable":
      return `sidecar unavailable: ${e.message}`;
    case "quota_exceeded":
      return `quota exceeded: ${e.provider}`;
    case "identity_mismatch":
      return `identity mismatch: ${e.reasons.join("; ")}`;
  }
}
