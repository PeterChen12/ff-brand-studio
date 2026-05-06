/**
 * Phase I, Step 2 — gpt-image-2 cleanup.
 *
 * Calls OpenAI's image-edit endpoint to strip text/logos/watermarks/
 * dimension labels and snap the subject onto a true white background.
 * Output is the canonical "cleanup_studio" frame the rest of the
 * pipeline derives from.
 *
 * Cost: ~$0.06/call medium quality (per ADR-0002). Cached in R2 by
 * sha256(input bytes + prompt) so same SKU re-launch is free.
 *
 * Note: gpt-image-2 does NOT accept the `input_fidelity` parameter
 * (that's gpt-image-1 only); passing it returns 400.
 */

import type { PipelineCtx, StepResult } from "./types.js";
import { lookupR2, sha256Hex } from "./cache.js";

const CLEANUP_PROMPT = [
  "Remove all text, logos, watermarks, supplier dimension labels, model",
  "numbers, and any white-background haloes or fringes from the image.",
  "Center the product on a pure white #FFFFFF seamless background.",
  "Maintain exact product geometry — no re-shaping, no re-coloring,",
  "no added details. Preserve all visible hardware, stitching, texture,",
  "and color exactly as in the source.",
].join(" ");

const COST_CENTS = 6;

export async function cleanupStep(
  env: CloudflareBindings,
  ctx: PipelineCtx,
  inputR2Key: string
): Promise<StepResult> {
  if (!env.OPENAI_API_KEY) {
    return { status: "error", error: { kind: "config_missing", field: "OPENAI_API_KEY" } };
  }

  const promptHash = await sha256Hex(CLEANUP_PROMPT);
  const cacheR2Key = `tenant/${ctx.tenantId}/pipeline/cache/cleanup/${inputR2Key.replace(/[^A-Za-z0-9_/-]/g, "_")}-${promptHash.slice(0, 16)}.png`;

  // Cache hit → free reuse.
  const cached = await lookupR2(env, cacheR2Key);
  if (cached) {
    return {
      status: "ok",
      outputR2Key: cacheR2Key,
      costCents: 0,
      metadata: { cached: true, model: "gpt-image-2" },
    };
  }

  // Read the supplier image from R2.
  const srcObj = await env.R2.get(inputR2Key);
  if (!srcObj) {
    return {
      status: "error",
      error: { kind: "provider_error", provider: "r2", message: `missing source ${inputR2Key}` },
    };
  }
  const srcBytes = await srcObj.arrayBuffer();
  const srcBlob = new Blob([srcBytes], { type: srcObj.httpMetadata?.contentType ?? "image/png" });

  const form = new FormData();
  form.append("model", "gpt-image-2");
  form.append("image", srcBlob, "input.png");
  form.append("prompt", CLEANUP_PROMPT);
  form.append("size", "1024x1024");
  form.append("quality", "medium");
  form.append("n", "1");

  const attempt = async (): Promise<{ ok: true; b64: string } | { ok: false; status?: number; message: string; transient: boolean }> => {
    let res: Response;
    try {
      res = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` },
        body: form,
        // gpt-image-2 medium-quality 1024x1024 edits routinely run 60-90s
        // and occasionally up to ~110s under load. 60s was too tight —
        // observed back-to-back timeouts on the LYKAN spike. 120s is safe;
        // the outer pipeline budget is 1500¢ and Workers Unbound wallclock
        // is 5 min, so we're not bumping into a hard ceiling.
        signal: AbortSignal.timeout(120_000),
      });
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err), transient: true };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const transient = res.status >= 500 || res.status === 408 || res.status === 429;
      return { ok: false, status: res.status, message: text.slice(0, 400), transient };
    }
    const json = (await res.json()) as { data?: Array<{ b64_json?: string }> };
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) {
      return { ok: false, message: "openai response missing b64_json", transient: false };
    }
    return { ok: true, b64 };
  };

  let result = await attempt();
  if (!result.ok && result.transient) {
    await new Promise((r) => setTimeout(r, 1500));
    result = await attempt();
  }
  if (!result.ok) {
    return {
      status: "error",
      error: {
        kind: "provider_error",
        provider: "openai",
        status: result.status,
        message: result.message,
      },
    };
  }

  // Decode + write to R2.
  const binary = atob(result.b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  await env.R2.put(cacheR2Key, bytes.buffer, {
    httpMetadata: { contentType: "image/png" },
  });

  return {
    status: "ok",
    outputR2Key: cacheR2Key,
    costCents: COST_CENTS,
    metadata: { cached: false, model: "gpt-image-2", quality: "medium" },
  };
}
