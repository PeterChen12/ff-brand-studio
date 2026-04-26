import type { CanonicalAsset } from "./types.js";
import { PLACEHOLDER_BUCKET_BASE } from "./types.js";

/**
 * Phase 3 stub. Phase 2 will replace with fal FLUX.2 Dev + per-SKU LoRA
 * (lora_url comes from products.lora_url after train_sku_lora completes).
 */
export async function generateVariantWorker(input: {
  product_id: string;
  product_sku: string;
  scene_hint: string;
  lora_url?: string | null;
}): Promise<CanonicalAsset> {
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
