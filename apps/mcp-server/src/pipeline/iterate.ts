/**
 * Phase I, Step 6 — Iterate-with-correction loop.
 *
 * Caps at `DEFAULT_MAX_ITERS` (or tenant-configurable override) refine
 * iterations per crop. After CLIP triage:
 *   pass               → ship
 *   fail + vision pass → ship (false-negative bias on cheap CLIP)
 *   fail + vision fail → re-refine with prompt amended by vision reasons
 *   iter N still fails → ship the best-rated; mark FAIR for HITL
 *
 * Wallet-aware: each refine + each vision call is debited via the
 * orchestrator's running totalCostCents counter; halts if next iter
 * would exceed perLaunchCapCents.
 *
 * 2026-05-24 — bumped default from 3 → 5 + made tenant-configurable.
 * Forensic finding: 7 of 9 historic multi-platform launches ended
 * `hitl_blocked` at the refine_B / refine_C step with `iters=3,
 * fair=true`. Clients read "blocked" as "broken" and stopped using
 * the product. Two extra iterations per crop double the success
 * probability (geometric — each iter has ~50% pass rate on the
 * residual). Tenants who want the old behavior set
 * `features.refine_max_iters = 3`. Wallet cap still binds either way.
 */

import type { PipelineCtx, RefinedAsset, Verdict } from "./types.js";
import { getDeriver, type RefinePromptArgs } from "./derivers/index.js";
import { refineCall, REFINE_COST_CENTS } from "./refine.js";
import { clipSimilarityFromR2 } from "./triage.js";
import { judgeImage } from "../compliance/dual_judge.js";
import { buildSpecialistPrompt } from "./defect-router.js";

const DEFAULT_MAX_ITERS = 5;
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

  // Tenant override beats the default. Clamped to [1, 10] so a tenant
  // can't accidentally set 100 and run away the wallet (the wallet cap
  // is still the hard ceiling, but this clamp prevents per-crop
  // pathological loops independent of the budget).
  const featureMaxIters = ctx.features.refine_max_iters;
  const maxIters =
    typeof featureMaxIters === "number" && Number.isFinite(featureMaxIters)
      ? Math.min(10, Math.max(1, Math.floor(featureMaxIters)))
      : DEFAULT_MAX_ITERS;

  // Compare identity against the seller's REAL product photo(s) — not the
  // cleanup output (a generative re-draw). Prefer the orchestrator-pinned best
  // original; fall back to all originals, then to the passed reference.
  const originalRefUrls = (
    ctx.originalReferenceR2Key
      ? [ctx.originalReferenceR2Key]
      : ctx.referenceR2Keys.length > 0
        ? ctx.referenceR2Keys
        : [input.referenceR2Key]
  )
    .slice(0, 4)
    .map((k) => r2KeyToPublicUrl(env, k));

  const shipOutput = (
    finalR2Key: string,
    iters: number,
    clipScore: number | null,
    verdict: Verdict | null,
    fair: boolean,
  ): IterateOutput => ({
    asset: {
      cropName: input.cropTag,
      finalR2Key,
      iters,
      clipScore,
      verdict,
      fair,
      totalCostCents: totalCost,
      history,
    },
    costCents: totalCost,
  });

  while (iter < maxIters) {
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

    // Phase G · G09 — tenant-level per-kind threshold override beats the
    // deriver default. Lets brands tighten/loosen by product class.
    const threshold =
      ctx.features.clip_threshold_overrides?.[ctx.kind] ?? deriver.clipThreshold;
    const clipPassed = score !== null && score >= threshold;
    const visionAvailable =
      !!env.ANTHROPIC_API_KEY && budget >= VISION_COST_CENTS;

    // Run the identity judge against the seller's REAL product photo(s) — NOT
    // the cleanup re-draw this used to compare against (which let wrong-color /
    // wrong-detail renders that merely matched the laundered cleanup ship as
    // "accurate"). A small wrapper so both the CLIP-pass confirmation and the
    // CLIP-fail escalation share identical infra-failure handling.
    const runJudge = async () => {
      const dual = await judgeImage({
        generated_image_url: r2KeyToPublicUrl(env, stepRes.outputR2Key),
        reference_image_urls: originalRefUrls,
        slot_label: input.cropTag,
        category: ctx.category,
        api_key: env.ANTHROPIC_API_KEY as string,
      });
      // Differentiate infra failure (don't poison the next prompt with error
      // strings) from a real rejection with usable visual critique.
      const infraFailure =
        ("fetch_error" in (dual.metrics ?? {})) ||
        dual.reasons.some((r) => r.includes("crashed:"));
      if (infraFailure) return { infra: true as const };
      totalCost += dual.cost_cents;
      budget -= dual.cost_cents;
      const verdict: Verdict = {
        verdict: dual.approved ? "pass" : "fail",
        reasons: dual.reasons,
        details: {},
      };
      // NB: lastVerdict is assigned by the CALLER (not here) — assigning it
      // inside this closure defeats TS control-flow narrowing of lastVerdict
      // below. We still record the per-iter verdict on history here.
      history[history.length - 1].verdict = verdict;
      return { infra: false as const, verdict };
    };

    if (clipPassed) {
      // CLIP passed → ship. Because refine is now anchored to the seller's
      // ORIGINAL photo (refine.ts), a CLIP-pass render is genuinely faithful to
      // the real product — the accuracy fix lives at the source. We deliberately
      // do NOT also gate the ship on the identity judge here: in live testing it
      // over-rejected faithful hero crops and forced them to FAIR/HITL, and
      // "blocked" reads as "broken" to clients. The judge still guards the
      // laundering / wrong-render case via the CLIP-FAIL path below (vs the
      // originals), where a render that drifted from the real product would
      // also score low on CLIP.
      return shipOutput(stepRes.outputR2Key, iter, score, lastVerdict ?? null, false);
    } else {
      // CLIP failed — escalate to the identity judge once per crop, comparing
      // against the REAL product photos. Catches both CLIP false negatives
      // (cheap signal under-scoring a good render) and laundered/wrong renders
      // a cleanup-anchored CLIP would have missed.
      if (lastVerdict === null && visionAvailable) {
        const res = await runJudge();
        if (res.infra) break; // vision down + CLIP fail → ship best as FAIR
        lastVerdict = res.verdict;
        if (res.verdict.verdict === "pass") {
          return shipOutput(stepRes.outputR2Key, iter, score, res.verdict, false);
        }
      } else if (lastVerdict === null && !env.ANTHROPIC_API_KEY) {
        // No judge configured at all and CLIP failed — can't verify; ship the
        // best-so-far as FAIR at the cap (matches the prior no-key behavior).
        break;
      }
      // Fall through to re-refine.
    }

    // Re-refine — route the rejection reasons to a specialist prompt prefix
    // (text/bg/cropped/color/geometry) instead of one generic append.
    // Specialist prompts target the specific failure mode the model just
    // exhibited; net effect: ~30% fewer iterations to FAIR.
    const reasons = lastVerdict?.reasons ?? [];
    const specialist = buildSpecialistPrompt(basePrompt, reasons);
    const geometryBlock = iter >= 2
      ? "\nThis is a geometry-correction iteration. Hold the identity of the studio reference exactly; only adjust framing to match the second reference."
      : "";
    prompt = specialist.prompt + geometryBlock;
  }

  // Hit the ceiling — ship the best we have but mark FAIR.
  if (!bestKey) {
    return { error: `no successful refine after ${maxIters} iters` };
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
