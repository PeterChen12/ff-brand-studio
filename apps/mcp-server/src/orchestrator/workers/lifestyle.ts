import type { CanonicalAsset, WorkerFeedback } from "./types.js";
import { PLACEHOLDER_BUCKET_BASE } from "./types.js";

/**
 * Phase 3 stub. Phase 2 will replace with fal Nano Banana Pro (Gemini 3
 * Pro Image) — up to 14 reference images, Batch API for async runs (-50%).
 */
export async function generateLifestyleWorker(input: {
  product_id: string;
  product_sku: string;
  scene_hint: string;
  aspect: "1:1" | "3:4" | "16:9";
  feedback?: WorkerFeedback;
}): Promise<CanonicalAsset> {
  const dims =
    input.aspect === "1:1"
      ? [3840, 3840]
      : input.aspect === "3:4"
        ? [2880, 3840]
        : [3840, 2160];
  const iter = input.feedback?.iteration ?? 1;
  return {
    kind: "lifestyle",
    r2_url: `${PLACEHOLDER_BUCKET_BASE}/${input.product_sku}/lifestyle_${input.scene_hint}_iter${iter}.jpg`,
    width: dims[0],
    height: dims[1],
    model_used: "nano-banana-pro:stub",
    cost_cents: 0,
    prompt_summary: `lifestyle ${input.scene_hint} ${input.aspect}`,
  };
}
