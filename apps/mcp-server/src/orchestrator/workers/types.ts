/**
 * Shared types for the v2 worker fan-out.
 * Each per-worker file imports from here so signatures stay aligned.
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

export interface WorkerFeedback {
  /** Issues from the previous evaluator iteration to incorporate into the
   *  next regeneration prompt. Empty means first attempt. */
  prior_issues: string[];
  /** Iteration number (1-indexed). Phase 2 generators may use this to pick
   *  alternative prompts or fall back to a different model. */
  iteration: number;
}

export const PLACEHOLDER_BUCKET_BASE =
  "https://pub-db3f39e3386347d58359ba96517eec84.r2.dev/_phase3_stub";
