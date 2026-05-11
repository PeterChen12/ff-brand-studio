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
import { judgeImage } from "../compliance/dual_judge.js";

const MAX_ITERS = 3;
/** Pre-flight budget guard for the per-crop QA call. Two Haiku calls
 *  typically come in under this; treated as a floor, not a debit. */
const VISION_COST_CENTS = 2;

function r2KeyToPublicUrl(env: CloudflareBindings, key: string): string {
  return `${env.R2_PUBLIC_URL.replace(/\/$/, "")}/${key}`;
}

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

    // Below threshold (or CLIP unavailable) — escalate to dual-judge once per crop.
    if (lastVerdict === null) {
      if (budget < VISION_COST_CENTS) break;
      if (!env.ANTHROPIC_API_KEY) break;
      const dual = await judgeImage({
        generated_image_url: r2KeyToPublicUrl(env, stepRes.outputR2Key),
        reference_image_urls: [r2KeyToPublicUrl(env, input.referenceR2Key)],
        slot_label: input.cropTag,
        category: ctx.category,
        api_key: env.ANTHROPIC_API_KEY,
      });
      // Differentiate infra failure (don't poison iter-2 prompt) from
      // a real rejection with usable visual critique.
      const infraFailure =
        ("fetch_error" in (dual.metrics ?? {})) ||
        dual.reasons.some((r) => r.includes("crashed:"));
      if (infraFailure) {
        // Vision unavailable — fall through to "ship best with FAIR" below
        // without amending the prompt with error strings.
        break;
      }
      totalCost += dual.cost_cents;
      budget -= dual.cost_cents;
      lastVerdict = {
        verdict: dual.approved ? "pass" : "fail",
        reasons: dual.reasons,
        details: {},
      };
      history[history.length - 1].verdict = lastVerdict;

      if (lastVerdict.verdict === "pass") {
        // CLIP false negative — dual-judge approved; ship.
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
    // Phase E · Iter 04 — when the framing judge flagged unintended
    // text/watermarks/logos, prepend an emphatic anti-text directive.
    // The base prompt's banned block already says "no text" but the
    // model has just demonstrated it ignores that; this prefix is
    // calibrated for the "previous attempt added a watermark" case.
    const textRelated = /\b(text|watermark|logo|label|caption|character|tag|scanline)\b/i;
    const textBlock = reasons.some((r) => textRelated.test(r))
      ? "\n\nABSOLUTE PRIORITY: The previous attempt added text/watermarks/logos that DO NOT belong in this image. This is a CRITICAL failure. Generate the image with ZERO text, ZERO letters, ZERO numbers, ZERO logos, ZERO watermarks, ZERO captions, ZERO labels. The ONLY text that may appear is text physically printed on the actual product as shown in the reference image — and only if it renders cleanly without character-warping artifacts. Treat any other text as a banned element.\n"
      : "";
    prompt = basePrompt + textBlock + reasonBlock + geometryBlock;
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
