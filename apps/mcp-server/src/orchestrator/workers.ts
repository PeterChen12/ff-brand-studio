/**
 * v2 Phase 3 workers — STUB IMPLEMENTATIONS.
 *
 * These return placeholder R2 URLs and well-formed metadata so the orchestrator
 * fan-out and adapters can run end-to-end without Phase 2's real generators.
 *
 * Phase 2 will replace each function body with the real model call:
 *  - generateWhiteBgWorker → FLUX Kontext Pro / Nano Banana Pro Edit
 *  - generateLifestyleWorker → Nano Banana Pro
 *  - generateVariantWorker → FLUX.2 Dev + LoRA
 *  - generateVideoWorker → Kling (already in stack, see packages/media-clients)
 *
 * The function signatures are stable — Phase 2 replaces internals only.
 */

export interface CanonicalAsset {
  kind: "white_bg" | "lifestyle" | "variant" | "video";
  r2_url: string;
  width: number;
  height: number;
  model_used: string;
  cost_cents: number;
  prompt_summary: string;
}

const PLACEHOLDER_BUCKET_BASE =
  "https://pub-db3f39e3386347d58359ba96517eec84.r2.dev/_phase3_stub";

export async function generateWhiteBgWorker(input: {
  product_id: string;
  product_sku: string;
}): Promise<CanonicalAsset> {
  // TODO Phase 2: call falFluxKontextPro with reference images, run
  // forceWhiteBackground() post-processor, scale to 88% fill, upload to R2.
  return {
    kind: "white_bg",
    r2_url: `${PLACEHOLDER_BUCKET_BASE}/${input.product_sku}/canonical_white_bg.jpg`,
    width: 3000,
    height: 3000,
    model_used: "flux-kontext-pro:stub",
    cost_cents: 0,
    prompt_summary: `white-bg studio shot for ${input.product_sku}`,
  };
}

export async function generateLifestyleWorker(input: {
  product_id: string;
  product_sku: string;
  scene_hint: string;
  aspect: "1:1" | "3:4" | "16:9";
}): Promise<CanonicalAsset> {
  // TODO Phase 2: call falNanoBananaPro with up to 14 reference images.
  const dims =
    input.aspect === "1:1" ? [3840, 3840] : input.aspect === "3:4" ? [2880, 3840] : [3840, 2160];
  return {
    kind: "lifestyle",
    r2_url: `${PLACEHOLDER_BUCKET_BASE}/${input.product_sku}/lifestyle_${input.scene_hint}.jpg`,
    width: dims[0],
    height: dims[1],
    model_used: "nano-banana-pro:stub",
    cost_cents: 0,
    prompt_summary: `lifestyle ${input.scene_hint} ${input.aspect}`,
  };
}

export async function generateVariantWorker(input: {
  product_id: string;
  product_sku: string;
  scene_hint: string;
  lora_url?: string | null;
}): Promise<CanonicalAsset> {
  // TODO Phase 2: call fal FLUX.2 Dev + LoRA.
  return {
    kind: "variant",
    r2_url: `${PLACEHOLDER_BUCKET_BASE}/${input.product_sku}/variant_${input.scene_hint}.jpg`,
    width: 2048,
    height: 2048,
    model_used: input.lora_url ? "flux-2-dev-lora:stub" : "flux-2-dev:stub",
    cost_cents: 0,
    prompt_summary: `variant ${input.scene_hint}`,
  };
}

export async function generateVideoWorker(input: {
  product_id: string;
  product_sku: string;
}): Promise<CanonicalAsset> {
  // TODO Phase 2: reuse the existing Kling client in packages/media-clients,
  // re-parameterized for Amazon main-image-video spec (1920x1080 H.264, 15-30s).
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
