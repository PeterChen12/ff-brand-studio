/**
 * Phase I, Step 3 — Kind-aware derive (sidecar-backed).
 *
 * Calls the Node sidecar's /derive endpoint. The sidecar runs sharp +
 * Pillow-style logic to produce 4 outputs from one cleanup.png input:
 *   studio.png (canonical 1:1)
 *   crop_A.png, crop_B.png, crop_C.png (per-kind detail crops)
 *
 * No paid LLM calls — sidecar CPU only. Cached at the sidecar layer
 * by sha256(inputKey + kind).
 */

import type { PipelineCtx, StepResult } from "./types.js";
import { callSidecar, type DeriveRequest, type DeriveResponse } from "./sidecar.js";
import { getDeriver } from "./derivers/index.js";

export interface DeriveOutputs {
  studioR2Key: string;
  cropAKey: string;
  cropBKey: string;
  cropCKey: string;
}

export async function deriveStep(
  env: CloudflareBindings,
  ctx: PipelineCtx,
  cleanupR2Key: string
): Promise<{ result: StepResult; outputs?: DeriveOutputs }> {
  const deriver = getDeriver(ctx.kind);
  const outputPrefix = `tenant/${ctx.tenantId}/pipeline/${ctx.runId}/derive`;

  const req: DeriveRequest = {
    inputKey: cleanupR2Key,
    outputPrefix,
    kind: ctx.kind,
    paddingPct: deriver.paddingPct,
  };

  const res = await callSidecar<DeriveRequest, DeriveResponse>(env, "/derive", req);
  if (!res.ok) {
    return { result: { status: "error", error: res.error } };
  }

  return {
    result: {
      status: "ok",
      // The studio output is what later refine steps reference as "the canonical"
      outputR2Key: res.data.studioKey,
      costCents: 0,
      metadata: {
        model: "sidecar-derive",
        kind: ctx.kind,
        detectedAspect: res.data.detectedAspect,
        millis: res.data.millis,
      },
    },
    outputs: {
      studioR2Key: res.data.studioKey,
      cropAKey: res.data.cropAKey,
      cropBKey: res.data.cropBKey,
      cropCKey: res.data.cropCKey,
    },
  };
}
