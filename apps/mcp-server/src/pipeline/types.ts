/**
 * Phase I — shared pipeline types.
 *
 * Each pipeline step is a function {ctx, input} → StepResult. The
 * orchestrator (`pipeline/index.ts`) composes them, wallet-charges per
 * step, writes audit_events, and capped iter loops with FAIR fallback.
 */

import type { KindType } from "@ff/types";

export interface PipelineCtx {
  tenantId: string;
  productId: string;
  variantId: string;
  runId: string;
  sku: string;
  productName: string;
  productNameZh: string | null;
  category: string;
  kind: KindType;
  /** Raw supplier image R2 keys, attached at product creation. */
  referenceR2Keys: string[];
  /** Bound at the orchestrator level so steps don't refetch the row. */
  features: TenantFeatures;
  /** Ceiling — pipeline halts before charging if next step would exceed. */
  perLaunchCapCents: number;
}

export interface TenantFeatures {
  production_pipeline?: boolean;
  amazon_a_plus_grid?: boolean;
  has_sample_access?: boolean;
}

/** Discriminated step outcome. status='ok' → outputR2Key is the canonical asset. */
export type StepResult =
  | {
      status: "ok";
      outputR2Key: string;
      costCents: number;
      metadata: Record<string, unknown>;
    }
  | {
      status: "skipped";
      reason: string;
    }
  | {
      status: "error";
      error: PipelineError;
    };

/** Discriminated error union — keeps call sites pattern-matchable. */
export type PipelineError =
  | { kind: "provider_error"; provider: string; status?: number; message: string }
  | { kind: "quota_exceeded"; provider: string; message: string }
  | { kind: "identity_mismatch"; reasons: string[]; clipScore?: number }
  | { kind: "wallet_capped"; remainingCents: number }
  | { kind: "sidecar_unavailable"; message: string }
  | { kind: "config_missing"; field: string };

/** Verdict from the vision adjudicator (Step 5b). */
export interface Verdict {
  verdict: "pass" | "fail";
  reasons: string[];
  /** Per-feature pass/fail map keyed by visionChecklist entries. */
  details?: Record<string, boolean>;
}

/** A refined asset that has cleared the iterate loop (or hit the FAIR ceiling). */
export interface RefinedAsset {
  cropName: string;
  finalR2Key: string;
  iters: number;
  clipScore: number | null;
  verdict: Verdict | null;
  /** True if it shipped despite failing — needs HITL review. */
  fair: boolean;
  totalCostCents: number;
  history: Array<{ iter: number; r2Key: string; clipScore: number | null; verdict?: Verdict }>;
}

/** Aggregated outputs the planner consumes. Keys match planner sources. */
export interface PipelineOutputs {
  cleanup_studio: string;
  derive_studio: string;
  derive_crop_A: string;
  derive_crop_B: string;
  derive_crop_C: string;
  refine_studio: string;
  refine_crop_A: string;
  refine_crop_B: string;
  refine_crop_C: string;
  lifestyle: string;
  composite_detail_1: string;
  composite_detail_2: string;
  composite_detail_3: string;
  banner: string;
  /** The refined assets that gated each refine_* — for audit / debugging. */
  refinedAssets: RefinedAsset[];
}
