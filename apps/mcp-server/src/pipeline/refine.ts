/**
 * Phase I, Step 4 — FAL Nano Banana Pro dual-reference refine.
 *
 * Endpoint: fal-ai/gemini-3-pro-image-preview/edit
 * Cost: $0.30/call. Always pass [studio, crop] not just [studio] —
 * production note from lykan_upload: omitting the crop oracle reliably
 * tanks identity preservation.
 */

import type { PipelineCtx, StepResult } from "./types.js";
import { getDeriver, type RefinePromptArgs } from "./derivers/index.js";
import { publicUrl } from "./cache.js";

export const REFINE_COST_CENTS = 30;

export interface RefineOptions {
  /** Override the auto-generated prompt (used by iterate loop). */
  promptOverride?: string;
  /** Crop name for cache key uniqueness. */
  cropTag: string;
  /** Iter index for caching distinct iter outputs. */
  iter?: number;
}

export async function refineCall(
  env: CloudflareBindings,
  ctx: PipelineCtx,
  studioR2Key: string,
  cropR2Key: string,
  opts: RefineOptions
): Promise<StepResult> {
  if (!env.FAL_KEY) {
    return { status: "error", error: { kind: "config_missing", field: "FAL_KEY" } };
  }

  const deriver = getDeriver(ctx.kind);
  const promptArgs: RefinePromptArgs = {
    productName: ctx.productName,
    productNameZh: ctx.productNameZh,
    category: ctx.category,
  };
  const prompt = opts.promptOverride ?? deriver.refinePrompt(promptArgs);

  const studioUrl = publicUrl(env, studioR2Key);
  const cropUrl = publicUrl(env, cropR2Key);

  const body = {
    prompt,
    image_urls: [studioUrl, cropUrl],
    num_images: 1,
    output_format: "png",
  };

  const attempt = async (): Promise<{ ok: true; imgUrl: string } | { ok: false; status?: number; message: string; transient: boolean }> => {
    let res: Response;
    try {
      res = await fetch("https://fal.run/fal-ai/gemini-3-pro-image-preview/edit", {
        method: "POST",
        headers: {
          authorization: `Key ${env.FAL_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Production note: getaddrinfo failures appear after ~45min of
      // continuous calls — treat as transient.
      const transient = /getaddrinfo|ECONNRESET|ETIMEDOUT|abort/i.test(msg);
      return { ok: false, message: msg, transient };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const transient = res.status >= 500 || res.status === 408 || res.status === 429;
      return { ok: false, status: res.status, message: text.slice(0, 400), transient };
    }
    const json = (await res.json()) as { images?: Array<{ url?: string }> };
    const imgUrl = json.images?.[0]?.url;
    if (!imgUrl) return { ok: false, message: "fal response missing image url", transient: false };
    return { ok: true, imgUrl };
  };

  let result = await attempt();
  if (!result.ok && result.transient) {
    await new Promise((r) => setTimeout(r, 2000));
    result = await attempt();
  }
  if (!result.ok && result.transient) {
    await new Promise((r) => setTimeout(r, 4000));
    result = await attempt();
  }
  if (!result.ok) {
    return {
      status: "error",
      error: {
        kind: "provider_error",
        provider: "fal:gemini-3-pro-image-preview",
        status: result.status,
        message: result.message,
      },
    };
  }

  // Pull the FAL CDN URL → store in our R2 so library/lightbox URLs are stable.
  const dl = await fetch(result.imgUrl, { signal: AbortSignal.timeout(60_000) });
  if (!dl.ok) {
    return {
      status: "error",
      error: { kind: "provider_error", provider: "fal-cdn", status: dl.status, message: "image download failed" },
    };
  }
  const bytes = await dl.arrayBuffer();

  const iterTag = opts.iter && opts.iter > 1 ? `_iter${opts.iter}` : "";
  const outR2Key = `tenant/${ctx.tenantId}/pipeline/${ctx.runId}/refine_${opts.cropTag}${iterTag}.png`;
  await env.R2.put(outR2Key, bytes, { httpMetadata: { contentType: "image/png" } });

  return {
    status: "ok",
    outputR2Key: outR2Key,
    costCents: REFINE_COST_CENTS,
    metadata: {
      model: "fal:gemini-3-pro-image-preview",
      cropTag: opts.cropTag,
      iter: opts.iter ?? 1,
      promptOverridden: !!opts.promptOverride,
    },
  };
}

/** Pool of N refine calls capped to a concurrency limit. */
export async function refineParallel<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, idx: number) => Promise<StepResult>
): Promise<StepResult[]> {
  const results: StepResult[] = new Array(items.length);
  let cursor = 0;
  async function lane() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  const lanes = Array.from({ length: Math.min(concurrency, items.length) }, () => lane());
  await Promise.all(lanes);
  return results;
}
