/**
 * v2 worker fan-out — barrel re-exports so callers (evaluator_optimizer,
 * launch_pipeline) can keep importing from "../orchestrator/workers" and
 * not care that each worker now lives in its own file.
 *
 * Phase 2 will swap each per-worker file's stub body for a real fal/OAI
 * call without touching this barrel or the consumers.
 */
export type { CanonicalAsset, WorkerFeedback } from "./types.js";
export { generateWhiteBgWorker } from "./white_bg.js";
export { generateLifestyleWorker } from "./lifestyle.js";
export { generateVariantWorker } from "./variant.js";
export { generateVideoWorker } from "./video.js";
