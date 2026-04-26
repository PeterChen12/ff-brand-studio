import type { CanonicalAsset, WorkerFeedback } from "./types.js";
import { PLACEHOLDER_BUCKET_BASE } from "./types.js";

/**
 * Phase 3 stub. Phase 2 will replace the body with a fal FLUX Kontext Pro
 * call (with Nano Banana Pro Edit fallback per ADR-0002), running the
 * forceWhiteBackground() post-processor from src/lib/image_post.ts and
 * uploading to R2.
 *
 * When feedback.iteration > 1, the prompt should incorporate prior_issues
 * (e.g., "ensure background is pure white, fill ≥85%").
 */
export async function generateWhiteBgWorker(input: {
  product_id: string;
  product_sku: string;
  feedback?: WorkerFeedback;
}): Promise<CanonicalAsset> {
  const iter = input.feedback?.iteration ?? 1;
  return {
    kind: "white_bg",
    r2_url: `${PLACEHOLDER_BUCKET_BASE}/${input.product_sku}/canonical_white_bg_iter${iter}.jpg`,
    width: 3000,
    height: 3000,
    model_used: "flux-kontext-pro:stub",
    cost_cents: 0,
    prompt_summary: `white-bg studio shot for ${input.product_sku}`,
  };
}
