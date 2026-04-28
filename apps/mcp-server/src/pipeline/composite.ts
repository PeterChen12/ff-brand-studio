/**
 * Phase I, Step I4 — Text composite (sidecar-backed).
 *
 * Calls /composite-text on the Node sidecar with a background R2 key
 * + 3 spec strings + brand color. Sidecar uses sharp's SVG overlay
 * to render the infographic deterministically (no LLM text-rendering
 * failure modes).
 *
 * One composite call per spec set — Phase I produces 3 distinct
 * composites per SKU (composite_detail_1, _2, _3) by varying which
 * spec is highlighted.
 */

import type { PipelineCtx, StepResult } from "./types.js";
import { callSidecar, type CompositeTextRequest, type CompositeTextResponse } from "./sidecar.js";

export async function compositeText(
  env: CloudflareBindings,
  ctx: PipelineCtx,
  backgroundR2Key: string,
  specs: string[],
  variantTag: string,
  brandHex: string = "#1C3FAA"
): Promise<StepResult> {
  if (specs.length !== 3) {
    return {
      status: "error",
      error: { kind: "config_missing", field: `specs[3] (got ${specs.length})` },
    };
  }
  const outputKey = `tenant/${ctx.tenantId}/pipeline/${ctx.runId}/composite_${variantTag}.png`;

  const req: CompositeTextRequest = {
    backgroundKey: backgroundR2Key,
    outputKey,
    specs,
    brandHex,
    watermarkText: "FF",
  };
  const res = await callSidecar<CompositeTextRequest, CompositeTextResponse>(
    env,
    "/composite-text",
    req
  );
  if (!res.ok) return { status: "error", error: res.error };

  return {
    status: "ok",
    outputR2Key: res.data.outputKey,
    costCents: 0,
    metadata: { model: "sidecar-composite-text", variantTag, millis: res.data.millis, specs },
  };
}

export async function bannerExtend(
  env: CloudflareBindings,
  ctx: PipelineCtx,
  studioR2Key: string,
  brandHex: string = "#F2EEE6"
): Promise<StepResult> {
  const outputKey = `tenant/${ctx.tenantId}/pipeline/${ctx.runId}/banner.png`;
  const res = await callSidecar(env, "/banner-extend", {
    inputKey: studioR2Key,
    outputKey,
    aspect: "16:9",
    brandHex,
  });
  if (!res.ok) return { status: "error", error: res.error };
  return {
    status: "ok",
    outputR2Key: outputKey,
    costCents: 0,
    metadata: { model: "sidecar-banner-extend" },
  };
}
