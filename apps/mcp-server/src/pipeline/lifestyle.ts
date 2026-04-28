/**
 * Phase I, Step I5.4 — Lifestyle render via FAL Nano Banana Pro.
 *
 * One call per SKU launch. Uses the kind-specific lifestylePrompt
 * from the deriver, with the cleanup_studio shot as the single
 * reference. Output is reused across Amazon + Shopify.
 */

import type { PipelineCtx, StepResult } from "./types.js";
import { getDeriver } from "./derivers/index.js";
import { publicUrl } from "./cache.js";

export const LIFESTYLE_COST_CENTS = 30;

export async function lifestyleRender(
  env: CloudflareBindings,
  ctx: PipelineCtx,
  studioR2Key: string
): Promise<StepResult> {
  if (!env.FAL_KEY) {
    return { status: "error", error: { kind: "config_missing", field: "FAL_KEY" } };
  }
  const deriver = getDeriver(ctx.kind);
  const prompt = deriver.lifestylePrompt({
    productName: ctx.productName,
    productNameZh: ctx.productNameZh,
    category: ctx.category,
  });
  const studioUrl = publicUrl(env, studioR2Key);

  let res: Response;
  try {
    res = await fetch("https://fal.run/fal-ai/gemini-3-pro-image-preview/edit", {
      method: "POST",
      headers: {
        authorization: `Key ${env.FAL_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        image_urls: [studioUrl],
        num_images: 1,
        output_format: "png",
      }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    return {
      status: "error",
      error: {
        kind: "provider_error",
        provider: "fal:gemini-3-pro-image-preview",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      status: "error",
      error: {
        kind: "provider_error",
        provider: "fal:gemini-3-pro-image-preview",
        status: res.status,
        message: text.slice(0, 400),
      },
    };
  }
  const json = (await res.json()) as { images?: Array<{ url?: string }> };
  const imgUrl = json.images?.[0]?.url;
  if (!imgUrl) {
    return {
      status: "error",
      error: { kind: "provider_error", provider: "fal:gemini-3-pro-image-preview", message: "missing image url" },
    };
  }
  const dl = await fetch(imgUrl, { signal: AbortSignal.timeout(60_000) });
  if (!dl.ok) {
    return {
      status: "error",
      error: { kind: "provider_error", provider: "fal-cdn", status: dl.status, message: "lifestyle download failed" },
    };
  }
  const bytes = await dl.arrayBuffer();
  const outputR2Key = `tenant/${ctx.tenantId}/pipeline/${ctx.runId}/lifestyle.png`;
  await env.R2.put(outputR2Key, bytes, { httpMetadata: { contentType: "image/png" } });
  return {
    status: "ok",
    outputR2Key,
    costCents: LIFESTYLE_COST_CENTS,
    metadata: { model: "fal:gemini-3-pro-image-preview", lifestyle: true },
  };
}
