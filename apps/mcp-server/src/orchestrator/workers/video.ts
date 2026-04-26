import type { CanonicalAsset } from "./types.js";
import { PLACEHOLDER_BUCKET_BASE } from "./types.js";

/**
 * Phase 3 stub. Phase 2 will reuse the existing Kling client in
 * packages/media-clients, re-parameterized for Amazon main-image-video
 * spec (1920x1080 H.264, 15-30s).
 */
export async function generateVideoWorker(input: {
  product_id: string;
  product_sku: string;
}): Promise<CanonicalAsset> {
  return {
    kind: "video",
    r2_url: `${PLACEHOLDER_BUCKET_BASE}/${input.product_sku}/main_video.mp4`,
    width: 1920,
    height: 1080,
    model_used: "kling-2-6:stub",
    cost_cents: 0,
    prompt_summary: `main video for ${input.product_sku}`,
  };
}
